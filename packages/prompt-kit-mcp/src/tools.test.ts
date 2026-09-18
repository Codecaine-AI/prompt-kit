import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPromptProjects } from "./discovery";
import { createInteractionService } from "./service";
import { createPromptTools } from "./tools";

const guidance = async ({ profile = "generic" }: { profile?: "agent" | "single-output" | "generic" } = {}) => ({
  profile, text: "guide", snapshotId: `snapshot:${profile}`, sources: [], references: {}, catalog: [],
});

async function standaloneFixture(variables: string[] | undefined, nodes: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), "prompt-tools-"));
  await writeFile(join(root, "prompt.json"), JSON.stringify({ kind: "prompt", schemaVersion: "prompt-kit/v1", id: "standalone", nodes }));
  await writeFile(join(root, "codecaine.prompts.json"), JSON.stringify({ name: "standalone-project",
    standalonePrompts: [{ path: "prompt.json", ...(variables === undefined ? {} : { variables }) }] }));
  return root;
}

test("published apply schema compiles with draft 2020-12 refs rooted at the MCP input", async () => {
  const tools = createPromptTools({
    resolveProject: async () => { throw new Error("unused"); },
    resolvePrompt: async () => { throw new Error("unused"); },
  });
  const apply = tools.find((tool) => tool.name === "prompts_apply_ops")!;
  const validator = new Ajv2020({ strict: false }).compile(apply.inputSchema);
  expect(validator({ project: "p", prompt_id: "x", task_id: "t", expected_hash: "pk1-x",
    ops: [{ op: "remove_node", nodeId: "body" }] })).toBe(true);
  expect(validator({ project: "p", prompt_id: "x", task_id: "t", expected_hash: "pk1-x",
    ops: [{ op: "remove_node", nodeId: "body", extra: true }] })).toBe(false);
  const opsSchema = (apply.inputSchema.properties as Record<string, Record<string, unknown>>).ops;
  expect(opsSchema.$id).toBeUndefined();
  expect(opsSchema.$schema).toBeUndefined();
});

test("unknown standalone declarations block check completion and task end", async () => {
  const root = await standaloneFixture(undefined, [{ type: "paragraph", id: "body", content: ["text"] }]);
  try {
    const service = createInteractionService({ runtimeFingerprint: () => "runtime", guidance: guidance as never });
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const task = (await service.call(root, "prompts_begin", { project })).structuredContent.task_id as string;
    const checked = (await service.call(root, "prompts_check", { project, prompt_id: "standalone", task_id: task })).structuredContent;
    expect(checked.ok).toBe(false);
    expect(checked.variable_declarations_known).toBe(false);
    expect(JSON.stringify(checked.blocking)).toContain("variable_declarations_unknown");
    const ended = (await service.call(root, "prompts_end", { task_id: task })).structuredContent;
    expect(ended.all_current_revisions_checked).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("mutation lock rejects standalone declaration drift from its discovered entry", async () => {
  const root = await standaloneFixture([], [{ type: "paragraph", id: "body", content: ["text"] }]);
  try {
    const discovery = await discoverPromptProjects(root);
    const project = discovery.projects[0]!;
    const prompt = project.prompts[0]!;
    const tools = createPromptTools({ resolveProject: async () => project, resolvePrompt: async () => ({ project, prompt }) });
    const read = await tools.find((tool) => tool.name === "prompts_read")!.execute({ project: project.id, prompt_id: prompt.id });
    await writeFile(join(root, "codecaine.prompts.json"), JSON.stringify({ name: "standalone-project",
      standalonePrompts: [{ path: "prompt.json", variables: ["changed"] }] }));
    const changed = await tools.find((tool) => tool.name === "prompts_apply_ops")!.execute({ project: project.id, prompt_id: prompt.id,
      task_id: "task", expected_hash: read.structuredContent.hash,
      ops: [{ op: "update_node", nodeId: "body", patch: { content: ["changed"] } }] });
    expect(changed.isError).toBe(true);
    expect(JSON.stringify(changed.structuredContent)).toContain("declaration configuration changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("fresh standalone declarations validate rendered placeholder references", async () => {
  const root = await standaloneFixture([], [
    { type: "paragraph", id: "body", content: ["text"] },
    { type: "raw", id: "raw", value: "Hello" },
  ]);
  try {
    const service = createInteractionService({ runtimeFingerprint: () => "runtime", guidance: guidance as never });
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const task = (await service.call(root, "prompts_begin", { project })).structuredContent.task_id as string;
    const read = (await service.call(root, "prompts_read", { project, prompt_id: "standalone" })).structuredContent;
    const changed = await service.call(root, "prompts_apply_ops", { project, prompt_id: "standalone", task_id: task,
      expected_hash: read.hash, ops: [{ op: "update_node", nodeId: "raw", patch: { value: "Hello {{undeclared}}" } }] });
    expect(changed.isError).toBe(true);
    expect(JSON.stringify(changed.structuredContent)).toContain("undeclared");
  } finally { await rm(root, { recursive: true, force: true }); }
});

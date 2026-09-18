import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInteractionService } from "./service";
import { createPromptStore } from "@codecaine-ai/prompt-kit-server";

const document = () => ({ kind: "prompt" as const, schemaVersion: "prompt-kit/v1" as const, id: "fixture", nodes: [{ type: "paragraph" as const, id: "body", content: ["before"] }] });
const guidance = async ({ profile = "generic" }: { profile?: "agent" | "single-output" | "generic" } = {}) => ({
  profile, text: `guide:${profile}`, snapshotId: `snapshot:${profile}`, sources: [], references: { detail: "Detailed guidance" },
  catalog: [{ id: "detail", title: "Detail", summary: "More", profiles: [profile] }],
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "prompt-service-"));
  await mkdir(join(root, "catalog", "fixture", "prompt"), { recursive: true });
  await writeFile(join(root, "codecaine.prompts.json"), JSON.stringify({ name: "fixture-project", catalogRoots: ["catalog"] }));
  await writeFile(join(root, "catalog", "fixture", "agent.json"), JSON.stringify({ variables: {} }));
  await writeFile(join(root, "catalog", "fixture", "prompt", "prompt.json"), JSON.stringify(document()));
  return root;
}

test("runs discover, begin, read, apply, check, end and reports current checked revision", async () => {
  const root = await fixture();
  try {
    const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
    const discovered = (await service.call(root, "prompts_discover", {})).structuredContent;
    const project = (discovered.projects as Array<{ id: string }>)[0]!.id;
    const begun = (await service.call(root, "prompts_begin", { project, profile: "generic" })).structuredContent;
    const task = begun.task_id as string;
    const read = (await service.call(root, "prompts_read", { project, prompt_id: "fixture" })).structuredContent;
    expect((read.address_map as { rootId: string }).rootId).toBe("$root");
    const changed = (await service.call(root, "prompts_apply_ops", {
      project, prompt_id: "fixture", task_id: task, expected_hash: read.hash,
      ops: [{ op: "update_node", nodeId: "body", patch: { content: ["after"] } }],
    })).structuredContent;
    expect(changed.ok).toBe(true);
    expect(changed.hash).not.toBe(read.hash);
    const checked = (await service.call(root, "prompts_check", { project, prompt_id: "fixture", task_id: task })).structuredContent;
    expect(checked.ok).toBe(true);
    const ended = (await service.call(root, "prompts_end", { task_id: task })).structuredContent;
    expect(ended.all_current_revisions_checked).toBe(true);
    expect((ended.changed as unknown[])).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects stale hashes, cross-workspace tasks, and changed runtime contracts", async () => {
  const first = await fixture();
  const second = await fixture();
  let runtime = "runtime-1";
  try {
    const service = createInteractionService({ runtimeFingerprint: () => runtime, guidance: guidance as never });
    const project = ((await service.call(first, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const task = (await service.call(first, "prompts_begin", { project })).structuredContent.task_id as string;
    const read = (await service.call(first, "prompts_read", { project, prompt_id: "fixture" })).structuredContent;
    const stale = await service.call(first, "prompts_apply_ops", { project, prompt_id: "fixture", task_id: task, expected_hash: "pk1-stale", ops: [{ op: "remove_node", nodeId: "body" }] });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent.code).toBe("conflict");
    expect((await service.call(second, "prompts_end", { task_id: task })).isError).toBe(true);
    runtime = "runtime-2";
    const changed = await service.call(first, "prompts_apply_ops", { project, prompt_id: "fixture", task_id: task, expected_hash: read.hash, ops: [{ op: "update_node", nodeId: "body", patch: { content: ["blocked"] } }] });
    expect(changed.isError).toBe(true);
    expect(String(changed.structuredContent.detail)).toContain("implementation changed");
  } finally { await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true }); }
});

test("uses the task profile for completion while allowing incremental profile repairs", async () => {
  const root = await fixture();
  try {
    const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const task = (await service.call(root, "prompts_begin", { project, profile: "agent" })).structuredContent.task_id as string;
    const read = (await service.call(root, "prompts_read", { project, prompt_id: "fixture" })).structuredContent;
    const changed = (await service.call(root, "prompts_apply_ops", { project, prompt_id: "fixture", task_id: task, expected_hash: read.hash,
      ops: [{ op: "update_node", nodeId: "body", patch: { content: ["incremental repair"] } }] })).structuredContent;
    expect(changed.ok).toBe(true);
    expect(changed.profile).toBe("agent");
    const checked = (await service.call(root, "prompts_check", { project, prompt_id: "fixture", task_id: task })).structuredContent;
    expect(checked.profile).toBe("agent");
    expect(checked.ok).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("durable undo survives service restart and end rechecks the disk-current hash", async () => {
  const root = await fixture();
  try {
    const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const task = (await service.call(root, "prompts_begin", { project, profile: "generic" })).structuredContent.task_id as string;
    const read = (await service.call(root, "prompts_read", { project, prompt_id: "fixture" })).structuredContent;
    const changed = (await service.call(root, "prompts_apply_ops", { project, prompt_id: "fixture", task_id: task, expected_hash: read.hash,
      ops: [{ op: "update_node", nodeId: "body", patch: { content: ["changed"] } }] })).structuredContent;

    const restarted = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
    await restarted.call(root, "prompts_discover", {});
    const restartedTask = (await restarted.call(root, "prompts_begin", { project, profile: "generic" })).structuredContent.task_id as string;
    const undone = (await restarted.call(root, "prompts_undo", { project, prompt_id: "fixture", task_id: restartedTask,
      change_id: changed.changeId, expected_hash: changed.hash })).structuredContent;
    expect(undone.ok).toBe(true);
    await restarted.call(root, "prompts_check", { project, prompt_id: "fixture", task_id: restartedTask });

    const store = createPromptStore({ root });
    const target = { promptPath: "catalog/fixture/prompt/prompt.json", renderedPath: "catalog/fixture/prompt/system.md", declaredVariables: [] };
    const current = await store.read(target);
    if (!current.ok) throw new Error(current.detail);
    const externallyEdited = structuredClone(current.document);
    (externallyEdited.nodes[0] as { content: string[] }).content = ["external writer"];
    const external = await store.save(target, { document: externallyEdited, expectedHash: current.hash, source: "test-external" });
    if (!external.ok) throw new Error(external.detail);
    const ended = (await restarted.call(root, "prompts_end", { task_id: restartedTask })).structuredContent;
    expect(ended.all_current_revisions_checked).toBe(false);
    expect((ended.changed as Array<{ current_hash: string }>)[0]!.current_hash).toBe(external.hash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

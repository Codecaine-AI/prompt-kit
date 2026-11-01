import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInteractionService } from "./service";
import { createPromptAnnotationFileStore, createPromptAnnotationRoutes, createPromptStore } from "@codecaine-ai/prompt-kit-server";

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

test("an agent reads, replies to, and resolves a request filed through the Prompt UI's HTTP API", async () => {
  const root = await fixture();
  try {
    const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const promptPath = "catalog/fixture/prompt/prompt.json";
    const routes = createPromptAnnotationRoutes(() => createPromptAnnotationFileStore({ root }));
    const filed = await routes(new Request(`http://prompt.test/api/annotations?path=${encodeURIComponent(promptPath)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: { kind: "prompt-node", docId: "fixture", nodeId: "body" }, body: "Say after.", intent: "agent-request", author: "ford" }),
    }));
    expect(filed!.status).toBe(201);
    const requestId = ((await filed!.json()) as { annotation: { id: string } }).annotation.id;

    const open = (await service.call(root, "prompts_requests", { project, prompt_id: "fixture" })).structuredContent;
    expect(open.prompt_path).toBe(promptPath);
    expect((open.requests as Array<{ id: string; body: string }>).map((entry) => [entry.id, entry.body])).toEqual([[requestId, "Say after."]]);

    const unbegun = await service.call(root, "prompts_request_resolve", { project, prompt_id: "fixture", task_id: "missing", request_id: requestId, expected_hash: open.hash });
    expect(unbegun.isError).toBe(true);
    const task = (await service.call(root, "prompts_begin", { project })).structuredContent.task_id as string;
    const replied = (await service.call(root, "prompts_request_reply", { project, prompt_id: "fixture", task_id: task, request_id: requestId, expected_hash: open.hash, body: "Working on it." })).structuredContent;
    expect(replied.ok).toBe(true);
    const stale = await service.call(root, "prompts_request_resolve", { project, prompt_id: "fixture", task_id: task, request_id: requestId, expected_hash: open.hash });
    expect(stale.structuredContent.code).toBe("conflict");
    const resolved = (await service.call(root, "prompts_request_resolve", { project, prompt_id: "fixture", task_id: task, request_id: requestId, expected_hash: replied.expected_hash, resolution: "Changed body to say after." })).structuredContent;
    expect(resolved.ok).toBe(true);

    expect((await service.call(root, "prompts_requests", { project, prompt_id: "fixture" })).structuredContent.requests).toEqual([]);
    const reopened = await createPromptAnnotationFileStore({ root }).list(promptPath);
    expect(reopened.ok && reopened.annotations[0]).toMatchObject({ status: "resolved", resolution: "Changed body to say after.", replies: [{ author: "agent", body: "Working on it." }] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

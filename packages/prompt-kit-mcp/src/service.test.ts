import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPromptProjects } from "./discovery";
import { createInteractionService } from "./service";
import { createPromptAnnotationFileStore, createPromptAnnotationRoutes, createPromptStore } from "@codecaine-ai/prompt-kit-server";

const document = () => ({ kind: "prompt" as const, schemaVersion: "prompt-kit/v1" as const, id: "fixture", nodes: [{ type: "paragraph" as const, id: "body", content: ["before"] }] });
const guidance = async ({ profile = "generic" }: { profile?: "agent" | "single-output" | "generic" } = {}) => ({
  profile, text: `guide:${profile}`, snapshotId: `snapshot:${profile}`, sources: [], references: { detail: "Detailed guidance" },
  catalog: [{ id: "detail", title: "Detail", summary: "More", topic: "catalog", profiles: [profile] }],
  topics: [{ id: "standards", title: "Standards", summary: "The standards.", text: `# Standards\n\nguide:${profile}` }],
});
/** prompts_begin, then the standards read that prompts_apply_ops needs. */
async function begin(service: ReturnType<typeof createInteractionService>, root: string, args: Record<string, unknown>): Promise<string> {
  const task = (await service.call(root, "prompts_begin", args)).structuredContent.task_id as string;
  expect((await service.call(root, "prompts_guidance", { task_id: task, topic: "standards" })).structuredContent.ok).toBe(true);
  return task;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "prompt-service-"));
  await mkdir(join(root, "catalog", "fixture", "prompt"), { recursive: true });
  await writeFile(join(root, "codecaine.prompts.json"), JSON.stringify({ name: "fixture-project", catalogRoots: ["catalog"] }));
  await writeFile(join(root, "catalog", "fixture", "agent.json"), JSON.stringify({ variables: {} }));
  await writeFile(join(root, "catalog", "fixture", "prompt", "prompt.json"), JSON.stringify(document()));
  return root;
}

test("runs discover, begin, read, apply and check, and the check with task_id reports the current checked revision", async () => {
  const root = await fixture();
  try {
    const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
    const discovered = (await service.call(root, "prompts_discover", {})).structuredContent;
    const project = (discovered.projects as Array<{ id: string }>)[0]!.id;
    const begun = (await service.call(root, "prompts_begin", { project, profile: "generic" })).structuredContent;
    expect(begun).toEqual({ ok: true, task_id: expect.any(String), profile: "generic", snapshot_id: "snapshot:generic", project: { id: project, name: "fixture-project" } });
    const task = begun.task_id as string;
    await service.call(root, "prompts_guidance", { task_id: task, topic: "standards" });
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
    expect(checked.snapshot_id).toBe("snapshot:generic");
    expect(checked.all_current_revisions_checked).toBe(true);
    expect(checked.changed).toEqual([{ project, prompt_id: "fixture", hash: changed.hash, current_hash: changed.hash, checked: true, check_ok: true }]);
    // Without task_id, or with null, the check reports the prompt alone. A wrong-typed task_id is refused.
    for (const args of [{}, { task_id: null }]) {
      const plain = (await service.call(root, "prompts_check", { project, prompt_id: "fixture", ...args })).structuredContent;
      expect(plain.ok).toBe(true);
      expect(plain.changed).toBeUndefined();
    }
    for (const task_id of [7, "", "missing"]) {
      const refused = await service.call(root, "prompts_check", { project, prompt_id: "fixture", task_id });
      expect(refused.isError).toBe(true);
      expect(refused.structuredContent.detail).toBe("Unknown task for this workspace. Call prompts_begin and use its task_id.");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects stale hashes, cross-workspace tasks, and changed runtime contracts", async () => {
  const first = await fixture();
  const second = await fixture();
  let runtime = "runtime-1";
  try {
    const service = createInteractionService({ runtimeFingerprint: () => runtime, guidance: guidance as never });
    const project = ((await service.call(first, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const task = await begin(service, first, { project });
    const read = (await service.call(first, "prompts_read", { project, prompt_id: "fixture" })).structuredContent;
    const stale = await service.call(first, "prompts_apply_ops", { project, prompt_id: "fixture", task_id: task, expected_hash: "pk1-stale", ops: [{ op: "remove_node", nodeId: "body" }] });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent.code).toBe("conflict");
    expect((await service.call(second, "prompts_check", { project, prompt_id: "fixture", task_id: task })).isError).toBe(true);
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
    const task = await begin(service, root, { project, profile: "agent" });
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

test("durable undo survives service restart and the task report rechecks the disk-current hash", async () => {
  const root = await fixture();
  try {
    const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const task = await begin(service, root, { project, profile: "generic" });
    const read = (await service.call(root, "prompts_read", { project, prompt_id: "fixture" })).structuredContent;
    const changed = (await service.call(root, "prompts_apply_ops", { project, prompt_id: "fixture", task_id: task, expected_hash: read.hash,
      ops: [{ op: "update_node", nodeId: "body", patch: { content: ["changed"] } }] })).structuredContent;

    const restarted = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
    await restarted.call(root, "prompts_discover", {});
    const restartedTask = await begin(restarted, root, { project, profile: "generic" });
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
    const report = (await restarted.call(root, "prompts_check", { project, prompt_id: "fixture", task_id: restartedTask })).structuredContent;
    // The check records the external revision, so the report checks the other way: a stale check fails it.
    expect((report.changed as Array<{ current_hash: string; checked: boolean }>)[0]).toMatchObject({ current_hash: external.hash, checked: true });
    const later = structuredClone(external.document);
    (later.nodes[0] as { content: string[] }).content = ["second external writer"];
    const second = await store.save(target, { document: later, expectedHash: external.hash, source: "test-external" });
    if (!second.ok) throw new Error(second.detail);
    const otherPrompt = (await restarted.call(root, "prompts_check", { project, prompt_id: "fixture" })).structuredContent;
    expect(otherPrompt.changed).toBeUndefined();
    const discovered = (await restarted.call(root, "prompts_discover", { project })).structuredContent;
    expect((discovered.prompts as unknown[]).length).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an agent reads, replies to, and closes a request filed through the Prompt UI's HTTP API", async () => {
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

    const unbegun = await service.call(root, "prompts_request_reply", { project, prompt_id: "fixture", task_id: "missing", request_id: requestId, expected_hash: open.hash, body: "Done.", close: true });
    expect(unbegun.isError).toBe(true);
    const task = (await service.call(root, "prompts_begin", { project })).structuredContent.task_id as string;
    const replied = (await service.call(root, "prompts_request_reply", { project, prompt_id: "fixture", task_id: task, request_id: requestId, expected_hash: open.hash, body: "Working on it." })).structuredContent;
    expect(replied.ok).toBe(true);
    expect((replied.reply as { body: string }).body).toBe("Working on it.");
    // close false or null replies and leaves the request open, as an omitted close does.
    let hash = replied.expected_hash;
    for (const close of [false, null]) {
      const open = (await service.call(root, "prompts_request_reply", { project, prompt_id: "fixture", task_id: task, request_id: requestId, expected_hash: hash, body: `Still on it (${close}).`, close })).structuredContent;
      expect(open).toMatchObject({ ok: true, request: { status: "open" }, reply: { body: `Still on it (${close}).` } });
      hash = open.expected_hash;
    }
    for (const body of [undefined, "  "]) {
      const unexplained = await service.call(root, "prompts_request_reply", { project, prompt_id: "fixture", task_id: task, request_id: requestId, expected_hash: hash, close: true, ...(body === undefined ? {} : { body }) });
      expect(unexplained.isError).toBe(true);
      expect(unexplained.structuredContent.detail).toBe("body must be a non-empty string.");
    }
    for (const close of ["true", 1]) {
      const wrong = await service.call(root, "prompts_request_reply", { project, prompt_id: "fixture", task_id: task, request_id: requestId, expected_hash: hash, body: "Done.", close });
      expect(wrong.structuredContent).toEqual({ ok: false, detail: "close must be true, false, or null." });
    }
    const stale = await service.call(root, "prompts_request_reply", { project, prompt_id: "fixture", task_id: task, request_id: requestId, expected_hash: open.hash, body: "Changed body to say after.", close: true });
    expect(stale.structuredContent.code).toBe("conflict");
    const resolved = (await service.call(root, "prompts_request_reply", { project, prompt_id: "fixture", task_id: task, request_id: requestId, expected_hash: hash, body: "Changed body to say after.", close: true })).structuredContent;
    expect(resolved).toMatchObject({ ok: true, request: { status: "resolved", resolution: "Changed body to say after." } });
    expect(resolved.reply).toBeUndefined();
    // The close result points at the last step of a request: list the requests again.
    expect(resolved.next).toBe("Call prompts_requests again and confirm that the request is closed, then work the next open request.");

    expect((await service.call(root, "prompts_requests", { project, prompt_id: "fixture" })).structuredContent.requests).toEqual([]);
    const reopened = await createPromptAnnotationFileStore({ root }).list(promptPath);
    expect(reopened.ok && reopened.annotations[0]).toMatchObject({ status: "resolved", resolution: "Changed body to say after.",
      replies: [{ author: "agent", body: "Working on it." }, { author: "agent", body: "Still on it (false)." }, { author: "agent", body: "Still on it (null)." }] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("prompts_discover with project returns that project's prompts and errors, and refuses a project outside the workspace", async () => {
  const root = await fixture();
  const other = await fixture();
  try {
    const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
    const whole = (await service.call(root, "prompts_discover", {})).structuredContent;
    const project = (whole.projects as Array<{ id: string; prompts: unknown[] }>)[0]!;
    for (const empty of [{ project: null }, { project: null, workspace: null }]) {
      expect((await service.call(root, "prompts_discover", empty)).structuredContent).toEqual(whole);
    }
    const one = (await service.call(root, "prompts_discover", { project: project.id })).structuredContent;
    expect(one).toEqual({ ok: true, workspace: whole.workspace, project: { id: project.id, name: "fixture-project" }, prompts: project.prompts, errors: [],
      next: "Call prompts_begin with this project before editing, then prompts_read for a prompt." });
    const foreign = ((await service.call(other, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    for (const [args, detail] of [
      [{ project: "missing" }, "Project is not in this workspace. Call prompts_discover and use a returned project ID."],
      [{ project: foreign }, "Project is not in this workspace. Call prompts_discover and use a returned project ID."],
      [{ project: 5 }, "project must be a non-empty string."],
      [{ project: "" }, "project must be a non-empty string."],
      [{ workspace: 5 }, "workspace must be a non-empty string."],
      [{ projects: project.id }, "Unknown argument: projects."],
    ] as const) {
      const refused = await service.call(root, "prompts_discover", args as Record<string, unknown>);
      expect(refused.isError).toBe(true);
      expect(refused.structuredContent.detail).toBe(detail);
    }
  } finally { await rm(root, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); }
});

test("a task expires 30 minutes after its last call or 12 hours after prompts_begin, and a later call names the reason", async () => {
  const root = await fixture();
  let clock = 1_000_000;
  const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never, now: () => clock });
  try {
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const begin = async () => (await service.call(root, "prompts_begin", { project })).structuredContent.task_id as string;
    const check = (task_id: string) => service.call(root, "prompts_check", { project, prompt_id: "fixture", task_id });
    const idle = await begin();
    const busy = await begin();
    expect(service.stats().tasks).toBe(2);
    clock += 29 * 60_000;
    expect((await check(busy)).isError).toBeUndefined();
    clock += 2 * 60_000;
    // 31 minutes since idle's last call, 2 since busy's.
    expect(service.stats().tasks).toBe(1);
    expect((await check(idle)).structuredContent.detail).toBe(`Task ${idle} expired after 30 minutes without a prompt call that named it. Saved edits are kept. Call prompts_begin again.`);
    expect((await check(busy)).isError).toBeUndefined();
    // A task that stays busy still closes 12 hours after prompts_begin.
    // busy began 31 minutes ago. 27 calls 25 minutes apart reach 11 hours 46 minutes, and the next one passes 12 hours.
    for (let call = 0; call < 27; call++) { clock += 25 * 60_000; expect((await check(busy)).isError).toBeUndefined(); }
    clock += 25 * 60_000;
    expect((await check(busy)).structuredContent.detail).toBe(`Task ${busy} reached its 12 hours limit and was closed. Saved edits are kept. Call prompts_begin again.`);
    expect(service.stats().tasks).toBe(0);
    // An expired id from another workspace stays unknown there.
    const other = await fixture();
    try {
      await service.call(other, "prompts_discover", {});
      const elsewhere = await service.call(other, "prompts_check", { project, prompt_id: "fixture", task_id: idle });
      expect(elsewhere.structuredContent.detail).not.toContain("expired");
    } finally { await rm(other, { recursive: true, force: true }); }
  } finally { service.close(); await rm(root, { recursive: true, force: true }); }
});

test("a new call on a task past its 12 hours is refused while another call on the task runs, and the running call keeps its task", async () => {
  const root = await fixture();
  let clock = 1_000_000;
  let gate: Promise<void> | undefined;
  let entered!: () => void;
  // The fingerprint check of a mutation awaits the gate once, after the task is pinned.
  const runtimeFingerprint = async () => { const held = gate; gate = undefined; if (held) { entered(); await held; } return "runtime-1"; };
  const service = createInteractionService({ runtimeFingerprint, guidance: guidance as never, now: () => clock });
  try {
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const task = await begin(service, root, { project });
    const read = (await service.call(root, "prompts_read", { project, prompt_id: "fixture" })).structuredContent;
    const edit = (text: string) => service.call(root, "prompts_apply_ops", { project, prompt_id: "fixture", task_id: task, expected_hash: read.hash, ops: [{ op: "update_node", nodeId: "body", patch: { content: [text] } }] });
    let release!: () => void;
    gate = new Promise((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    const running = edit("First.");
    await reached;
    clock += 13 * 60 * 60_000;
    const late = await edit("Second.");
    expect(late.structuredContent.detail).toBe(`Task ${task} reached its 12 hours limit and was closed. Saved edits are kept. Call prompts_begin again.`);
    release();
    expect((await running).structuredContent.ok).toBe(true);
    // The next sweep after the running call retires the task.
    expect(service.stats().tasks).toBe(0);
  } finally { service.close(); await rm(root, { recursive: true, force: true }); }
});

test("a slow discovery cannot expire the task of a call that is already running", async () => {
  const root = await fixture();
  let clock = 1_000_000;
  let gate: Promise<void> | undefined;
  let entered!: () => void;
  const discover = async (workspace: string) => { const held = gate; gate = undefined; if (held) { entered(); await held; } return discoverPromptProjects(workspace); };
  const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never, now: () => clock, discover });
  try {
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const task = await begin(service, root, { project });
    clock += 29 * 60_000;
    let release!: () => void;
    gate = new Promise((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    const running = service.call(root, "prompts_check", { project, prompt_id: "fixture", task_id: task });
    await reached;
    // 34 minutes after the task's last call, another call sweeps while the check is still in discovery.
    clock += 5 * 60_000;
    expect((await service.call(root, "prompts_discover", {})).structuredContent.ok).toBe(true);
    expect(service.stats().tasks).toBe(1);
    release();
    const checked = (await running).structuredContent;
    expect(checked.ok).toBe(true);
    expect(checked.all_current_revisions_checked).toBe(true);
    // The idle limit counts from the end of that call.
    clock += 29 * 60_000;
    expect((await service.call(root, "prompts_check", { project, prompt_id: "fixture", task_id: task })).isError).toBeUndefined();
    clock += 31 * 60_000;
    expect((await service.call(root, "prompts_check", { project, prompt_id: "fixture", task_id: task })).structuredContent.detail).toContain("expired after 30 minutes");
  } finally { service.close(); await rm(root, { recursive: true, force: true }); }
});

test("a prompts_check with task_id that fails still carries the task report, with each read error", async () => {
  const root = await fixture();
  const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
  try {
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const task = await begin(service, root, { project });
    const read = (await service.call(root, "prompts_read", { project, prompt_id: "fixture" })).structuredContent;
    const saved = (await service.call(root, "prompts_apply_ops", { project, prompt_id: "fixture", task_id: task, expected_hash: read.hash,
      ops: [{ op: "update_node", nodeId: "body", patch: { content: ["after"] } }] })).structuredContent;
    // An unknown prompt fails the check before any read.
    const unknown = await service.call(root, "prompts_check", { project, prompt_id: "missing", task_id: task });
    expect(unknown.isError).toBe(true);
    expect(unknown.structuredContent).toMatchObject({ ok: false, detail: expect.stringContaining("Unknown prompt missing"), snapshot_id: "snapshot:generic", all_current_revisions_checked: false,
      changed: [{ project, prompt_id: "fixture", hash: saved.hash, current_hash: saved.hash, checked: false, check_ok: false }] });
    // A prompt that no longer reads fails the check, and its report entry carries the read error.
    await writeFile(join(root, "catalog", "fixture", "prompt", "prompt.json"), "not json");
    const broken = await service.call(root, "prompts_check", { project, prompt_id: "fixture", task_id: task });
    expect(broken.isError).toBe(true);
    const entry = (broken.structuredContent.changed as Array<Record<string, unknown>>)[0]!;
    expect(entry).toMatchObject({ prompt_id: "fixture", checked: false, check_ok: false });
    expect(entry.current_hash).toBeUndefined();
    expect(typeof entry.read_error).toBe("string");
    expect(broken.structuredContent.all_current_revisions_checked).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("prompts_begin with profile null pins the project's own profile, as an omitted profile does", async () => {
  const root = await fixture();
  await writeFile(join(root, "codecaine.prompts.json"), JSON.stringify({ name: "fixture-project", profile: "agent", catalogRoots: ["catalog"] }));
  const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never });
  try {
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    for (const args of [{}, { profile: null }]) expect((await service.call(root, "prompts_begin", { project, ...args })).structuredContent.profile).toBe("agent");
    expect((await service.call(root, "prompts_begin", { project, profile: "generic" })).structuredContent.profile).toBe("generic");
    expect((await service.call(root, "prompts_begin", { project, profile: 3 })).structuredContent.detail).toBe("profile must be agent, single-output, or generic.");
    const begin = service.listTools().find((tool) => tool.name === "prompts_begin")!;
    expect((begin.inputSchema.properties as Record<string, unknown>).profile).toMatchObject({ anyOf: [{ enum: ["agent", "single-output", "generic"] }, { type: "null" }] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the task limits come from CODECAINE_PROMPTS_TASK_IDLE_MS and CODECAINE_PROMPTS_TASK_MAX_AGE_MS, and an invalid value keeps the default with a warning", async () => {
  const root = await fixture();
  const saved = { idle: process.env.CODECAINE_PROMPTS_TASK_IDLE_MS, age: process.env.CODECAINE_PROMPTS_TASK_MAX_AGE_MS };
  const warn = spyOn(console, "error").mockImplementation(() => {});
  let clock = 1_000_000;
  const services: ReturnType<typeof createInteractionService>[] = [];
  const open = () => { const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: guidance as never, now: () => clock }); services.push(service); return service; };
  try {
    process.env.CODECAINE_PROMPTS_TASK_IDLE_MS = "120000";
    process.env.CODECAINE_PROMPTS_TASK_MAX_AGE_MS = "300000";
    const short = open();
    const project = ((await short.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const check = (service: ReturnType<typeof createInteractionService>, task_id: string) => service.call(root, "prompts_check", { project, prompt_id: "fixture", task_id });
    const idle = await begin(short, root, { project });
    clock += 2 * 60_000 + 1;
    expect((await check(short, idle)).structuredContent.detail).toBe(`Task ${idle} expired after 2 minutes without a prompt call that named it. Saved edits are kept. Call prompts_begin again.`);
    const aged = await begin(short, root, { project });
    for (let call = 0; call < 5; call++) { clock += 60_000; expect((await check(short, aged)).isError).toBeUndefined(); }
    clock += 1;
    expect((await check(short, aged)).structuredContent.detail).toBe(`Task ${aged} reached its 5 minutes limit and was closed. Saved edits are kept. Call prompts_begin again.`);
    expect(warn).not.toHaveBeenCalled();
    process.env.CODECAINE_PROMPTS_TASK_IDLE_MS = "abc";
    process.env.CODECAINE_PROMPTS_TASK_MAX_AGE_MS = "-1";
    const fallback = open();
    expect(warn.mock.calls.map(([message]) => String(message).split("=")[0])).toEqual(["CODECAINE_PROMPTS_TASK_IDLE_MS", "CODECAINE_PROMPTS_TASK_MAX_AGE_MS"]);
    await fallback.call(root, "prompts_discover", {});
    const kept = await begin(fallback, root, { project });
    clock += 29 * 60_000;
    expect((await check(fallback, kept)).isError).toBeUndefined();
  } finally {
    warn.mockRestore();
    for (const service of services) service.close();
    for (const [key, value] of [["CODECAINE_PROMPTS_TASK_IDLE_MS", saved.idle], ["CODECAINE_PROMPTS_TASK_MAX_AGE_MS", saved.age]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("parallel prompts_begin calls never open more tasks than maxTasks", async () => {
  const root = await fixture();
  // A slow guidance load keeps each begin between its capacity check and its insert while the others arrive.
  const slow = async (options?: { profile?: "agent" | "single-output" | "generic" }) => { await Bun.sleep(20); return guidance(options); };
  const service = createInteractionService({ runtimeFingerprint: () => "runtime-1", guidance: slow as never, maxTasks: 1 });
  try {
    const project = ((await service.call(root, "prompts_discover", {})).structuredContent.projects as Array<{ id: string }>)[0]!.id;
    const results = await Promise.all([1, 2, 3].map(() => service.call(root, "prompts_begin", { project })));
    expect(results.filter((result) => result.structuredContent.ok === true)).toHaveLength(1);
    for (const refused of results.filter((result) => result.isError)) {
      expect(refused.structuredContent.detail).toBe("Too many open prompt tasks (1). A task expires after 30 minutes without a prompt call that names it.");
    }
    expect(service.stats().tasks).toBe(1);
  } finally { service.close(); await rm(root, { recursive: true, force: true }); }
});

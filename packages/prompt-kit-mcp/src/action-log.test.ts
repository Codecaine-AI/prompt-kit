import { afterAll, afterEach, expect, test } from "bun:test";
import { ActionLog } from "@codecaine-ai/action-log";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRpc } from "./daemon";
import { createInteractionService } from "./service";

const guidance = async ({ profile = "generic" }: { profile?: string } = {}) => ({
  profile, text: "guide", snapshotId: `snapshot:${profile}`, sources: [], references: {}, catalog: [],
});
// The daemon opens its log once per process, so every test shares one file and uses its own run id.
const logDir = mkdtempSync(join(tmpdir(), "prompt-action-log-file-"));
const logPath = join(logDir, "action-log.sqlite");
process.env.CODECAINE_ACTION_LOG = logPath;
const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
afterAll(() => rmSync(logDir, { recursive: true, force: true }));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "prompt-action-log-"));
  cleanup.push(root);
  await mkdir(join(root, "catalog", "fixture", "prompt"), { recursive: true });
  await writeFile(join(root, "codecaine.prompts.json"), JSON.stringify({ name: "fixture-project", catalogRoots: ["catalog"] }));
  await writeFile(join(root, "catalog", "fixture", "agent.json"), JSON.stringify({ variables: {} }));
  await writeFile(join(root, "catalog", "fixture", "prompt", "prompt.json"), JSON.stringify({ kind: "prompt", schemaVersion: "prompt-kit/v1", id: "fixture", nodes: [{ type: "paragraph", id: "body", content: ["x"] }] }));
  return { root, service: createInteractionService({ runtimeFingerprint: () => "rt", guidance: guidance as never }) };
}

test("an /rpc call with identity writes one record with its thread id and tool", async () => {
  const { root, service } = await fixture();
  await handleRpc(service, { workspace: root, name: "prompts_discover", arguments: {}, identity: { runId: "run-a", threadId: "thread-a", agent: "claude" } });
  const records = ActionLog.open({ path: logPath }).query({ runId: "run-a" });
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ threadId: "thread-a", tool: "prompts_discover", agent: "claude", target: "-", result: "ok" });
});

test("prompts_begin with thread_id binds the run so later calls resolve to the thread", async () => {
  const { root, service } = await fixture();
  const identity = { runId: "run-b", threadId: null, agent: null };
  const found = await handleRpc(service, { workspace: root, name: "prompts_discover", arguments: {}, identity });
  const project = (found.structuredContent.projects as Array<{ id: string }>)[0]!.id;
  const begun = await handleRpc(service, { workspace: root, name: "prompts_begin", arguments: { project, thread_id: "thread-b" }, identity });
  await handleRpc(service, { workspace: root, name: "prompts_read", arguments: { project, prompt_id: "nope" }, identity });
  await handleRpc(service, { workspace: root, name: "prompts_end", arguments: { task_id: begun.structuredContent.task_id }, identity });
  const records = ActionLog.open({ path: logPath }).query({ threadId: "thread-b" });
  expect(records.map(r => r.tool)).toEqual(["prompts_discover", "prompts_begin", "prompts_read", "prompts_end"]);
  expect(records[0]!.agent).toBe("prompt-kit-mcp");
  expect(records[1]!.snapshotId).toBe("snapshot:generic");
  expect(records[2]).toMatchObject({ target: "nope", result: "refused" });
  expect(records[3]!.snapshotId).toBe("snapshot:generic");
});

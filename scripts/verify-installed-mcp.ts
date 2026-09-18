/** Exercise an installed client connection through MCP stdio without changing catalog prompts. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const workspace = resolve(import.meta.dir, "..");
const clientName = process.argv.includes("--claude") ? "claude" : "codex";
const configFile = clientName === "claude"
  ? join(homedir(), ".claude.json")
  : join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml");
const configText = await readFile(configFile, "utf8");
const config = (clientName === "claude" ? JSON.parse(configText) : Bun.TOML.parse(configText)) as any;
const connection = (clientName === "claude" ? config.mcpServers : config.mcp_servers)?.["codecaine-prompts"];
assert.equal(typeof connection?.command, "string", "Installed codecaine-prompts connection is missing");
const fixture = await mkdtemp(join(tmpdir(), "prompt-kit-installed-smoke-"));
const clients: Client[] = [];
const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
const create = async () => {
  const client = new Client({ name: "prompt-kit-installation-verifier", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: connection.command, args: [...connection.args, "--workspace", workspace], env: { ...environment, ...connection.env }, stderr: "pipe" }));
  clients.push(client);
  return client;
};
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return (result.structuredContent ?? JSON.parse((result.content as any[]).find(item => item.type === "text").text)) as any;
};

try {
  const a = await create();
  const b = await create();
  const listedTools = await a.listTools();
  for (const name of ["prompts_discover", "prompts_list", "prompts_begin", "prompts_guidance", "prompts_read", "prompts_apply_ops", "prompts_undo", "prompts_check", "prompts_end"]) {
    assert(listedTools.tools.some(tool => tool.name === name), `Missing tool ${name}`);
  }
  const live = await call(a, "prompts_discover", { workspace });
  assert.equal(live.ok, true);
  assert(live.projects.length > 0, "Current Prompt Kit catalog must be discoverable");
  const actualProject = live.projects.find((project: any) => project.name === "prompt-kit") ?? live.projects[0];
  const actualList = await call(a, "prompts_list", { project: actualProject.id });
  assert.equal(actualList.ok, true);
  assert(actualList.prompts.length > 0);
  const actualRead = await call(a, "prompts_read", { project: actualProject.id, prompt_id: actualList.prompts[0].id });
  assert.equal(actualRead.ok, true);
  assert(actualRead.hash.startsWith("pk1-"));

  const doc = { kind: "prompt", schemaVersion: "prompt-kit/v1", id: "installed-smoke", nodes: [{ type: "paragraph", id: "opening", content: ["Before installed MCP verification."] }] };
  await writeFile(join(fixture, "prompt.json"), JSON.stringify(doc));
  await writeFile(join(fixture, "codecaine.prompts.json"), JSON.stringify({ name: "installed-smoke", profile: "generic", standalonePrompts: [{ path: "prompt.json", declaredVariables: [] }] }));
  const discovered = await call(a, "prompts_discover", { workspace: fixture });
  assert.equal(discovered.ok, true);
  const project = discovered.projects[0].id;
  assert.equal((await call(b, "prompts_discover", { workspace: fixture })).ok, true);
  const task = await call(a, "prompts_begin", { project, profile: "generic" });
  assert.equal(task.ok, true);
  assert(typeof task.guidance === "string" && task.guidance.length > 1000);
  const target = { project, prompt_id: doc.id };
  const before = await call(a, "prompts_read", target);
  assert.equal(before.ok, true);
  const mutation = { ...target, task_id: task.task_id, expected_hash: before.hash, ops: [{ op: "update_node", nodeId: "opening", patch: { content: ["Saved through the installed MCP connection."] } }] };
  const saved = await call(a, "prompts_apply_ops", mutation);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const visible = await call(b, "prompts_read", target);
  assert.equal(visible.hash, saved.hash);
  assert(visible.rendered.includes("Saved through the installed MCP connection."));
  assert((await readFile(join(fixture, "prompt.rendered.md"), "utf8")).includes("Saved through the installed MCP connection."));
  const stale = await call(b, "prompts_apply_ops", mutation);
  assert.equal(stale.ok, false);
  assert.equal(stale.currentHash, saved.hash);
  const checked = await call(a, "prompts_check", { ...target, task_id: task.task_id });
  assert.equal(checked.ok, true, JSON.stringify(checked));
  const undone = await call(b, "prompts_undo", { ...target, task_id: task.task_id, expected_hash: saved.hash, change_id: saved.changeId });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(undone.hash, before.hash);
  assert.equal((await call(a, "prompts_check", { ...target, task_id: task.task_id })).ok, true);
  const ended = await call(a, "prompts_end", { task_id: task.task_id });
  assert.equal(ended.ok, true, JSON.stringify(ended));
  console.log(JSON.stringify({ ok: true, client: clientName, installedConnection: "codecaine-prompts", toolCount: listedTools.tools.length, realProject: actualProject.id, realPrompt: actualList.prompts[0].id, checks: ["real catalog read", "guidance loaded", "two-client saved revision visibility", "derived render", "stale revision rejection", "completion check", "guarded undo", "task end"], verifiedAt: new Date().toISOString() }, null, 2));
} finally {
  await Promise.all(clients.map(client => client.close()));
  await rm(fixture, { recursive: true, force: true });
}

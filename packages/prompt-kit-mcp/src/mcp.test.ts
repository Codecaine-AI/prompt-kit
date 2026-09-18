import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PACKAGE_ROOT } from "./lifecycle";

const clients: Client[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.close())); });

describe("stdio MCP bridge", () => {
  test("forwards real MCP tool and resource requests to the authenticated loopback daemon", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-mcp-protocol-"));
    const stateDir = join(root, "state");
    const token = "fixture-token";
    const requests: Array<{ workspace: string; name: string; arguments: Record<string, unknown> }> = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("Unauthorized", { status: 401 });
      const url = new URL(request.url);
      if (url.pathname === "/health") return Response.json({ service: "codecaine-prompts", pid: 456 });
      if (url.pathname === "/tools") return Response.json({ tools: [{ name: "prompts_discover", description: "Discover prompts", inputSchema: { type: "object", properties: {} } }, { name: "prompts_guidance", description: "Read guidance", inputSchema: { type: "object", properties: {} } }] });
      if (url.pathname === "/rpc") {
        const body = await request.json() as typeof requests[number]; requests.push(body);
        if (body.name === "prompts_guidance") return Response.json({ content: [{ type: "text", text: "serialized fallback" }], structuredContent: { ok: true, guidance: "# Prompt guidance\nPinned standards." } });
        return Response.json({ content: [{ type: "text", text: "discovered" }], structuredContent: { ok: true, workspace: body.workspace, projects: [] } });
      }
      return new Response("Not found", { status: 404 });
    }});
    try {
      await mkdir(stateDir);
      await writeFile(join(stateDir, "daemon.json"), JSON.stringify({ url: `http://127.0.0.1:${server.port}`, token, pid: 456, packageRoot: PACKAGE_ROOT, startedAt: new Date().toISOString() }));
      const client = new Client({ name: "prompt-protocol-test", version: "1.0.0" }); clients.push(client);
      const moduleUrl = pathToFileURL(join(PACKAGE_ROOT, "src/mcp.ts")).href;
      await client.connect(new StdioClientTransport({ command: process.execPath, args: ["-e", `import { startMcp } from ${JSON.stringify(moduleUrl)}; await startMcp(${JSON.stringify(root)});`], env: { ...process.env, CODECAINE_PROMPTS_STATE_DIR: stateDir } as Record<string, string> }));
      expect(client.getInstructions()).toContain("prompts_begin");
      expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(["prompts_discover", "prompts_guidance"]);
      const called = await client.callTool({ name: "prompts_discover", arguments: {} });
      expect(called.structuredContent).toMatchObject({ ok: true, workspace: root });
      const resources = await client.listResources();
      expect(resources.resources[0]?.uri).toBe("codecaine://prompts/guidance");
      const resource = await client.readResource({ uri: "codecaine://prompts/guidance" });
      expect((resource.contents[0] as { text: string }).text).toContain("Pinned standards");
      expect(requests.map(item => item.name)).toEqual(["prompts_discover", "prompts_guidance"]);
      expect(requests.every(item => item.workspace === root)).toBe(true);
    } finally { server.stop(true); await rm(root, { recursive: true, force: true }); }
  }, 15_000);
});

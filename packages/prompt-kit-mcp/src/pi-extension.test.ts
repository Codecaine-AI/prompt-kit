import { describe, expect, test } from "bun:test";
import { createPiExtension } from "./pi-extension";
import type { BridgeConnection, PiContext, PiExtensionAPI } from "./pi-extension";

describe("pi MCP bridge", () => {
  test("connects at session start, preserves schemas and arguments, closes at shutdown", async () => {
    const handlers = new Map<string, (event: Record<string, unknown>, ctx: PiContext) => Promise<unknown>>();
    const registered: Parameters<PiExtensionAPI["registerTool"]>[0][] = [];
    let closed = 0;
    let launchedCwd = "";
    let captured: unknown;
    const schema = { type: "object", properties: { project: { type: "string" } }, required: ["project"] };
    const client: BridgeConnection = {
      instructions: "Use prompts_begin before editing.",
      async listTools() { return { tools: [{ name: "prompts_begin", description: "Load guidance", inputSchema: schema }] }; },
      async callTool(params) { captured = params; return { content: [{ type: "text", text: "ready" }], structuredContent: { authoring_id: "task1" } }; },
      async close() { closed++; },
    };
    const pi: PiExtensionAPI = { on: (event, handler) => { handlers.set(event, handler); }, registerTool: (tool) => { registered.push(tool); } };
    createPiExtension({ command: "bun", args: ["cli.ts", "mcp"] }, async (_config, cwd) => { launchedCwd = cwd; return client; })(pi);
    expect(launchedCwd).toBe("");
    await handlers.get("session_start")!({}, { cwd: "/workspace" });
    expect(launchedCwd).toBe("/workspace");
    expect(registered[0]!.parameters).toBe(schema);
    expect(await registered[0]!.execute("id", { project: "docs" })).toEqual({ content: [{ type: "text", text: "ready" }], details: { authoring_id: "task1" } });
    expect(captured).toEqual({ name: "prompts_begin", arguments: { project: "docs" } });
    expect(await handlers.get("before_agent_start")!({ systemPrompt: "base" }, { cwd: "/workspace" })).toEqual({ systemPrompt: "base\n\nUse prompts_begin before editing." });
    await handlers.get("session_shutdown")!({}, { cwd: "/workspace" });
    await handlers.get("session_shutdown")!({}, { cwd: "/workspace" });
    expect(closed).toBe(1);
    await expect(registered[0]!.execute("id", {})).rejects.toThrow("disconnected");
  });
  test("MCP tool failures are errors in pi rather than successful text results", async () => {
    let start: ((event: Record<string, unknown>, ctx: PiContext) => Promise<unknown>) | undefined;
    let registered: Parameters<PiExtensionAPI["registerTool"]>[0] | undefined;
    createPiExtension({ command: "bun", args: [] }, async () => ({
      async listTools() { return { tools: [{ name: "prompts_write", inputSchema: { type: "object" } }] }; },
      async callTool() { return { isError: true, content: [{ type: "text", text: "Invalid structure" }] }; },
      async close() {},
    }))({ on: (event, handler) => { if (event === "session_start") start = handler; }, registerTool: (tool) => { registered = tool; } });
    await start!({}, { cwd: "/workspace" });
    await expect(registered!.execute("id", {})).rejects.toThrow("Invalid structure");
  });
});

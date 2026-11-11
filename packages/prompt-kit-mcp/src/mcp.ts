import { version } from "../package.json";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { identityFromEnv, newRunId } from "@codecaine-ai/action-log";
import { daemonFetch, ensureDaemon } from "./lifecycle";

export const MCP_INSTRUCTIONS = "Use prompts_discover for the active workspace. For prompt edits call prompts_begin, read its pinned standards, then prompts_read before typed operations with task_id and expected_hash. Valid edits save immediately. Run prompts_check with task_id before you report. Never rewrite prompt JSON or rendered Markdown directly.";

export async function startMcp(initialWorkspace: string) {
  const state = await ensureDaemon();
  const identity = { runId: newRunId(), ...identityFromEnv() };
  let workspace = resolve(initialWorkspace);
  let rootsReady: Promise<void> = Promise.resolve();
  const server = new Server({ name: "prompt-kit", version }, { capabilities: { tools: {}, resources: {} }, instructions: MCP_INSTRUCTIONS });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    await rootsReady;
    const response = await daemonFetch(state, "/rpc", { workspace, name, arguments: args, identity });
    if (!response.ok) throw new Error(`Prompt service error: ${response.status}`);
    const result = await response.json() as any;
    if (name === "prompts_discover" && !result.isError && typeof result.structuredContent?.workspace === "string") workspace = result.structuredContent.workspace;
    if (name === "prompts_capabilities" && !result.isError && typeof result.structuredContent?.scope?.workspace === "string") workspace = result.structuredContent.scope.workspace;
    return result;
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const response = await daemonFetch(state, "/tools");
    if (!response.ok) throw new Error("Prompt service unavailable");
    return response.json() as any;
  });
  server.setRequestHandler(CallToolRequestSchema, async request => call(request.params.name, request.params.arguments ?? {}));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: "codecaine://prompts/guidance", name: "prompt-authoring-guidance", description: "The guidance topic index: each topic with its size, its parts and the writes it unlocks. Read a topic with prompts_guidance.", mimeType: "application/json" }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== "codecaine://prompts/guidance") throw new Error("Unknown resource");
    const result = await call("prompts_guidance");
    if (result.isError) throw new Error(result.structuredContent?.detail ?? "Guidance unavailable");
    return { contents: [{ uri: request.params.uri, mimeType: "application/json", text: JSON.stringify(result.structuredContent, null, 2) }] };
  });
  const syncRoots = async () => {
    if (!server.getClientCapabilities()?.roots) return;
    try {
      const roots = await server.listRoots();
      const fileRoots = roots.roots.filter(root => root.uri.startsWith("file:"));
      if (fileRoots.length === 1) workspace = resolve(fileURLToPath(fileRoots[0]!.uri));
    } catch { /* explicit --workspace and prompts_discover remain available */ }
  };
  server.oninitialized = () => { rootsReady = syncRoots(); };
  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => { rootsReady = syncRoots(); await rootsReady; });
  await server.connect(new StdioServerTransport());
  return server;
}

import { version } from "../package.json";
/** pi has no built-in MCP client. This extension exposes the server's real schemas. */
export interface PiLaunchConfig { command: string; args: string[] }
interface ToolSchema { name: string; description?: string; inputSchema: Record<string, unknown> }
interface ToolResult { content: Array<Record<string, unknown>>; isError?: boolean; structuredContent?: unknown }
export interface BridgeConnection {
  listTools(params?: { cursor?: string }): Promise<{ tools: ToolSchema[]; nextCursor?: string }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }, options?: { signal?: AbortSignal }): Promise<ToolResult>;
  instructions?: string;
  close(): Promise<void>;
}
export interface PiContext { cwd: string; ui?: { notify(message: string, level?: "info" | "warning" | "error"): void } }
interface PiTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(id: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: unknown, ctx?: PiContext): Promise<{ content: Array<Record<string, unknown>>; details: unknown }>;
}
/** Structural types keep the bridge independent of pi's package rename/version. */
export interface PiExtensionAPI {
  on(event: "session_start" | "session_shutdown" | "before_agent_start", callback: (event: Record<string, unknown>, ctx: PiContext) => Promise<unknown>): void;
  registerTool(tool: PiTool): void;
}

async function connect(config: PiLaunchConfig, cwd: string): Promise<BridgeConnection> {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);
  const transport = new StdioClientTransport({ command: config.command, args: [...config.args, "--workspace", cwd], cwd, stderr: "inherit" });
  const client = new Client({ name: "codecaine-pi", version });
  try {
    await client.connect(transport, { timeout: 30_000 });
    return {
      listTools: (params) => client.listTools(params),
      callTool: async (params, options) => await client.callTool(params, undefined, { signal: options?.signal, timeout: 120_000 }) as ToolResult,
      instructions: client.getInstructions(),
      close: () => client.close(),
    };
  } catch (error) {
    await transport.close();
    throw error;
  }
}

export function createPiExtension(config: PiLaunchConfig, connectClient = connect) {
  return (pi: PiExtensionAPI) => {
    let connection: BridgeConnection | undefined;
    let instructions = "";
    const close = async () => {
      const previous = connection;
      connection = undefined;
      instructions = "";
      await previous?.close();
    };
    // Factories also run without a session. Start processes only after session_start.
    pi.on("session_start", async (_event, ctx) => {
      await close();
      try {
        connection = await connectClient(config, ctx.cwd);
        instructions = connection.instructions ?? "";
        let cursor: string | undefined;
        const seenCursors = new Set<string>();
        do {
          const page = await connection.listTools(cursor ? { cursor } : undefined);
          for (const tool of page.tools) {
            pi.registerTool({
              name: tool.name,
              label: `Codecaine ${tool.name}`,
              description: tool.description ?? tool.name,
              parameters: tool.inputSchema,
              async execute(_id, params, signal) {
                if (!connection) throw new Error("Codecaine Prompts is disconnected. Run /reload to reconnect.");
                const result = await connection.callTool({ name: tool.name, arguments: params }, { signal });
                const content = result.content.map((item) => item.type === "text" || item.type === "image" ? item : { type: "text", text: JSON.stringify(item) });
                if (result.isError) throw new Error(content.map((item) => item.text ?? JSON.stringify(item)).join("\n"));
                return { content, details: result.structuredContent ?? {} };
              },
            });
          }
          cursor = page.nextCursor;
          if (cursor && seenCursors.has(cursor)) throw new Error("Codecaine returned a repeated tools cursor");
          if (cursor) seenCursors.add(cursor);
        } while (cursor);
      } catch (error) {
        await close();
        ctx.ui?.notify(`Codecaine Prompts connection failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        throw error;
      }
    });
    pi.on("before_agent_start", async (event) => instructions ? { systemPrompt: `${event.systemPrompt ?? ""}\n\n${instructions}` } : undefined);
    pi.on("session_shutdown", async () => { await close(); });
  };
}

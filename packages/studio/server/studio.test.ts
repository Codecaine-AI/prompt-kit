import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { createRemoteAnnotationStore } from "@codecaine-ai/prompt-kit/annotations";
import { stopDaemon } from "../../prompt-kit-mcp/src/lifecycle";

/**
 * Starts the real studio (its Vite dev server and vite.config.ts) on a temp
 * catalog, with a real Prompt service in a temp state folder. The studio
 * starts the service itself, as it does for Ford.
 */
const STUDIO_DIR = resolve(import.meta.dir, "..");
const previousEnv = { ...process.env };
let workspace: string;
let stateDir: string;
let studio: ViteDevServer;
let origin: string;
const promptPath = "catalog/fixture/prompt/prompt.json";

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "prompt-studio-workspace-"));
  stateDir = await mkdtemp(join(tmpdir(), "prompt-studio-state-"));
  await mkdir(join(workspace, "catalog", "fixture", "prompt"), { recursive: true });
  await writeFile(join(workspace, "codecaine.prompts.json"), JSON.stringify({ name: "fixture-project", catalogRoots: ["catalog"] }));
  await writeFile(join(workspace, "catalog", "fixture", "agent.json"), JSON.stringify({ variables: {} }));
  await writeFile(join(workspace, promptPath), JSON.stringify({
    kind: "prompt", schemaVersion: "prompt-kit/v1", id: "fixture",
    nodes: [{ type: "paragraph", id: "body", content: ["Say hello."] }],
  }));
  const port = await freePort();
  process.env.CODECAINE_PROMPTS_STATE_DIR = stateDir;
  process.env.PROMPT_KIT_STUDIO_WORKSPACE = workspace;
  process.env.PROMPT_KIT_STUDIO_PORT = String(port);
  studio = await createServer({ configFile: join(STUDIO_DIR, "vite.config.ts"), logLevel: "silent" });
  await studio.listen();
  origin = `http://127.0.0.1:${port}`;
}, 30_000);

afterAll(async () => {
  await studio?.close();
  await stopDaemon().catch(() => {});
  process.env = previousEnv;
  await Bun.sleep(150);
  await rm(workspace, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
});

const fixtureEntry = async () => {
  const { prompts } = (await (await fetch(`${origin}/api/studio/prompts`)).json()) as { prompts: Array<{ key: string; root: string; promptPath: string }> };
  return prompts[0]!;
};

test("a request filed through the studio comes back after a fresh load, and resolves", async () => {
  const entry = await fixtureEntry();
  expect(entry.promptPath).toBe(promptPath);
  const loaded = (await (await fetch(`${origin}/api/studio/prompt?key=${encodeURIComponent(entry.key)}`)).json()) as { document: { id: string } };
  expect(loaded.document.id).toBe("fixture");

  const errors: Error[] = [];
  const options = { baseUrl: origin, promptPath, root: entry.root, onError: (error: Error) => errors.push(error) };
  const filing = createRemoteAnnotationStore(options);
  await filing.load();
  const filed = filing.add({ target: { kind: "prompt-node", docId: "fixture", nodeId: "body" } as never, body: "Say goodbye.", intent: "agent-request" as never, author: "ford" });
  await filing.flush();

  // A new store is what the page builds after a reload.
  const reloaded = createRemoteAnnotationStore(options);
  await reloaded.load();
  expect(reloaded.list().map(({ id, body, status }) => ({ id, body, status }))).toEqual([{ id: filed.id, body: "Say goodbye.", status: "open" }]);

  reloaded.resolve(filed.id, "Done.");
  await reloaded.flush();
  const again = createRemoteAnnotationStore(options);
  await again.load();
  expect(again.list()[0]).toMatchObject({ id: filed.id, status: "resolved", resolution: "Done." });
  expect(errors).toEqual([]);
}, 20_000);

test("the event stream reaches the page frame by frame through the proxy", async () => {
  const entry = await fixtureEntry();
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/events`, { signal: controller.signal });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const nextFrame = async () => decoder.decode((await reader.read()).value);
  try {
    // The stream is still open: a buffering proxy would hold this frame until the end.
    expect(await nextFrame()).toContain("event: connected");
    const store = createRemoteAnnotationStore({ baseUrl: origin, promptPath, root: entry.root });
    store.add({ target: { kind: "prompt-node", docId: "fixture", nodeId: "body" } as never, body: "Live?", intent: "agent-request" as never, author: "ford" });
    let text = "";
    while (!text.includes('"change":"created"')) text += await nextFrame();
    expect(text).toContain(promptPath);
    await store.flush();
  } finally {
    controller.abort();
  }
}, 20_000);

test("the proxy serves only the studio's own page and catalog", async () => {
  const entry = await fixtureEntry();
  const list = (root: string, headers: Record<string, string> = {}) =>
    fetch(`${origin}/api/annotations?path=${encodeURIComponent(promptPath)}&root=${encodeURIComponent(root)}`, { headers });
  expect((await list(entry.root)).status).toBe(200);
  expect((await list(entry.root, { origin: "http://evil.example" })).status).toBe(403);
  expect((await list(tmpdir())).status).toBe(403);
});

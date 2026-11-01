import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { discoverPromptProjects, ensureDaemon } from "@codecaine-ai/prompt-kit-mcp";
import { createPromptStore } from "@codecaine-ai/prompt-kit-server";

/**
 * The studio's server half, a connect-style middleware that Vite mounts in
 * dev and preview (vite.config.ts):
 *
 *   GET /api/studio/prompts             the workspace catalog
 *   GET /api/studio/prompt?key=         one prompt's document
 *   *   /api/annotations*, /api/events  piped to the Prompt service
 *
 * The browser cannot call the Prompt service itself: the service wants its
 * bearer token and refuses other origins. The proxy adds the token here, on
 * the server, so it never reaches the page or a log. Bodies stream both ways
 * with no buffering, so the SSE event stream passes through live.
 */

export type PromptService = { url: string; token: string };

export type StudioApiOptions = {
  /** Folder whose Prompt Kit catalog the studio lists. */
  workspace: string;
  /** Finds the running Prompt service. Defaults to starting it if needed. */
  service?: () => Promise<PromptService>;
};

export type StudioPrompt = {
  /** `<projectId>/<promptId>`: the page route and the lookup key. */
  key: string;
  projectId: string;
  projectName: string;
  /** Absolute project root: the annotation routes' `root` parameter. */
  root: string;
  id: string;
  title: string;
  promptPath: string;
  declaredVariables: string[];
};

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

const PROXY_PATH = /^\/api\/(?:annotations(?:\/[^?]*)?|events)(?:\?|$)/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function createStudioApi(options: StudioApiOptions): Middleware {
  const service = options.service ?? ensureDaemon;

  async function catalog(): Promise<StudioPrompt[]> {
    const discovery = await discoverPromptProjects(options.workspace);
    return discovery.projects.flatMap((project) => project.prompts.map((prompt) => ({
      key: `${project.id}/${prompt.id}`,
      projectId: project.id,
      projectName: project.name,
      root: project.root,
      id: prompt.id,
      title: prompt.title,
      promptPath: prompt.target.promptPath,
      declaredVariables: prompt.target.declaredVariables ?? [],
    })));
  }

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (url.pathname === "/api/studio/prompts" && req.method === "GET") {
      return json(res, 200, { workspace: options.workspace, prompts: await catalog() });
    }
    if (url.pathname === "/api/studio/prompt" && req.method === "GET") {
      const entry = (await catalog()).find((prompt) => prompt.key === url.searchParams.get("key"));
      if (!entry) return json(res, 404, { detail: "prompt not found in the catalog" });
      const read = await createPromptStore({ root: entry.root }).read({ promptPath: entry.promptPath, declaredVariables: entry.declaredVariables });
      if (!read.ok) return json(res, 422, { detail: read.detail });
      return json(res, 200, { ...entry, document: read.document, hash: read.hash });
    }
    // The service serves any absolute root. The studio passes on only its own catalog's roots.
    const root = url.searchParams.get("root");
    if (url.pathname !== "/api/events" && !(await catalog()).some((prompt) => prompt.root === root)) {
      return json(res, 403, { detail: "root is not a project in the studio's catalog" });
    }
    let target: PromptService;
    try {
      target = await service();
    } catch (error) {
      return json(res, 502, { detail: `Prompt service is not available: ${error instanceof Error ? error.message : String(error)}` });
    }
    proxy(req, res, target);
  }

  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://studio.local");
    const isStudio = url.pathname.startsWith("/api/studio/");
    if (!isStudio && !PROXY_PATH.test(url.pathname + url.search)) return next();
    // The proxy holds the token, so only the studio's own page may use it.
    if (!sameOrigin(req)) return json(res, 403, { detail: "Forbidden origin" });
    handle(req, res, url).catch((error: unknown) => {
      if (res.headersSent) res.destroy();
      else json(res, 500, { detail: error instanceof Error ? error.message : String(error) });
    });
  };
}

/** A local Host header (no DNS rebinding) and, when present, an Origin that matches it. */
function sameOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const hostname = new URL(`http://${host}`).hostname;
  if (!LOCAL_HOSTS.has(hostname)) return false;
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${host}`;
}

function proxy(req: IncomingMessage, res: ServerResponse, service: PromptService): void {
  const upstream = new URL(req.url ?? "/", service.url);
  // Forward only what the routes read: never the browser's cookies, Origin or Host.
  const headers: Record<string, string> = { authorization: `Bearer ${service.token}`, accept: req.headers.accept ?? "*/*" };
  if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
  if (req.headers["content-length"]) headers["content-length"] = req.headers["content-length"];
  const proxyReq = httpRequest(upstream, { method: req.method, headers }, (proxyRes) => {
    const out: Record<string, string> = {};
    for (const name of ["content-type", "cache-control"]) {
      const value = proxyRes.headers[name];
      if (typeof value === "string") out[name] = value;
    }
    res.writeHead(proxyRes.statusCode ?? 502, out);
    // SSE: the headers go out now, then each frame as it arrives.
    res.flushHeaders();
    proxyRes.pipe(res);
  });
  proxyReq.on("error", () => {
    if (res.headersSent) res.destroy();
    else json(res, 502, { detail: "Prompt service is not reachable" });
  });
  // The page closed or the EventSource disconnected: close the upstream too.
  res.on("close", () => proxyReq.destroy());
  req.pipe(proxyReq);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

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

const STUDIO_PATHS = new Set(["/api/studio/prompts", "/api/studio/prompt"]);
/** The Prompt service's annotation and event routes (annotation-routes.ts), and nothing else. */
const PROXY_PATH = /^\/api\/(?:events|annotations(?:\/([A-Za-z0-9._~%-]+)\/(?:replies|resolve|thread))?)$/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

type Route = { kind: "studio" | "proxy"; path: string; search: string };

/**
 * Reads the raw request target, before any URL parser can resolve `..` or
 * take a host from it. Only an origin-form target (`/path?query`) passes:
 * `//host/...` and `http://host/...` would otherwise name the upstream host.
 * Answers "reject" for any other target under /api/, and undefined for a
 * path that is not the studio's (Vite serves it).
 */
function route(target: string): Route | "reject" | undefined {
  if (!target.startsWith("/") || target.startsWith("//")) return "reject";
  const query = target.indexOf("?");
  const path = query === -1 ? target : target.slice(0, query);
  const search = query === -1 ? "" : target.slice(query);
  if (!path.startsWith("/api/")) return undefined;
  if (STUDIO_PATHS.has(path)) return { kind: "studio", path, search };
  const match = PROXY_PATH.exec(path);
  if (!match) return "reject";
  if (match[1] !== undefined && !isPlainSegment(match[1])) return "reject";
  return { kind: "proxy", path, search };
}

/** An annotation id that decodes to one ordinary path segment: never `.`, `..` or a slash. */
function isPlainSegment(raw: string): boolean {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    return false;
  }
  return id !== "." && id !== ".." && !/[/\\]/.test(id);
}

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

  async function handle(req: IncomingMessage, res: ServerResponse, target: Route): Promise<void> {
    const url = new URL(target.path + target.search, "http://studio.local");
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
    if (target.kind === "studio") return json(res, 405, { detail: "method not allowed" });
    // The service serves any absolute root. The studio passes on only its own catalog's roots.
    const root = url.searchParams.get("root");
    if (url.pathname !== "/api/events" && !(await catalog()).some((prompt) => prompt.root === root)) {
      return json(res, 403, { detail: "root is not a project in the studio's catalog" });
    }
    let upstream: PromptService;
    try {
      upstream = await service();
    } catch (error) {
      return json(res, 502, { detail: `Prompt service is not available: ${error instanceof Error ? error.message : String(error)}` });
    }
    // The service's own origin is the only host: the request contributes just the checked path and query.
    proxy(req, res, upstream, new URL(`${new URL(upstream.url).origin}${target.path}${target.search}`));
  }

  return (req, res, next) => {
    const target = route(req.url ?? "/");
    if (target === undefined) return next();
    if (target === "reject") return json(res, 404, { detail: "Not found" });
    // The proxy holds the token, so only the studio's own page may use it.
    if (!sameOrigin(req)) return json(res, 403, { detail: "Forbidden origin" });
    handle(req, res, target).catch((error: unknown) => {
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

function proxy(req: IncomingMessage, res: ServerResponse, service: PromptService, upstream: URL): void {
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

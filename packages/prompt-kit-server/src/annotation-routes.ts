import {
  subscribeToPromptAnnotationEvents,
  type PromptAnnotationEvent,
  type PromptAnnotationFileStore,
  type PromptAnnotationMutationResult,
  type PromptAnnotationsResult,
} from "./annotations";

/**
 * Framework-free HTTP routes over the prompt annotation store, mountable in
 * any `fetch(request)` host. The Prompt UI's remote annotation store speaks
 * this API, and `GET /api/events` streams `PromptAnnotationEvent`s as SSE for
 * a dispatcher, mirroring docs-server's `/api/events`.
 *
 *   GET  /api/annotations?path=                      -> { path, annotations, hash }
 *   POST /api/annotations?path=                      -> 201 { annotation, annotations, hash }
 *   POST /api/annotations/:id/replies?path=          -> { annotation, reply, annotations, hash }
 *   POST /api/annotations/:id/resolve?path=          -> { annotation, annotations, hash }
 *   PUT  /api/annotations/:id/thread?path=           -> { annotation, annotations, hash }
 *   GET  /api/events                                 -> text/event-stream
 *
 * Every write body takes an optional `expected_hash`; a stale hash answers
 * 409 with `current_hash`. Unmatched requests resolve to undefined so the
 * host can continue its own routing.
 */
export function createPromptAnnotationRoutes(
  /** Picks the store for a request. Throw to answer 400 (for example, a missing root). */
  storeFor: (url: URL) => PromptAnnotationFileStore,
  options: { keepaliveMs?: number } = {},
): (request: Request) => Promise<Response | undefined> {
  const keepaliveMs = options.keepaliveMs ?? 30_000;
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/events" && request.method === "GET") return eventStream(request, keepaliveMs);
    const match = /^\/api\/annotations(?:\/([^/]+)\/(replies|resolve|thread))?$/.exec(url.pathname);
    if (!match) return undefined;
    const [, rawId, action] = match;
    const id = rawId === undefined ? undefined : decodeURIComponent(rawId);
    let store: PromptAnnotationFileStore;
    let body: Record<string, unknown> = {};
    const path = url.searchParams.get("path");
    try {
      if (!path) throw new Error("path query parameter is required");
      store = storeFor(url);
      if (request.method !== "GET") body = await jsonBody(request);
    } catch (error) {
      return Response.json({ detail: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
    const expectedHash = optionalString(body.expected_hash);
    if (!action && request.method === "GET") return respond(await store.list(path));
    if (!action && request.method === "POST") {
      return respond(await store.add(path, {
        id: optionalString(body.id), target: body.target, body: String(body.body ?? ""),
        intent: String(body.intent ?? ""), author: String(body.author ?? ""), expectedHash,
      }), 201);
    }
    if (action === "replies" && request.method === "POST") {
      return respond(await store.reply(path, id!, {
        id: optionalString(body.id), body: String(body.body ?? ""), author: optionalString(body.author) ?? "anonymous", expectedHash,
      }));
    }
    if (action === "resolve" && request.method === "POST") {
      return respond(await store.resolve(path, id!, {
        resolution: optionalString(body.resolution), actor: optionalString(body.actor), expectedHash,
      }));
    }
    if (action === "thread" && request.method === "PUT") {
      if (!("thread" in body)) return Response.json({ detail: "thread is required; send null to clear it" }, { status: 400 });
      return respond(await store.setThread(path, id!, {
        thread: body.thread as never, actor: optionalString(body.actor), expectedHash,
      }));
    }
    return Response.json({ detail: "method not allowed" }, { status: 405 });
  };
}

function respond(result: PromptAnnotationsResult | PromptAnnotationMutationResult, okStatus = 200): Response {
  if (!result.ok) {
    return Response.json(
      { detail: result.detail, code: result.code, ...(result.currentHash ? { current_hash: result.currentHash } : {}), ...(result.issues ? { issues: result.issues } : {}) },
      { status: result.status },
    );
  }
  const { ok: _ok, ...payload } = result;
  return Response.json(payload, { status: okStatus });
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("request body must be a JSON object");
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * One SSE connection. The `connected` frame flushes headers at once, a named
 * `keepalive` frame holds idle connections open, and each annotation event is
 * an unnamed `data:` frame of JSON, so `EventSource.onmessage` sees only events.
 */
function eventStream(request: Request, keepaliveMs: number): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (frame: string) => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = subscribeToPromptAnnotationEvents((event: PromptAnnotationEvent) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      const timer = setInterval(() => send("event: keepalive\ndata: ok\n\n"), keepaliveMs);
      cleanup = () => {
        clearInterval(timer);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      send("event: connected\ndata: ok\n\n");
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}

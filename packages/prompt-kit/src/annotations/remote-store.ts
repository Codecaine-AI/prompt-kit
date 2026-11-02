/**
 * A `PromptAnnotationStore` backed by prompt-kit-server's annotation routes
 * (`createPromptAnnotationRoutes`). Pass it to `PromptInlineLab` as
 * `annotationStore` so filed requests are saved on the server and come back
 * after a reload. Writes apply locally first, so the store keeps the
 * synchronous contract the lab expects, then go to the server in order. When
 * the queue drains, the server's document replaces the local one. A failed
 * write reports through `onError`, and the server's state is reloaded once
 * no other write is queued.
 */

import type { AnnotationReply, PromptAnnotation, PromptAnnotationsDocument } from "./schema";
import type { PromptAnnotationStore } from "./store";

export type RemoteAnnotationStoreOptions = {
  /** Origin (and optional prefix) that serves `/api/annotations`. */
  baseUrl: string;
  /** The prompt's catalog path relative to the project root. */
  promptPath: string;
  /** Project root, for hosts that serve several projects (the Prompt service). */
  root?: string;
  /** Extra request headers, for example the Prompt service's bearer token. */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  onError?: (error: Error) => void;
};

export type RemotePromptAnnotationStore = PromptAnnotationStore & {
  /** Replaces local state with the server's annotations for this prompt. */
  load(): Promise<void>;
  /** Resolves when every queued write has reached the server. */
  flush(): Promise<void>;
};

export function createRemoteAnnotationStore(
  options: RemoteAnnotationStoreOptions,
): RemotePromptAnnotationStore {
  const fetcher = options.fetch ?? fetch;
  let doc: PromptAnnotationsDocument = { schemaVersion: 1, annotations: [] };
  const listeners = new Set<() => void>();
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  /** Counts local writes, so a load that started before one can drop its stale result. */
  let writes = 0;

  function commit(annotations: PromptAnnotation[]): void {
    doc = { schemaVersion: 1, annotations };
    for (const listener of [...listeners]) listener();
  }

  function url(suffix = ""): string {
    const query = new URLSearchParams({ path: options.promptPath });
    if (options.root) query.set("root", options.root);
    return `${options.baseUrl.replace(/\/$/, "")}/api/annotations${suffix}?${query}`;
  }

  async function request(method: string, suffix: string, body?: unknown): Promise<{ annotations: PromptAnnotation[] }> {
    const response = await fetcher(url(suffix), {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...options.headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json().catch(() => ({}))) as { annotations?: PromptAnnotation[]; detail?: string };
    if (!response.ok || !Array.isArray(payload.annotations)) {
      throw new Error(payload.detail ?? `annotation request failed: ${response.status}`);
    }
    return { annotations: payload.annotations };
  }

  /** Adopts the server state unless a write was queued while the GET was in flight. */
  async function refresh(): Promise<void> {
    const started = writes;
    const { annotations } = await request("GET", "");
    if (writes === started) commit(annotations);
  }

  /** Waits for queued writes to land, including ones queued while it waited, then adopts the server state. */
  async function load(): Promise<void> {
    let waited: Promise<void>;
    do {
      waited = queue;
      await waited.catch(() => {});
    } while (waited !== queue);
    await refresh();
  }

  /** Queues one write; adopts the server state once nothing else is pending. */
  function send(method: string, suffix: string, body: unknown): void {
    pending += 1;
    writes += 1;
    queue = queue
      .then(async () => {
        const result = await request(method, suffix, body);
        if (pending === 1) commit(result.annotations);
      })
      .catch(async (error: unknown) => {
        options.onError?.(error instanceof Error ? error : new Error(String(error)));
        // A later queued write adopts the server state itself; reloading now would drop it locally.
        if (pending === 1) await refresh().catch(() => {});
      })
      .finally(() => {
        pending -= 1;
      });
  }

  function replace(id: string, updated: PromptAnnotation): void {
    commit(doc.annotations.map((annotation) => (annotation.id === id ? updated : annotation)));
  }

  return {
    load,
    flush: () => queue,
    add(input) {
      const annotation: PromptAnnotation = {
        id: crypto.randomUUID(),
        target: input.target,
        body: input.body,
        intent: input.intent,
        author: input.author,
        status: "open",
        createdAt: new Date().toISOString(),
      };
      commit([...doc.annotations, annotation]);
      send("POST", "", { id: annotation.id, target: input.target, body: input.body, intent: input.intent, author: input.author });
      return annotation;
    },
    resolve(id, resolution) {
      const existing = doc.annotations.find((annotation) => annotation.id === id);
      if (!existing) return undefined;
      const updated: PromptAnnotation = { ...existing, status: "resolved", ...(resolution !== undefined ? { resolution } : {}) };
      replace(id, updated);
      send("POST", `/${encodeURIComponent(id)}/resolve`, resolution !== undefined ? { resolution } : {});
      return updated;
    },
    addReply(annotationId, input) {
      const existing = doc.annotations.find((annotation) => annotation.id === annotationId);
      if (!existing) return undefined;
      const reply: AnnotationReply = { id: crypto.randomUUID(), author: input.author, body: input.body, createdAt: new Date().toISOString() };
      replace(annotationId, { ...existing, replies: [...(existing.replies ?? []), reply] });
      send("POST", `/${encodeURIComponent(annotationId)}/replies`, { id: reply.id, author: input.author, body: input.body });
      return reply;
    },
    list: () => doc.annotations,
    document: () => doc,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

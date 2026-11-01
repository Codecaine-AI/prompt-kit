import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRemoteAnnotationStore } from "@codecaine-ai/prompt-kit/annotations";
import {
  createPromptAnnotationFileStore,
  createPromptAnnotationRoutes,
  type PromptAnnotationEvent,
} from "../src";

const PROMPT_PATH = "catalog/editor/prompt/prompt.json";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "prompt-annotations-test-"));
  roots.push(root);
  await mkdir(join(root, "catalog/editor/prompt"), { recursive: true });
  await writeFile(join(root, PROMPT_PATH), "{}\n");
  return root;
}

/** A fresh server process: a new store and routes over the same root. */
function serve(root: string) {
  const store = createPromptAnnotationFileStore({ root });
  const routes = createPromptAnnotationRoutes(() => store, { keepaliveMs: 60_000 });
  const fetchRoute = async (input: string, init?: RequestInit) => {
    const response = await routes(new Request(input, init));
    return response ?? new Response("Not found", { status: 404 });
  };
  return { store, routes, fetch: fetchRoute as typeof fetch };
}

const api = (suffix = "") => `http://prompt.test/api/annotations${suffix}?path=${encodeURIComponent(PROMPT_PATH)}`;
const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const request = {
  target: { kind: "prompt-node", docId: "editor", nodeId: "intro" },
  body: "Tighten the opening.",
  intent: "agent-request",
  author: "ford",
};

describe("prompt annotation store", () => {
  test("a request filed over HTTP survives a server restart", async () => {
    const root = await fixture();
    const first = serve(root);
    const created = await first.fetch(api(), json("POST", request));
    expect(created.status).toBe(201);
    const { annotation } = (await created.json()) as { annotation: { id: string } };

    const second = serve(root);
    const listed = await second.fetch(api());
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { path: string; annotations: Array<Record<string, unknown>>; hash: string };
    expect(body.path).toBe(PROMPT_PATH);
    expect(body.annotations).toEqual([
      expect.objectContaining({ id: annotation.id, body: request.body, intent: "agent-request", status: "open", target: request.target }),
    ]);
    const sidecar = JSON.parse(await readFile(join(root, "catalog/editor/prompt/.prompt-kit/annotations/prompt.annotations.json"), "utf8"));
    expect(sidecar.annotations[0].id).toBe(annotation.id);
  });

  test("the thread route sets and clears the binding, and the binding persists", async () => {
    const root = await fixture();
    const server = serve(root);
    const { annotation } = (await (await server.fetch(api(), json("POST", request))).json()) as { annotation: { id: string } };
    const set = await server.fetch(api(`/${annotation.id}/thread`), json("PUT", { thread: { id: "thread-1", title: "Editor prompt" } }));
    expect(set.status).toBe(200);

    const reopened = await serve(root).store.list(PROMPT_PATH);
    expect(reopened.ok && reopened.annotations[0]!.thread).toEqual({ id: "thread-1", title: "Editor prompt" });

    const cleared = await server.fetch(api(`/${annotation.id}/thread`), json("PUT", { thread: null }));
    expect(((await cleared.json()) as { annotation: Record<string, unknown> }).annotation.thread).toBeUndefined();
    const invalid = await server.fetch(api(`/${annotation.id}/thread`), json("PUT", { thread: { title: "no id" } }));
    expect(invalid.status).toBe(422);
  });

  test("writes reject a stale expected_hash, an unknown prompt, and an unknown annotation", async () => {
    const root = await fixture();
    const server = serve(root);
    const created = (await (await server.fetch(api(), json("POST", request))).json()) as { annotation: { id: string }; hash: string };
    await server.fetch(api(`/${created.annotation.id}/replies`), json("POST", { body: "On it.", author: "agent" }));
    const stale = await server.fetch(api(`/${created.annotation.id}/resolve`), json("POST", { expected_hash: created.hash }));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { current_hash?: string }).current_hash).toStartWith("pka1-");
    expect((await server.store.list("catalog/missing/prompt.json")).ok).toBe(false);
    expect((await server.fetch(api("/nope/resolve"), json("POST", {}))).status).toBe(404);
  });

  test("the event stream names each annotation created or changed", async () => {
    const root = await fixture();
    const server = serve(root);
    const abort = new AbortController();
    const stream = await server.routes(new Request("http://prompt.test/api/events", { signal: abort.signal }));
    expect(stream!.headers.get("content-type")).toBe("text/event-stream");
    const reader = stream!.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const nextFrame = async (): Promise<string> => {
      while (!buffer.includes("\n\n")) buffer += decoder.decode((await reader.read()).value);
      const end = buffer.indexOf("\n\n");
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      return frame;
    };
    expect(await nextFrame()).toBe("event: connected\ndata: ok");

    const { annotation } = (await (await server.fetch(api(), json("POST", request))).json()) as { annotation: { id: string } };
    const created = JSON.parse((await nextFrame()).replace(/^data: /, "")) as PromptAnnotationEvent;
    expect(created).toMatchObject({
      root, path: PROMPT_PATH, annotationId: annotation.id, change: "created",
      intent: "agent-request", status: "open", thread: null, actor: "ford",
    });

    await server.fetch(api(`/${annotation.id}/thread`), json("PUT", { thread: { id: "thread-1" }, actor: "dispatcher" }));
    const bound = JSON.parse((await nextFrame()).replace(/^data: /, "")) as PromptAnnotationEvent;
    expect(bound).toMatchObject({ annotationId: annotation.id, change: "thread", thread: { id: "thread-1" }, actor: "dispatcher" });
    abort.abort();
    await reader.cancel().catch(() => {});
  });
});

describe("Prompt UI remote annotation store", () => {
  test("a request filed through the UI store comes back after a reload", async () => {
    const root = await fixture();
    const before = serve(root);
    const errors: Error[] = [];
    const page = createRemoteAnnotationStore({ baseUrl: "http://prompt.test", promptPath: PROMPT_PATH, fetch: before.fetch, onError: (error) => errors.push(error) });
    await page.load();
    const filed = page.add({ target: request.target as never, body: request.body, intent: "agent-request", author: "ford" });
    page.addReply(filed.id, { author: "ford", body: "Keep the scope sentence." });
    expect(page.list().map((entry) => entry.id)).toEqual([filed.id]);
    await page.flush();
    expect(errors).toEqual([]);

    const reloaded = createRemoteAnnotationStore({ baseUrl: "http://prompt.test", promptPath: PROMPT_PATH, fetch: serve(root).fetch });
    expect(reloaded.list()).toEqual([]);
    await reloaded.load();
    expect(reloaded.list()).toEqual([
      expect.objectContaining({ id: filed.id, body: request.body, status: "open", replies: [expect.objectContaining({ body: "Keep the scope sentence." })] }),
    ]);
  });
});

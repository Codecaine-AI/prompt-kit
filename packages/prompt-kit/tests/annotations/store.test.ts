import { describe, expect, test } from "bun:test";

import { createAnnotationStore } from "../../src/annotations/store";
import { promptAnnotationSchema, type PromptNodeTarget } from "../../src/annotations/schema";

const target: PromptNodeTarget = {
  kind: "prompt-node",
  docId: "prompt-doc-1",
  nodeId: "node-section-1",
};

describe("createAnnotationStore", () => {
  test("starts empty and adds open annotations with generated fields", () => {
    const store = createAnnotationStore();
    expect(store.list()).toEqual([]);
    expect(store.document()).toEqual({ schemaVersion: 1, annotations: [] });

    const added = store.add({
      target,
      body: "Tighten this section.",
      intent: "agent-request",
      author: "ford",
    });

    expect(added.id.length).toBeGreaterThan(0);
    expect(added.status).toBe("open");
    expect(Number.isNaN(Date.parse(added.createdAt))).toBe(false);
    expect(store.list()).toEqual([added]);

    // Generated fields satisfy the engine schema (id pattern, createdAt).
    const result = promptAnnotationSchema.validateDocument(store.document());
    expect(result.ok).toBe(true);
  });

  test("seeds from an initial document without mutating it", () => {
    const initial = {
      schemaVersion: 1 as const,
      annotations: [
        {
          id: "ann-1",
          target,
          body: "Existing",
          intent: "note",
          author: "ford",
          status: "open",
          createdAt: "2026-07-30T00:00:00.000Z",
        },
      ],
    };
    const store = createAnnotationStore(initial);
    expect(store.list()).toEqual(initial.annotations);

    store.add({ target, body: "New", intent: "note", author: "ford" });
    expect(initial.annotations).toHaveLength(1);
    expect(store.list()).toHaveLength(2);
  });

  test("resolve marks the annotation resolved and persists the resolution", () => {
    const store = createAnnotationStore();
    const added = store.add({
      target,
      body: "Fix wording",
      intent: "agent-request",
      author: "ford",
    });

    const resolved = store.resolve(added.id, "Reworded.");
    expect(resolved).toMatchObject({
      id: added.id,
      status: "resolved",
      resolution: "Reworded.",
    });
    expect(store.list()[0]).toEqual(resolved!);
  });

  test("resolve without a resolution note omits the field", () => {
    const store = createAnnotationStore();
    const added = store.add({
      target,
      body: "Fix wording",
      intent: "note",
      author: "ford",
    });
    const resolved = store.resolve(added.id);
    expect(resolved?.status).toBe("resolved");
    expect(resolved && "resolution" in resolved).toBe(false);
  });

  test("resolve returns undefined for unknown ids and does not notify", () => {
    const store = createAnnotationStore();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    expect(store.resolve("missing")).toBeUndefined();
    expect(calls).toBe(0);
  });

  test("subscribe notifies on add and resolve; unsubscribe stops notifications", () => {
    const store = createAnnotationStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    const added = store.add({
      target,
      body: "Note",
      intent: "note",
      author: "ford",
    });
    expect(calls).toBe(1);

    store.resolve(added.id);
    expect(calls).toBe(2);

    unsubscribe();
    store.add({ target, body: "Another", intent: "note", author: "ford" });
    expect(calls).toBe(2);
  });

  test("addReply appends a generated reply immutably and notifies", () => {
    const store = createAnnotationStore();
    const added = store.add({
      target,
      body: "Make this stricter.",
      intent: "agent-request",
      author: "ford",
    });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    const before = store.document();

    const reply = store.addReply(added.id, {
      author: "agent",
      body: "Tightened it — anything else?",
    });

    expect(reply).toBeTruthy();
    expect(reply!.id.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(reply!.createdAt))).toBe(false);
    expect(reply).toMatchObject({
      author: "agent",
      body: "Tightened it — anything else?",
    });
    expect(calls).toBe(1);
    // Immutable append: new snapshot, prior snapshot untouched.
    expect(store.document()).not.toBe(before);
    expect(before.annotations[0].replies).toBeUndefined();
    expect(store.list()[0].replies).toEqual([reply!]);
    // Generated reply fields satisfy the engine schema.
    expect(promptAnnotationSchema.validateDocument(store.document()).ok).toBe(
      true,
    );

    const second = store.addReply(added.id, {
      author: "you",
      body: "One more pass, please.",
    });
    expect(store.list()[0].replies).toEqual([reply!, second!]);
  });

  test("addReply returns undefined for unknown ids and does not notify", () => {
    const store = createAnnotationStore();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    expect(
      store.addReply("missing", { author: "you", body: "Hello?" }),
    ).toBeUndefined();
    expect(calls).toBe(0);
  });

  test("document snapshot identity changes only on mutation", () => {
    const store = createAnnotationStore();
    const before = store.document();
    expect(store.document()).toBe(before);

    store.add({ target, body: "Note", intent: "note", author: "ford" });
    const after = store.document();
    expect(after).not.toBe(before);
    expect(store.document()).toBe(after);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PROMPT_KIT_SCHEMA_VERSION, type PromptDocument } from "../../../../src/document/nodes/types";
import { createAnnotationStore } from "../../../../src/annotations/store";
import { targetForNode } from "../../../../src/annotations/schema";
import { PromptAnnotationsPane } from "../../../../src/ui/lab/annotate/PromptAnnotationsPane";

afterEach(() => {
  cleanup();
});

function prompt(nodeIds: string[] = ["n1", "n2"]): PromptDocument {
  return {
    kind: "prompt",
    schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
    id: "doc-1",
    nodes: nodeIds.map((id) => ({
      type: "paragraph",
      id,
      content: [`Paragraph ${id}`],
    })),
  };
}

describe("PromptAnnotationsPane", () => {
  it("renders the annotation list from the store", () => {
    const doc = prompt();
    const store = createAnnotationStore();
    store.add({
      target: targetForNode(doc, "n1"),
      body: "Tighten this paragraph.",
      intent: "note",
      author: "ford",
    });

    render(<PromptAnnotationsPane prompt={doc} store={store} />);

    expect(screen.getByText("Tighten this paragraph.")).toBeTruthy();
    expect(screen.getByText("Node n1")).toBeTruthy();
    expect(screen.getByText("1 open")).toBeTruthy();
    expect(
      document.querySelector('[data-plannotator-target="prompt-node:doc-1:n1"]'),
    ).toBeTruthy();
  });

  it("is list-only: no composer, no intent picker, popover-directed empty state", () => {
    const doc = prompt();
    const store = createAnnotationStore();

    render(<PromptAnnotationsPane prompt={doc} store={store} />);

    // Composing happens in the anchored popover on the editor surface — the
    // pane never mounts the panel's inline composer or a textarea.
    expect(document.querySelector('[data-plannotator="composer"]')).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();
    // Single agent-request intent → no picker, no "Note" option anywhere.
    expect(screen.queryByText("Note")).toBeNull();
    expect(
      screen.getByText(
        "No annotations yet. Click a node or select text in the prompt to request a change.",
      ),
    ).toBeTruthy();
  });

  it("resolves an annotation and reflects the new status", async () => {
    const doc = prompt();
    const store = createAnnotationStore();
    const added = store.add({
      target: targetForNode(doc, "n1"),
      body: "Fix the tone.",
      intent: "note",
      author: "ford",
    });

    render(<PromptAnnotationsPane prompt={doc} store={store} />);

    fireEvent.click(screen.getByText("Resolve"));

    await waitFor(() => {
      expect(store.list()[0].status).toBe("resolved");
    });
    expect(store.list()[0].id).toBe(added.id);
    expect(screen.getByText("Resolved")).toBeTruthy();
    expect(
      document.querySelector('[data-plannotator-annotation-status="resolved"]'),
    ).toBeTruthy();
  });

  it("shows a dangling badge when the target node is removed from the prompt", () => {
    const fullDoc = prompt(["n1", "n2"]);
    const store = createAnnotationStore();
    store.add({
      target: targetForNode(fullDoc, "n2"),
      body: "About a node that will disappear.",
      intent: "note",
      author: "ford",
    });

    // Same doc with n2 removed — the annotation's target no longer resolves.
    render(<PromptAnnotationsPane prompt={prompt(["n1"])} store={store} />);

    expect(screen.getByText("Target removed")).toBeTruthy();
    expect(screen.getByText(/"n2" no longer exists/)).toBeTruthy();
    expect(document.querySelector("[data-plannotator-dangling-reason]")).toBeTruthy();
  });

  it("renders Run agent for agent requests and forwards onRunAgent", async () => {
    const doc = prompt();
    const store = createAnnotationStore();
    const added = store.add({
      target: targetForNode(doc, "n1"),
      body: "Make this stricter.",
      intent: "agent-request",
      author: "ford",
    });
    const runCalls: string[] = [];

    render(
      <PromptAnnotationsPane
        prompt={doc}
        store={store}
        onRunAgent={async (annotationId) => {
          runCalls.push(annotationId);
          return {
            ok: true,
            summary: "Tightened the paragraph.",
            patchId: "patch-1",
            changedIds: ["n1"],
          };
        }}
      />,
    );

    fireEvent.click(screen.getByText("Run agent"));
    await waitFor(() => {
      expect(runCalls).toEqual([added.id]);
    });
  });

  it("hides Run agent when onRunAgent is omitted", () => {
    const doc = prompt();
    const store = createAnnotationStore();
    store.add({
      target: targetForNode(doc, "n1"),
      body: "Make this stricter.",
      intent: "agent-request",
      author: "ford",
    });

    render(<PromptAnnotationsPane prompt={doc} store={store} />);

    expect(screen.queryByText("Run agent")).toBeNull();
  });

  it("renders the reply thread stored on an annotation", () => {
    const doc = prompt();
    const store = createAnnotationStore();
    const added = store.add({
      target: targetForNode(doc, "n1"),
      body: "Make this stricter.",
      intent: "agent-request",
      author: "ford",
    });
    store.addReply(added.id, {
      author: "agent",
      body: "Tightened it — anything else?",
    });

    render(<PromptAnnotationsPane prompt={doc} store={store} />);

    const thread = document.querySelector("[data-plannotator-replies]");
    expect(thread).toBeTruthy();
    expect(screen.getByText("Tightened it — anything else?")).toBeTruthy();
    expect(screen.getByText("agent")).toBeTruthy();
  });

  it("submitting a reply reaches the store with the pane's author", async () => {
    const doc = prompt();
    const store = createAnnotationStore();
    store.add({
      target: targetForNode(doc, "n1"),
      body: "Make this stricter.",
      intent: "agent-request",
      author: "ford",
    });

    render(<PromptAnnotationsPane prompt={doc} store={store} />);

    // The affordance exists because the pane always wires onAddReply.
    fireEvent.click(screen.getByText("Reply"));
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "[data-plannotator-reply-composer] textarea",
    );
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea!, { target: { value: "Also shorten it." } });
    fireEvent.click(document.querySelector("[data-plannotator-reply-submit]")!);

    await waitFor(() => {
      expect(store.list()[0].replies?.length).toBe(1);
    });
    expect(store.list()[0].replies![0]).toMatchObject({
      author: "you",
      body: "Also shorten it.",
    });
    // The landed reply renders back into the thread.
    expect(screen.getByText("Also shorten it.")).toBeTruthy();
  });

  it("focuses the target node when the group label is clicked", () => {
    const doc = prompt();
    const store = createAnnotationStore();
    store.add({
      target: targetForNode(doc, "n1"),
      body: "Look here.",
      intent: "note",
      author: "ford",
    });
    const selected: Array<string | undefined> = [];

    render(
      <PromptAnnotationsPane
        prompt={doc}
        store={store}
        onSelectNode={(id) => selected.push(id)}
      />,
    );

    fireEvent.click(screen.getByText("Node n1"));
    expect(selected).toEqual(["n1"]);
  });
});

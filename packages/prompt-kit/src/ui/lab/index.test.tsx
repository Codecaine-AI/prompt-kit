import { afterEach, describe, expect, test } from "bun:test";
import type { PromptDocument } from "../../index";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import {
  PROMPT_STYLE_DEFAULTS,
  PROMPT_STYLE_STORAGE_KEY,
} from "../style/prompt-style-settings";
import { createAnnotationStore } from "../../annotations/store";
import { targetForNode } from "../../annotations/schema";
import {
  buildXmlLineModel,
  nodeRenderedText,
} from "../../document/render/line-model";
import { PromptInlineLab, type PromptEditSession } from ".";

afterEach(() => {
  cleanup();
});

describe("PromptInlineLab style settings", () => {
  test("controlled settings apply without accessing persisted settings", () => {
    const originalStorage = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    const storageOperations: string[] = [];

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem(key: string) {
          storageOperations.push(`getItem:${key}`);
          return null;
        },
        setItem(key: string) {
          storageOperations.push(`setItem:${key}`);
        },
        removeItem(key: string) {
          storageOperations.push(`removeItem:${key}`);
        },
      },
    });

    try {
      const markup = renderToStaticMarkup(
        <PromptInlineLab
          prompt={prompt}
          styleSettings={{ ...PROMPT_STYLE_DEFAULTS, fontSize: 17 }}
        />,
      );

      expect(markup).toContain("--prompt-editor-font-size:17px");
      // Controlled style settings must never read or write the persisted
      // style key. Other features (e.g. the inspector-tab preference) may
      // touch storage when a DOM is present, so only the style key is
      // asserted here.
      expect(
        storageOperations.filter((operation) =>
          operation.endsWith(`:${PROMPT_STYLE_STORAGE_KEY}`),
        ),
      ).toEqual([]);
    } finally {
      if (originalStorage) {
        Object.defineProperty(globalThis, "localStorage", originalStorage);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  });
});

describe("PromptInlineLab structure", () => {
  test("renders zero top chrome and the dock: VIEW always, no inspector, no AGENT zone", () => {
    const markup = renderToStaticMarkup(<PromptInlineLab prompt={prompt} />);

    // The dock replaces every strip of chrome: the VIEW switcher is always
    // present, each switcher row carrying its own token count. The AGENT
    // zone is gone — the manifest lives on the page header now.
    expect(markup).toContain("data-lab-dock");
    expect(markup).not.toContain('data-lab-zone="agent"');
    expect(markup).toContain('data-lab-view="system"');
    expect(markup).toContain('data-lab-view="context"');
    // No state zone wired → no state view row.
    expect(markup).not.toContain('data-lab-view="state"');
    // Counts live on the switcher rows (quiet numbers, no unit chatter).
    expect(markup).toContain("Estimated tokens in the system view");
    expect(markup).toContain("Estimated tokens in the context view");

    // The old inspector is dissolved: no tabs, no collapse, no Inspect.
    expect(markup).not.toContain("Collapse inspector");
    expect(markup).not.toContain("Revisions");
    expect(markup).not.toContain(">Inspect<");
    // DETAILS mounts only when a node is selected — never in fresh markup.
    expect(markup).not.toContain('data-lab-zone="details"');

    // Save status is SILENT at rest (exceptional states speak on the system
    // row's subline) — and no explicit save/reset controls anywhere.
    expect(markup).not.toContain("data-lab-autosave");
    expect(markup).not.toContain(">Save<");
    expect(markup).not.toContain("Reset draft");
  });

  test("the scroller spans the region and the content column centers inside it", () => {
    const markup = renderToStaticMarkup(<PromptInlineLab prompt={prompt} />);

    // The document wrapper no longer caps/centers around the surfaces —
    // it projects the style settings' Content width verbatim as the
    // content-width var (default 136ch; the old hard 96ch cap swallowed the
    // slider), so each surface's scroller spans to the dock while the text
    // column caps inside it.
    expect(markup).toContain("--prompt-editor-content-width:136ch");
    expect(markup).not.toContain("max-width:136ch");

    // The editor rows container LEFT-JUSTIFIES at the style rail's margins
    // inside the full-width scroller (2026-08-04 audit — centering retired).
    expect(markup).toMatch(
      /data-prompt-flow-rows=""[^>]*margin-inline:var\(--prompt-editor-margin-left, 0px\) auto/,
    );
    expect(markup).toMatch(
      /data-prompt-flow-rows=""[^>]*margin-top:var\(--prompt-editor-margin-top, 0px\)/,
    );
  });

  test("the inspector's localStorage preference is gone", () => {
    const originalStorage = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    const touchedKeys: string[] = [];
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem(key: string) {
          touchedKeys.push(key);
          return null;
        },
        setItem(key: string) {
          touchedKeys.push(key);
        },
        removeItem(key: string) {
          touchedKeys.push(key);
        },
      },
    });
    try {
      render(<PromptInlineLab prompt={prompt} />);
      expect(
        touchedKeys.filter((key) => key.includes("promptLabInspector")),
      ).toEqual([]);
    } finally {
      if (originalStorage) {
        Object.defineProperty(globalThis, "localStorage", originalStorage);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  });

  test("does not surface the saved hash anywhere in the shell", () => {
    // The hash lives in the host page header and the HISTORY zone; the lab
    // shell stays quiet.
    const hash = "pk1-d631b526902f7eb5bcbb683721b9b2a1e3373c6892";
    const markup = renderToStaticMarkup(
      <PromptInlineLab prompt={prompt} savedHash={hash} />,
    );

    expect(markup).not.toContain(hash);
    expect(markup).not.toContain("d631b52690");
  });

  test("the outline header's history toggle swaps the zone body to revisions and back", () => {
    render(
      <PromptInlineLab
        prompt={prompt}
        revisionsZone={<div data-testid="revisions">rev-history</div>}
      />,
    );

    // At rest the outline zone shows the outline; history is unmounted.
    expect(screen.queryByText("rev-history")).toBeNull();
    expect(document.querySelector("[data-lab-panel-history]")).toBeNull();
    const outlineZone = () =>
      document.querySelector('[data-lab-zone="outline"]')!;
    expect(outlineZone().textContent).toContain("Outline");
    const toggle = screen.getByRole("button", { name: "History" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    // The toggle swaps the ZONE BODY: revisions replace the outline, the
    // header retitles, and the rest of the zone stack stays put.
    fireEvent.click(toggle);
    const historyView = document.querySelector("[data-lab-panel-history]")!;
    expect(historyView).toBeTruthy();
    expect(outlineZone().contains(historyView)).toBe(true);
    expect(screen.getByText("rev-history")).toBeTruthy();
    expect(outlineZone().textContent).toContain("History");
    expect(document.querySelector('[data-lab-zone="view"]')).toBeTruthy();

    // The same toggle returns the outline.
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(document.querySelector("[data-lab-panel-history]")).toBeNull();
    expect(outlineZone().textContent).toContain("Outline");
  });

  test("no revisionsZone → no history icon, no history view", () => {
    const markup = renderToStaticMarkup(<PromptInlineLab prompt={prompt} />);
    expect(markup).not.toContain("data-lab-history-toggle");
    expect(markup).not.toContain("data-lab-panel-history");
  });
});

describe("PromptInlineLab page header", () => {
  const manifest = {
    name: "prompt-editor",
    model: "sonnet-4.5",
    description: "Edits prompts on request.",
    modelAliases: ["sonnet-4.5", "opus-4.5"],
    editable: true,
  };

  test("renders the bare title and a collapsible description — no model chip", () => {
    render(
      <PromptInlineLab
        prompt={prompt}
        manifest={manifest}
        onManifestSave={async () => ({ ok: true })}
      />,
    );

    // The title is the agent's name ALONE, on the document — not a dock
    // zone, and no model badge beside it (second-pass feedback).
    const title = document.querySelector("[data-lab-page-title]")!;
    expect(title).toBeTruthy();
    expect(title.textContent).toBe("prompt-editor");
    expect(document.querySelector('[data-lab-zone="agent"]')).toBeNull();
    expect(document.querySelector("[data-lab-page-model]")).toBeNull();

    // The description shows, and the ▾ toggle folds it away (and back).
    expect(screen.getByText("Edits prompts on request.")).toBeTruthy();
    const toggle = screen.getByRole("button", {
      name: "Collapse description",
    });
    fireEvent.click(toggle);
    expect(screen.queryByText("Edits prompts on request.")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Expand description" }),
    );
    expect(screen.getByText("Edits prompts on request.")).toBeTruthy();
  });

  test("clicking the description edits in place and saves through the manifest path", async () => {
    const saved: Array<{ model: string; description: string }> = [];
    render(
      <PromptInlineLab
        prompt={prompt}
        manifest={manifest}
        onManifestSave={async (patch) => {
          saved.push(patch);
          return { ok: true };
        }}
      />,
    );

    fireEvent.click(screen.getByText("Edits prompts on request."));
    const input = document.querySelector<HTMLTextAreaElement>(
      "[data-lab-page-description-input]",
    )!;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "Sharper description." } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(saved).toEqual([
        { model: "sonnet-4.5", description: "Sharper description." },
      ]);
    });
  });

});

describe("PromptInlineLab dock view switcher", () => {
  test("switches surfaces and marks the active view", () => {
    render(
      <PromptInlineLab
        prompt={prompt}
        context={{ renderedContext: "<ctx>\nhello context\n</ctx>" }}
      />,
    );

    const viewButton = (id: string) =>
      document.querySelector<HTMLButtonElement>(`[data-lab-view="${id}"]`)!;
    expect(viewButton("system").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-prompt-flow-rows]")).toBeTruthy();

    fireEvent.click(viewButton("context"));
    expect(viewButton("context").getAttribute("aria-pressed")).toBe("true");
    expect(viewButton("system").getAttribute("aria-pressed")).toBe("false");
    // The context surface replaces the editor.
    expect(
      document.querySelector('[data-context-scroll="context"]'),
    ).toBeTruthy();
    expect(document.querySelector("[data-prompt-flow-rows]")).toBeNull();

    fireEvent.click(viewButton("system"));
    expect(document.querySelector("[data-prompt-flow-rows]")).toBeTruthy();
  });

  test("the save status is silent until something needs attention", () => {
    render(
      <PromptInlineLab
        prompt={prompt}
        onSave={async () => ({ hash: "pk1-test" })}
      />,
    );
    // Steady state: nothing to say, nothing rendered.
    expect(document.querySelector("[data-lab-autosave]")).toBeNull();

    // A draft edit makes the document dirty — the system row's subline
    // speaks until the autosave settles it.
    fireEvent.click(
      document.querySelector<HTMLElement>(
        '[data-prompt-node-id="paragraph-1"] [data-prompt-row-text]',
      )!,
    );
    const editor = document.querySelector<HTMLTextAreaElement>(
      "[data-prompt-row-text] textarea",
    )!;
    fireEvent.change(editor, { target: { value: "Hello there" } });
    const whisper = document.querySelector("[data-lab-autosave]");
    expect(whisper).toBeTruthy();
    expect(
      document.querySelector('[data-lab-view-subline="system"]')!.contains(
        whisper,
      ),
    ).toBe(true);
  });
});

describe("PromptInlineLab dock outline", () => {
  test("system sections list in the OUTLINE zone and click scrolls the buffer", () => {
    render(<PromptInlineLab prompt={nestedPrompt} />);

    const zone = document.querySelector('[data-lab-zone="outline"]');
    expect(zone).toBeTruthy();
    expect(zone!.textContent).toContain("steps");

    const scroller = document.querySelector<HTMLElement>(
      '[data-prompt-flow-scroll="xml"]',
    )!;
    const calls: Array<{ top?: number }> = [];
    Object.defineProperty(scroller, "scrollTo", {
      configurable: true,
      value: (options: { top?: number }) => {
        calls.push(options);
      },
    });

    fireEvent.click(within(zone as HTMLElement).getByRole("button", { name: "steps" }));
    expect(calls.length).toBe(1);
    expect(
      within(zone as HTMLElement)
        .getByRole("button", { name: "steps" })
        .getAttribute("aria-current"),
    ).toBe("location");
  });

  test("a sectionless prompt shows no OUTLINE zone", () => {
    render(<PromptInlineLab prompt={prompt} />);
    expect(document.querySelector('[data-lab-zone="outline"]')).toBeNull();
  });
});

describe("PromptInlineLab dock details", () => {
  test("DETAILS mounts in the floating dock only while a block is selected", () => {
    render(<PromptInlineLab prompt={prompt} />);
    // The glass dock is always up; the DETAILS zone inside it is not.
    expect(document.querySelector("[data-lab-dock]")).toBeTruthy();
    expect(document.querySelector('[data-lab-zone="details"]')).toBeNull();

    // Clicking into a block selects it (and opens its inline editor).
    fireEvent.click(
      document.querySelector<HTMLElement>(
        '[data-prompt-node-id="paragraph-1"] [data-prompt-row-text]',
      )!,
    );
    const zone = document.querySelector('[data-lab-zone="details"]');
    expect(zone).toBeTruthy();
    expect(document.querySelector("[data-lab-dock]")!.contains(zone)).toBe(true);
    // The absorbed PromptFlowInspector content: the selection summary.
    expect(zone!.textContent).toContain("Selected");
    expect(zone!.textContent).toContain("paragraph");
  });
});

describe("PromptInlineLab state view", () => {
  const stateZone = (overrides: Partial<{
    activeFixtureId: string | null;
    renderedState: string | null;
    onFixtureSelect: (id: string) => void;
  }> = {}) => ({
    fixtures: [
      { id: "empty-run", label: "empty-run" },
      { id: "mid-session", label: "mid-session" },
    ],
    activeFixtureId: "empty-run" as string | null,
    onFixtureSelect: () => {},
    renderedState: "<session_state>\nturn: 0\n</session_state>",
    ...overrides,
  });

  test("the switcher gains a state row and the surface renders the state doc", () => {
    render(<PromptInlineLab prompt={prompt} stateZone={stateZone()} />);

    const stateButton = document.querySelector<HTMLButtonElement>(
      '[data-lab-view="state"]',
    );
    expect(stateButton).toBeTruthy();
    fireEvent.click(stateButton!);

    const scroller = document.querySelector<HTMLElement>(
      '[data-context-scroll="state"]',
    );
    expect(scroller).toBeTruthy();
    expect(scroller!.textContent).toContain("turn: 0");
    // Read-only: no editor rows on the state surface.
    expect(document.querySelector("[data-prompt-flow-rows]")).toBeNull();
    // The state doc's sections map into the OUTLINE zone.
    expect(
      document.querySelector('[data-lab-zone="outline"]')?.textContent,
    ).toContain("session_state");
  });

  test("the FIXTURE zone lists fixtures, marks the active one, and fires onFixtureSelect", () => {
    const picks: string[] = [];
    render(
      <PromptInlineLab
        prompt={prompt}
        stateZone={stateZone({ onFixtureSelect: (id) => picks.push(id) })}
      />,
    );
    fireEvent.click(document.querySelector('[data-lab-view="state"]')!);

    const active = document.querySelector<HTMLButtonElement>(
      '[data-lab-fixture="empty-run"]',
    )!;
    expect(active.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(
      document.querySelector('[data-lab-fixture="mid-session"]')!,
    );
    expect(picks).toEqual(["mid-session"]);
  });

  test("a null renderedState shows the loading/none message", () => {
    render(
      <PromptInlineLab
        prompt={prompt}
        stateZone={stateZone({ renderedState: null })}
      />,
    );
    fireEvent.click(document.querySelector('[data-lab-view="state"]')!);
    expect(
      screen.getByText("No rendered state for this fixture yet."),
    ).toBeTruthy();
  });
});

describe("PromptInlineLab undo/redo", () => {
  test("no chrome carries undo/redo buttons", () => {
    render(<PromptInlineLab prompt={prompt} />);

    // Undo/redo are keyboard-only; the only mode control on screen is the
    // ANNOTATE toggle in the REQUESTS zone header.
    expect(screen.queryByLabelText("Undo")).toBeNull();
    expect(screen.queryByLabelText("Redo")).toBeNull();
    expect(document.querySelector('[title*="mod+z"]')).toBeNull();
    expect(screen.getByRole("button", { name: "AI" })).toBeTruthy();
  });

  test("⌘Z and ⌘⇧Z undo and redo an edit made on the editor surface", () => {
    const drafts: PromptDocument[] = [];
    render(
      <PromptInlineLab
        prompt={prompt}
        onDraftChange={(next) => drafts.push(next)}
      />,
    );

    // Click the paragraph row to open its inline editor, then type.
    const region = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="paragraph-1"] [data-prompt-row-text]',
    );
    expect(region).toBeTruthy();
    fireEvent.click(region!);
    const textarea = document.querySelector("textarea");
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea!, { target: { value: "Hello world" } });
    expect(firstParagraphText(drafts.at(-1))).toBe("Hello world");

    // The shortcut is bound on the document (see the lab root), so the event
    // is dispatched where focus actually sits while editing: the textarea.
    fireEvent.keyDown(textarea!, { key: "z", metaKey: true });
    expect(firstParagraphText(drafts.at(-1))).toBe("Hello");

    fireEvent.keyDown(textarea!, { key: "z", metaKey: true, shiftKey: true });
    expect(firstParagraphText(drafts.at(-1))).toBe("Hello world");
  });
});

/** Text of the draft's first paragraph node, for undo/redo assertions. */
function firstParagraphText(draft?: PromptDocument): string | undefined {
  const node = draft?.nodes.find((entry) => entry.type === "paragraph");
  if (!node || node.type !== "paragraph") return undefined;
  return node.content
    .map((part) => (typeof part === "string" ? part : ""))
    .join("");
}

describe("PromptInlineLab annotate mode", () => {
  test("the AI tab swaps the zone stack for the annotations workspace", () => {
    render(<PromptInlineLab prompt={prompt} />);

    // Edit tab: the zone stack is on screen (no COMMENTS zone — what's
    // active lives on the AI tab), the workspace is not mounted.
    expect(document.querySelector('[data-lab-zone="view"]')).toBeTruthy();
    expect(document.querySelector('[data-lab-zone="comments"]')).toBeNull();
    expect(document.querySelector("[data-lab-annotate-panel]")).toBeNull();
    expect(document.querySelector('[data-plannotator="root"]')).toBeNull();

    const toggle = screen.getByRole("button", { name: "AI" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);

    // AI tab (2026-08-05 redesign): the same glass changes role — the zone
    // stack is swapped away and the annotations pane mounts inside it.
    const panel = document.querySelector("[data-lab-annotate-panel]");
    expect(panel).toBeTruthy();
    const pane = document.querySelector('[data-plannotator="root"]');
    expect(pane).toBeTruthy();
    expect(panel!.contains(pane)).toBe(true);
    expect(document.querySelector('[data-lab-zone="view"]')).toBeNull();

    // The Edit tab returns the zones.
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(document.querySelector("[data-lab-annotate-panel]")).toBeNull();
    expect(document.querySelector('[data-lab-zone="view"]')).toBeTruthy();
  });

  test("focusing a listed annotation reopens the anchored popover, not a pane composer", async () => {
    const store = createAnnotationStore();
    // Seed one annotation so the pane exposes a focusable target — clicking
    // it routes through the lab's selectedNodeId state, which now opens the
    // anchored composer popover next to the node's rows (the same host-owned
    // flow a PromptFlowXml node click uses).
    store.add({
      target: targetForNode(prompt, "paragraph-1"),
      body: "Seed request.",
      intent: "agent-request",
      author: "ford",
    });

    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    fireEvent.click(screen.getByText("Node paragraph-1"));
    // The sidebar stays list-only; composing happens in the popover.
    expect(document.querySelector('[data-plannotator="composer"]')).toBeNull();
    submitComposer("Tighten the opener.");

    await waitFor(() => {
      expect(store.list().length).toBe(2);
    });
    const added = store.list()[1];
    expect(added.target).toEqual({
      kind: "prompt-node",
      docId: "controlled-style-test",
      nodeId: "paragraph-1",
      // Stamped at FILE time: the node's content fingerprint, the evidence
      // the queue's "target changed since filed" chip compares against.
      fingerprint: expect.any(String),
    });
    expect(added.body).toBe("Tighten the opener.");
    expect(added.intent).toBe("agent-request");
    expect(added.status).toBe("open");
  });

  test("hovering a node's row shows the glide ring and an inspector-named chip", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    const row = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="paragraph-1"]',
    );
    expect(row).toBeTruthy();
    expect(
      document
        .querySelector("[data-annotation-targeting]")
        ?.getAttribute("data-annotation-targeting"),
    ).toBe("true");

    fireEvent.mouseMove(row!);

    expect(document.querySelector('[data-annotation-ui="hover-ring"]')).toBeTruthy();
    const chip = document.querySelector('[data-annotation-ui="hover-chip"]');
    expect(chip).toBeTruthy();
    // Nodes are named the way the inspector tree names them.
    expect(chip?.textContent).toBe("Paragraph");
  });

  test("hover targets exactly what is pointed at — no Alt parent expansion", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    const itemRow = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="item-1"]',
    );
    expect(itemRow).toBeTruthy();
    // Item rows stamp the item's own id plus the list as parent.
    expect(itemRow!.getAttribute("data-prompt-parent-node-id")).toBe("list-1");

    fireEvent.mouseMove(itemRow!);
    expect(
      document.querySelector('[data-annotation-ui="hover-chip"]')?.textContent,
    ).toBe("List item");

    // The scope machinery is gone: Alt changes nothing — what you point at
    // is the target.
    fireEvent.mouseMove(itemRow!, { altKey: true });
    expect(
      document.querySelector('[data-annotation-ui="hover-chip"]')?.textContent,
    ).toBe("List item");
  });

  test("clicking a node opens the inline composer and Annotate lands an agent request", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    fireEvent.click(
      document.querySelector('[data-prompt-node-id="paragraph-1"]')!,
    );

    // Pinning draws the selected ring over the node's rows...
    expect(
      document.querySelector('[data-annotation-ui="selected-ring"]'),
    ).toBeTruthy();

    // ...and opens the composer IN the document flow, directly above the
    // target's row (⌘K feel) — not a floating popover. No intent picker,
    // no scope breadcrumb.
    expect(composer()).toBeTruthy();
    const slot = document.querySelector('[data-prompt-inline-insert="composer"]');
    expect(slot).toBeTruthy();
    const targetRow = document.querySelector(
      '[data-prompt-node-id="paragraph-1"]',
    )!;
    // The composer slot PRECEDES the target row in the surface flow.
    expect(
      slot!.compareDocumentPosition(targetRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      document.querySelector("[data-prompt-flow-rows]")!.contains(slot),
    ).toBe(true);
    expect(within(composer()!).queryByText("Note")).toBeNull();
    expect(composer()!.querySelector("[data-annotation-scope]")).toBeNull();
    submitComposer("Fix the wording here.");

    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    expect(store.list()[0].target).toEqual({
      kind: "prompt-node",
      docId: "controlled-style-test",
      nodeId: "paragraph-1",
      fingerprint: expect.any(String),
    });
    expect(store.list()[0].intent).toBe("agent-request");
    // Submit closes the popover and clears the pinned target; the annotation
    // now lives in the sidebar list.
    await waitFor(() => {
      expect(composer()).toBeNull();
    });
    expect(
      document.querySelector('[data-annotation-ui="selected-ring"]'),
    ).toBeNull();
    expect(screen.getByText("Fix the wording here.")).toBeTruthy();
  });

  test("clicking a single bullet targets the ITEM id", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    fireEvent.click(document.querySelector('[data-prompt-node-id="item-1"]')!);

    expect(composer()).toBeTruthy();
    submitComposer("Reorder this step.");

    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    expect(store.list()[0].target).toEqual({
      kind: "prompt-node",
      docId: "controlled-style-test",
      nodeId: "item-1",
      fingerprint: expect.any(String),
    });
    expect(store.list()[0].intent).toBe("agent-request");
  });

  test("Alt-clicking a bullet still pins the ITEM — no parent expansion", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    fireEvent.click(document.querySelector('[data-prompt-node-id="item-2"]')!, {
      altKey: true,
    });

    expect(composer()).toBeTruthy();
    submitComposer("Merge these bullets.");

    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    // What you click is the target: the item itself, Alt or not.
    expect(store.list()[0].target).toEqual({
      kind: "prompt-node",
      docId: "controlled-style-test",
      nodeId: "item-2",
      fingerprint: expect.any(String),
    });
  });

  test("Escape and Cancel both dismiss the popover and clear the target", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    // Escape (from the composer textarea) clears everything.
    fireEvent.click(
      document.querySelector('[data-prompt-node-id="paragraph-1"]')!,
    );
    expect(composer()).toBeTruthy();
    fireEvent.keyDown(composer()!.querySelector("textarea")!, {
      key: "Escape",
    });
    expect(composer()).toBeNull();
    expect(
      document.querySelector('[data-annotation-ui="selected-ring"]'),
    ).toBeNull();

    // The Cancel affordance does the same.
    fireEvent.click(
      document.querySelector('[data-prompt-node-id="paragraph-1"]')!,
    );
    expect(composer()).toBeTruthy();
    fireEvent.click(within(composer()!).getByLabelText("Cancel"));
    expect(composer()).toBeNull();
    expect(
      document.querySelector('[data-annotation-ui="selected-ring"]'),
    ).toBeNull();
  });

  test("the sidebar is list-only with popover-directed empty state and no intent picker", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    expect(
      screen.getByText(
        "No annotations yet. Click a node or select text in the prompt to request a change.",
      ),
    ).toBeTruthy();

    // Even with a target pinned, the pane never mounts a composer and no
    // "Note" intent option exists anywhere in the annotate flow.
    fireEvent.click(
      document.querySelector('[data-prompt-node-id="paragraph-1"]')!,
    );
    expect(document.querySelector('[data-plannotator="composer"]')).toBeNull();
    expect(screen.queryByText("Note")).toBeNull();
  });

  test("a Cmd+drag selection produces a prompt-range annotation in the store", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    const region = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="paragraph-1"] [data-prompt-row-text]',
    );
    expect(region).toBeTruthy();

    // The paragraph renders "Hello"; find its text node and select all of it.
    const walker = document.createTreeWalker(region!, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    let current: Node | null;
    while ((current = walker.nextNode())) {
      if ((current as Text).data.includes("Hello")) {
        textNode = current as Text;
        break;
      }
    }
    expect(textNode).toBeTruthy();

    const base = textNode!.data.indexOf("Hello");
    const range = document.createRange();
    range.setStart(textNode!, base);
    range.setEnd(textNode!, base + "Hello".length);

    const fakeSelection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => "Hello",
    } as unknown as Selection;
    const originalGetSelection = window.getSelection;
    window.getSelection = () => fakeSelection;
    try {
      // Cmd held on the releasing mouseup — range selection is gated behind
      // the meta modifier in annotate mode.
      fireEvent.mouseUp(region!, { metaKey: true });
    } finally {
      window.getSelection = originalGetSelection;
    }

    // The drag release pins the range target and opens the inline composer.
    expect(composer()).toBeTruthy();
    submitComposer("Tighten this phrase.");

    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    // "Hello" is the whole rendered text of the node, so offsets are 0..5 of
    // the node's line-joined rendered string and the quote is the model
    // slice, not the raw DOM selection.
    expect(store.list()[0].target).toEqual({
      kind: "prompt-range",
      docId: "controlled-style-test",
      nodeId: "paragraph-1",
      start: 0,
      end: 5,
      quote: "Hello",
      fingerprint: expect.any(String),
    });
  });

  test("a plain (unmodified) drag neither opens the composer nor pins a target", () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    dragSelectHello({ modified: false });

    // No range target: no composer, no selected ring, nothing stored.
    expect(composer()).toBeNull();
    expect(selectedRing()).toBeNull();
    expect(store.list().length).toBe(0);

    // The release click of the drag must not pin a node target either — the
    // capture handler defers to the (still non-collapsed) selection.
    const region = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="paragraph-1"] [data-prompt-row-text]',
    )!;
    const fakeSelection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => document.createRange(),
      toString: () => "Hello",
    } as unknown as Selection;
    const originalGetSelection = window.getSelection;
    window.getSelection = () => fakeSelection;
    try {
      fireEvent.click(region);
    } finally {
      window.getSelection = originalGetSelection;
    }
    expect(composer()).toBeNull();
    expect(store.list().length).toBe(0);
  });

  test("Cmd at mousedown but released before mouseup still lands the range", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    const region = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="paragraph-1"] [data-prompt-row-text]',
    )!;
    // The drag starts with Cmd held; by the time the mouse releases the
    // modifier is already up — the drag must still count as modified.
    fireEvent.mouseDown(region, { metaKey: true });
    dragSelectHello({ modified: false });

    expect(composer()).toBeTruthy();
  });

  test("a Cmd+drag across bullets maps to the LIST: ring and composer cover the swath, the ancestor range lands", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    const itemRowOne = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="item-1"]',
    )!;
    const itemRowTwo = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="item-2"]',
    )!;
    // Real geometry so the selected ring's union rect is observable. Rings
    // measure the rows' TEXT regions (display auto-sizes to the content),
    // so the stubs go on those — the row rects stay happy-dom zero.
    stubRect(textRegion(itemRowOne), 10, 10);
    stubRect(textRegion(itemRowTwo), 20, 10);

    const findText = (row: HTMLElement, needle: string): Text => {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let current: Node | null;
      while ((current = walker.nextNode())) {
        if ((current as Text).data.includes(needle)) return current as Text;
      }
      throw new Error(`No text node containing "${needle}"`);
    };
    const start = findText(itemRowOne, "First item");
    const end = findText(itemRowTwo, "Second item");
    const range = document.createRange();
    range.setStart(start, start.data.indexOf("First"));
    range.setEnd(end, end.data.indexOf("Second item") + "Second item".length);

    const fakeSelection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => "raw dom selection",
    } as unknown as Selection;
    const originalGetSelection = window.getSelection;
    window.getSelection = () => fakeSelection;
    try {
      fireEvent.mouseUp(itemRowOne, { metaKey: true });
    } finally {
      window.getSelection = originalGetSelection;
    }

    // Start and end rows are different bullets → the target SILENTLY widens
    // to their LIST (no breadcrumb, no scope UI — the widening lives in
    // mapDomRangeToPromptRange)…
    expect(composer()).toBeTruthy();
    expect(composer()!.querySelector("[data-annotation-scope]")).toBeNull();
    // …and the selected ring honestly covers BOTH bullet rows (union of the
    // stubbed rects 10..30, ring inset 3).
    expect(selectedRing()).toBeTruthy();
    expect(selectedRing()!.style.top).toBe("7px");
    expect(selectedRing()!.style.height).toBe("26px");

    submitComposer("Tighten this list.");
    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });

    // Offsets/quote index the LIST's rendered text — the model slice spans
    // the newline between the bullets, not the raw DOM selection string.
    const listText = nodeRenderedText(buildXmlLineModel(prompt).lines, "list-1");
    const expectedStart = listText.indexOf("First item");
    const expectedEnd = listText.indexOf("Second item") + "Second item".length;
    expect(store.list()[0].target).toEqual({
      kind: "prompt-range",
      docId: "controlled-style-test",
      nodeId: "list-1",
      start: expectedStart,
      end: expectedEnd,
      quote: "First item\n- Second item",
      fingerprint: expect.any(String),
    });
  });

  test("annotate mode disarms click-to-edit and keeps row text natively selectable", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    // The annotate stylesheet pins `user-select: text` on the row text
    // regions — the native selection a Cmd+drag reads must be able to form.
    const styleText = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent)
      .join("\n");
    expect(styleText).toContain(
      '[data-annotation-targeting="true"] [data-prompt-row-text]',
    );
    expect(styleText).toContain("user-select: text");

    // Clicking the row's TEXT (the exact surface that starts an inline edit
    // session in edit mode) must NOT mount the editor — the capture-phase
    // annotate handler consumes the click as a target pick instead.
    const rowText = () =>
      document.querySelector<HTMLElement>(
        '[data-prompt-node-id="paragraph-1"] [data-prompt-row-text] > div',
      )!;
    fireEvent.click(rowText());
    expect(
      document.querySelector("[data-prompt-row-text] textarea"),
    ).toBeNull();
    expect(composer()).toBeTruthy();

    // Back in edit mode the very same click starts the inline editor — the
    // hijack is gated on annotate mode, not gone. Exit goes through the
    // annotate panel's `done` (the zone toggle is swapped away with the dock).
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(rowText());
    expect(
      document.querySelector("[data-prompt-row-text] textarea"),
    ).toBeTruthy();
  });

  test("annotate mode hides every stamped editor affordance via the stylesheet", () => {
    render(<PromptInlineLab prompt={prompt} />);

    // Edit mode: under the one-handle model the block grip/menu cluster
    // mounts on the hovered block's row, carrying the
    // `data-prompt-affordance` stamp the annotate stylesheet keys on. The
    // per-item remove × is GONE in every mode — item deletion is
    // Backspace-on-empty / item merging / the block menu's Delete — so
    // hovering an item row must mount nothing with the retired stamp.
    fireEvent.mouseEnter(
      document.querySelector<HTMLElement>(
        '[data-prompt-node-id="paragraph-1"]',
      )!,
    );
    expect(
      document.querySelector('[data-prompt-affordance="block-cluster"]'),
    ).toBeTruthy();
    const itemRow = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="item-1"]',
    )!;
    fireEvent.mouseEnter(itemRow);
    expect(
      document.querySelector('[data-prompt-affordance="remove-item"]'),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    // The injected stylesheet display:none-hides every stamped affordance.
    // This is what makes annotate mode annotation-ONLY: the shared skip
    // selector exempts `button` from targeting, so without this rule the
    // grip would stay clickable while annotating.
    const styleText = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent)
      .join("\n");
    const affordanceRule = styleText
      .split("}")
      .find((rule) =>
        rule.includes(
          '[data-annotation-targeting="true"] [data-prompt-affordance]',
        ),
      );
    expect(affordanceRule).toBeTruthy();
    expect(affordanceRule).toContain("display: none");

    // Back in edit mode the stylesheet is gone — hiding is annotate-scoped.
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      Array.from(document.querySelectorAll("style"))
        .map((style) => style.textContent)
        .join("\n"),
    ).not.toContain("[data-prompt-affordance]");
  });

  test("the targeting rings hug the row's text region, not the full row", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    const row = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="paragraph-1"]',
    )!;
    // Distinct rects: the full ROW spans 100..140, its TEXT region 10..20.
    // Ring geometry proves which one the display path measured.
    stubRect(row, 100, 40);
    stubRect(textRegion(row), 10, 10);

    fireEvent.mouseMove(row);
    const hoverRing = document.querySelector<HTMLElement>(
      '[data-annotation-ui="hover-ring"]',
    );
    expect(hoverRing).toBeTruthy();
    // Region-derived (top 10, height 10, ring inset 3) — NOT the row's 100.
    expect(hoverRing!.style.top).toBe("7px");
    expect(hoverRing!.style.height).toBe("16px");

    // Pinning measures the same text region for the selected ring.
    fireEvent.click(row);
    expect(selectedRing()!.style.top).toBe("7px");
    expect(selectedRing()!.style.height).toBe("16px");
  });

  test("an open composer suppresses the hover ring/chip; closing restores them", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    const paragraphRow = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="paragraph-1"]',
    )!;
    const itemRow = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="item-1"]',
    )!;

    fireEvent.mouseMove(paragraphRow);
    expect(document.querySelector('[data-annotation-ui="hover-chip"]')).toBeTruthy();

    // Pinning opens the composer — hover resolution stops entirely, but the
    // selected ring stays.
    fireEvent.click(paragraphRow);
    expect(composer()).toBeTruthy();
    fireEvent.mouseMove(itemRow);
    expect(document.querySelector('[data-annotation-ui="hover-chip"]')).toBeNull();
    expect(document.querySelector('[data-annotation-ui="hover-ring"]')).toBeNull();
    expect(
      document.querySelector('[data-annotation-ui="selected-ring"]'),
    ).toBeTruthy();

    // Cancel closes the composer and hover targeting resumes.
    fireEvent.click(within(composer()!).getByLabelText("Cancel"));
    fireEvent.mouseMove(itemRow);
    expect(
      document.querySelector('[data-annotation-ui="hover-chip"]')?.textContent,
    ).toBe("List item");
  });

  test("Run agent forwards the annotation id to onAnnotationAgentRun", async () => {
    const store = createAnnotationStore();
    const added = store.add({
      target: targetForNode(prompt, "paragraph-1"),
      body: "Make this stricter.",
      intent: "agent-request",
      author: "ford",
    });
    const runCalls: string[] = [];

    render(
      <PromptInlineLab
        prompt={prompt}
        annotationStore={store}
        onAnnotationAgentRun={async (annotationId) => {
          runCalls.push(annotationId);
          return {
            ok: true,
            summary: "Stricter now.",
            patchId: "patch-1",
            changedIds: ["paragraph-1"],
          };
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    fireEvent.click(screen.getByText("Run agent"));

    await waitFor(() => {
      expect(runCalls).toEqual([added.id]);
    });
  });
});

describe("PromptInlineLab inline composer", () => {
  test("no scope UI exists anywhere in the annotate flow", () => {
    render(<PromptInlineLab prompt={nestedPrompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    fireEvent.click(document.querySelector('[data-prompt-node-id="item-1"]')!);
    expect(composer()).toBeTruthy();
    // No breadcrumb segments, no target label header — what you clicked is
    // the target, full stop.
    expect(document.querySelector("[data-annotation-scope]")).toBeNull();

    // Clicking the SAME row again does not widen anything — the composer
    // stays and the eventual submit targets the clicked item (verified by
    // the submit test below); here we just assert no scope UI ever appears.
    fireEvent.click(document.querySelector('[data-prompt-node-id="item-1"]')!);
    expect(document.querySelector("[data-annotation-scope]")).toBeNull();
  });

  test("Enter queues; the clicked leaf is what lands", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={nestedPrompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    fireEvent.click(document.querySelector('[data-prompt-node-id="item-1"]')!);
    const textarea = composer()!.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "Split this step." } });
    // Bare Enter is THE gesture — Queue.
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    expect(store.list()[0].target).toEqual({
      kind: "prompt-node",
      docId: "nested-scope-test",
      nodeId: "item-1",
      fingerprint: expect.any(String),
    });
    expect(composer()).toBeNull();
  });

  test("every gesture queues — bare Enter, legacy chords, and the button", async () => {
    const filed: Array<{
      disposition: string;
      nodeId: string | null;
      body: string;
    }> = [];
    const session: PromptEditSession = {
      requests: [],
      proposals: [],
      onFileRequest: (filing) => {
        filed.push({
          disposition: filing.disposition,
          nodeId: filing.target ? filing.target.nodeId : null,
          body: filing.body,
        });
      },
    };
    render(
      <PromptInlineLab prompt={nestedPrompt} promptEditSession={session} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    const pin = () =>
      fireEvent.click(document.querySelector('[data-prompt-node-id="item-1"]')!);
    const type = (body: string) => {
      const textarea = composer()!.querySelector("textarea")!;
      fireEvent.change(textarea, { target: { value: body } });
      return textarea;
    };

    // Bare Enter queues.
    pin();
    fireEvent.keyDown(type("Queue this."), { key: "Enter" });
    // The legacy chords stay forgiving aliases for the same door.
    pin();
    fireEvent.keyDown(type("Queue that."), { key: "Enter", metaKey: true });
    // …and the button is the same door again.
    pin();
    fileComposer("Queue too.");

    await waitFor(() => {
      expect(filed.length).toBe(3);
    });
    expect(filed).toEqual([
      { disposition: "batch", nodeId: "item-1", body: "Queue this." },
      { disposition: "batch", nodeId: "item-1", body: "Queue that." },
      { disposition: "batch", nodeId: "item-1", body: "Queue too." },
    ]);
  });

  test("filing never launches a run — the queue waits for Apply", async () => {
    const filed: string[] = [];
    const ran: string[] = [];
    const session: PromptEditSession = {
      requests: [],
      proposals: [],
      onFileRequest: (filing) => {
        filed.push(filing.annotationId);
      },
      onRunRequest: (annotationId) => {
        ran.push(annotationId);
      },
    };
    render(<PromptInlineLab prompt={prompt} promptEditSession={session} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    fireEvent.click(
      document.querySelector('[data-prompt-node-id="paragraph-1"]')!,
    );
    fileComposer("Tighten the opener.");

    await waitFor(() => {
      expect(filed.length).toBe(1);
    });
    expect(ran).toEqual([]);
  });

  test("an open composer is sticky: only × or Escape closes it", () => {
    render(<PromptInlineLab prompt={nestedPrompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    fireEvent.click(document.querySelector('[data-prompt-node-id="item-1"]')!);
    expect(composer()).toBeTruthy();

    // Clicking another node neither cancels nor re-targets…
    fireEvent.click(document.querySelector('[data-prompt-node-id="item-2"]')!);
    expect(composer()).toBeTruthy();
    // …and a background click inside the surface doesn't either.
    fireEvent.click(document.querySelector("[data-prompt-flow-rows]")!);
    expect(composer()).toBeTruthy();

    // × closes it.
    fireEvent.click(within(composer()!).getByLabelText("Cancel"));
    expect(composer()).toBeNull();
  });

  test("the composer inserts in flow above the first row of a nested target", () => {
    render(<PromptInlineLab prompt={nestedPrompt} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    fireEvent.click(document.querySelector('[data-prompt-node-id="item-2"]')!);
    const slot = document.querySelector(
      '[data-prompt-inline-insert="composer"]',
    )!;
    expect(slot).toBeTruthy();
    const itemTwo = document.querySelector('[data-prompt-node-id="item-2"]')!;
    const itemOne = document.querySelector('[data-prompt-node-id="item-1"]')!;
    // In flow: after item-1, before item-2 — directly above the target.
    expect(
      slot.compareDocumentPosition(itemTwo) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      slot.compareDocumentPosition(itemOne) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  test("composer submits route to onSendRequest when the session owns requests", async () => {
    const sent: Array<{ nodeId: string | null; body: string }> = [];
    const store = createAnnotationStore();
    render(
      <PromptInlineLab
        prompt={prompt}
        annotationStore={store}
        promptEditSession={{
          requests: [],
          proposals: [],
          onSendRequest: (target, body) => {
            sent.push({
              nodeId: target && "nodeId" in target ? target.nodeId : null,
              body,
            });
          },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    fireEvent.click(
      document.querySelector('[data-prompt-node-id="paragraph-1"]')!,
    );
    submitComposer("Tighten the opener.");

    await waitFor(() => {
      expect(sent).toEqual([
        { nodeId: "paragraph-1", body: "Tighten the opener." },
      ]);
    });
    // The container owns request creation — nothing lands in the store.
    expect(store.list().length).toBe(0);
  });
});

describe("PromptInlineLab comments on the AI tab", () => {
  // 2026-08-05 redesign: the COMMENTS zone left the Edit tab — what's active
  // (open requests, comments, runs) shows only in the AI state's workspace.
  test("the Edit tab carries no comments zone; open requests list on the AI tab", () => {
    const session: PromptEditSession = {
      requests: [
        {
          alias: "R1",
          annotationId: "ann-R1",
          author: "you",
          status: "open",
          body: "Tighten the opener of this paragraph, it rambles far too long.",
          target: {
            kind: "prompt-node",
            docId: "controlled-style-test",
            nodeId: "paragraph-1",
          },
          disposition: "batch",
        },
      ],
      proposals: [],
    };
    render(<PromptInlineLab prompt={prompt} promptEditSession={session} />);

    // Edit tab: wayfinding only.
    expect(document.querySelector('[data-lab-zone="comments"]')).toBeNull();
    expect(document.querySelector("[data-prompt-session-rail]")).toBeNull();

    // AI tab: the session rail holds the open request.
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    const rail = document.querySelector<HTMLElement>(
      "[data-prompt-session-rail]",
    )!;
    expect(rail).toBeTruthy();
    const card = rail.querySelector<HTMLElement>(
      '[data-prompt-session-card="R1"]',
    )!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Tighten the opener");
  });

  test("closed loops file as ✓/✕ records on the AI tab", () => {
    const closed = (
      alias: string,
      status: "applied" | "declined",
    ): PromptEditSession["requests"][number] => ({
      alias,
      author: "you",
      status,
      body: `Request ${alias}`,
      target: {
        kind: "prompt-node",
        docId: "controlled-style-test",
        nodeId: "paragraph-1",
      },
      disposition: "batch",
    });
    render(
      <PromptInlineLab
        prompt={prompt}
        promptEditSession={{
          requests: [closed("R1", "applied"), closed("R2", "declined")],
          proposals: [],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    const records = document.querySelectorAll("[data-prompt-session-record]");
    expect(records.length).toBe(2);
    const text = [...records].map((record) => record.textContent).join(" ");
    expect(text).toContain("✓");
    expect(text).toContain("✕");
  });
});

describe("PromptInlineLab comment ticks", () => {
  test("commented blocks carry a tick; hovering the queue card lights them", () => {
    const session: PromptEditSession = {
      requests: [
        {
          alias: "R1",
          author: "you",
          status: "open",
          body: "Tighten this.",
          target: {
            kind: "prompt-node",
            docId: "controlled-style-test",
            nodeId: "paragraph-1",
          },
          disposition: "batch",
        },
      ],
      proposals: [],
    };
    render(<PromptInlineLab prompt={prompt} promptEditSession={session} />);
    const ticks = () =>
      document.querySelector("[data-lab-comment-ticks]")?.textContent ?? "";

    // Edit mode stays clean of the annotation layer — no ticks at all.
    expect(document.querySelector("[data-lab-comment-ticks]")).toBeNull();

    // The AI state marks the commented block's rows; no wash before hover.
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    expect(ticks()).toContain('[data-row-index="0"]');
    expect(ticks()).not.toContain("background: rgb(138 122 176 / 0.14)");

    // Hovering the queue card washes the block; leaving drops it.
    const card = document.querySelector('[data-prompt-session-card="R1"]')!;
    fireEvent.mouseEnter(card);
    expect(ticks()).toContain("background: rgb(138 122 176 / 0.14)");
    fireEvent.mouseLeave(card);
    expect(ticks()).not.toContain("background: rgb(138 122 176 / 0.14)");
  });
});

describe("PromptInlineLab margin comment indicators", () => {
  test("an annotated block grows a count bubble inside the rows container", () => {
    const store = createAnnotationStore();
    store.add({
      target: targetForNode(prompt, "paragraph-1"),
      body: "Tighten this.",
      intent: "agent-request",
      author: "ford",
    });
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);

    // Edit mode stays clean of the annotation layer — no bubble yet.
    expect(
      document.querySelector('[data-lab-comment-indicator="paragraph-1"]'),
    ).toBeNull();

    // The AI state shows the bubble.
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    const indicator = document.querySelector<HTMLElement>(
      '[data-lab-comment-indicator="paragraph-1"]',
    )!;
    expect(indicator).toBeTruthy();
    // Portaled INTO the rows container so it rides the scroll with the text.
    expect(
      document.querySelector("[data-prompt-flow-rows]")!.contains(indicator),
    ).toBe(true);
    expect(indicator.textContent).toContain("1");

    // Hover lists the thread: author + first line.
    fireEvent.mouseEnter(indicator);
    const popover = document.querySelector(
      '[data-lab-comment-popover="paragraph-1"]',
    )!;
    expect(popover).toBeTruthy();
    expect(popover.textContent).toContain("ford");
    expect(popover.textContent).toContain("Tighten this.");

    // Click selects the block — visible back on the Edit tab, where the
    // DETAILS zone mounts for paragraph-1.
    fireEvent.click(within(indicator).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      document.querySelector('[data-lab-zone="details"]')?.textContent,
    ).toContain("paragraph");
  });

  test("clicking a bubble reopens the inline composer prefilled; saving refiles and dismisses", async () => {
    const filed: Array<{ body: string; nodeId: string | null }> = [];
    const dismissed: string[] = [];
    const session: PromptEditSession = {
      requests: [
        {
          alias: "R1",
          annotationId: "ann-R1",
          author: "you",
          status: "open",
          body: "Tighten this.",
          target: {
            kind: "prompt-node",
            docId: "controlled-style-test",
            nodeId: "paragraph-1",
          },
          disposition: "batch",
        },
      ],
      proposals: [],
      onFileRequest: (filing) => {
        filed.push({
          body: filing.body,
          nodeId: filing.target ? filing.target.nodeId : null,
        });
      },
      onDismissRequest: (id) => {
        dismissed.push(id);
      },
    };
    render(<PromptInlineLab prompt={prompt} promptEditSession={session} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    const indicator = document.querySelector<HTMLElement>(
      '[data-lab-comment-indicator="paragraph-1"]',
    )!;
    fireEvent.click(within(indicator).getByRole("button"));

    // The inline composer opens PREFILLED with the note.
    const textarea = document
      .querySelector("[data-lab-composer]")!
      .querySelector("textarea")!;
    expect(textarea.value).toBe("Tighten this.");

    // Saving refiles (same target, new body) and dismisses the original.
    fireEvent.change(textarea, { target: { value: "Tighten this a lot." } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => {
      expect(dismissed).toEqual(["ann-R1"]);
    });
    expect(filed).toEqual([
      { body: "Tighten this a lot.", nodeId: "paragraph-1" },
    ]);
    expect(document.querySelector("[data-lab-composer]")).toBeNull();
  });

  test("document-level notes grow no bubble", () => {
    render(
      <PromptInlineLab
        prompt={prompt}
        promptEditSession={{
          requests: [
            {
              alias: "R3",
              author: "you",
              status: "open",
              body: "Whole-document note.",
              target: null,
              disposition: "global",
            },
          ],
          proposals: [],
        }}
      />,
    );
    expect(document.querySelector("[data-lab-comment-indicator]")).toBeNull();
    // …but the note still lists in the AI workspace's session rail.
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    expect(
      document.querySelector('[data-prompt-session-card="R3"]'),
    ).toBeTruthy();
  });
});

const prompt: PromptDocument = {
  kind: "prompt",
  schemaVersion: "prompt-kit/v1",
  id: "controlled-style-test",
  nodes: [
    { type: "paragraph", id: "paragraph-1", content: ["Hello"] },
    {
      type: "bulletList",
      id: "list-1",
      items: [
        { type: "listItem", id: "item-1", content: ["First item"] },
        { type: "listItem", id: "item-2", content: ["Second item"] },
      ],
    },
  ],
};

/** Section > list > items — a three-level chain for breadcrumb tests. */
const nestedPrompt: PromptDocument = {
  kind: "prompt",
  schemaVersion: "prompt-kit/v1",
  id: "nested-scope-test",
  nodes: [
    {
      type: "section",
      tag: "steps",
      id: "sec-1",
      children: [
        {
          type: "bulletList",
          id: "list-1",
          items: [
            { type: "listItem", id: "item-1", content: ["Step one"] },
            { type: "listItem", id: "item-2", content: ["Step two"] },
          ],
        },
      ],
    },
  ],
};

/** The anchored composer popover, or null. */
function composer(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-lab-composer]");
}

/** The controlled selected ring overlay, or null. */
function selectedRing(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-annotation-ui="selected-ring"]',
  );
}

/**
 * The row's `[data-prompt-row-text]` display region. Rings and popover
 * anchors measure THESE (the ring hugs the content), so geometry stubs go on
 * the region, never the full-width row div.
 */
function textRegion(row: HTMLElement): HTMLElement {
  const region = row.querySelector<HTMLElement>("[data-prompt-row-text]");
  expect(region).toBeTruthy();
  return region!;
}

/** Pins a fixed client rect on `element` (happy-dom rects default to zero). */
function stubRect(element: HTMLElement, top: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      top,
      left: 0,
      right: 100,
      bottom: top + height,
      width: 100,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/**
 * Cmd+drag-selects the word "Hello" in paragraph-1 (fake Selection released
 * via a meta-modified mouseup) — pins a prompt-range target and opens the
 * anchored popover. Pass `modified: false` for a plain, unmodified drag,
 * which annotate mode ignores.
 */
function dragSelectHello(options: { modified?: boolean } = {}): void {
  const region = document.querySelector<HTMLElement>(
    '[data-prompt-node-id="paragraph-1"] [data-prompt-row-text]',
  );
  expect(region).toBeTruthy();

  const walker = document.createTreeWalker(region!, NodeFilter.SHOW_TEXT);
  let textNode: Text | null = null;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if ((current as Text).data.includes("Hello")) {
      textNode = current as Text;
      break;
    }
  }
  expect(textNode).toBeTruthy();

  const base = textNode!.data.indexOf("Hello");
  const range = document.createRange();
  range.setStart(textNode!, base);
  range.setEnd(textNode!, base + "Hello".length);

  const fakeSelection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => "Hello",
  } as unknown as Selection;
  const originalGetSelection = window.getSelection;
  window.getSelection = () => fakeSelection;
  try {
    fireEvent.mouseUp(region!, { metaKey: options.modified !== false });
  } finally {
    window.getSelection = originalGetSelection;
  }
}

/**
 * Types into the open composer and files it with THE gesture — Queue. A node
 * target queues as `batch`, a document target as `global` (run-now retired
 * 2026-08-05).
 */
function submitComposer(body: string): void {
  const popover = composer();
  expect(popover).toBeTruthy();
  const primary = popover!.querySelector<HTMLButtonElement>(
    '[data-annotation-composer-action="batch"], [data-annotation-composer-action="global"]',
  );
  expect(primary).toBeTruthy();
  fileComposer(body);
}

/** Types into the open composer and clicks its Queue action. */
function fileComposer(body: string): void {
  const popover = composer();
  expect(popover).toBeTruthy();
  const textarea = popover!.querySelector("textarea") as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: body } });
  fireEvent.click(within(popover!).getByLabelText("Queue"));
}

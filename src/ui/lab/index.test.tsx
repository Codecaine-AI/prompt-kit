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
} from "../prompt-flow/xml-line-model";
import { PromptInlineLab } from ".";

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
  test("renders the statusbar and the tabbed inspector", () => {
    const markup = renderToStaticMarkup(<PromptInlineLab prompt={prompt} />);

    // Statusbar: view tabs and token count. No validity chip — validity
    // surfaces through the save status and DETAILS diagnostics — and no
    // outline toggle: the section outline is part of the editor surface.
    expect(markup).toContain("System");
    expect(markup).toContain("Context");
    expect(markup).toContain("tok");
    expect(markup).not.toContain("section outline");
    expect(markup).not.toContain(">valid<");

    // Inspector: three tabs plus the collapse affordance.
    expect(markup).toContain("Agent");
    expect(markup).toContain("Details");
    expect(markup).toContain("Revisions");
    expect(markup).toContain("Collapse inspector");

    // Autosave replaces explicit save/reset controls.
    expect(markup).not.toContain(">Save<");
    expect(markup).not.toContain("Reset draft");
  });

  test("does not surface the saved hash in the statusbar", () => {
    // The hash lives in the host page header and the REVISIONS tab; the lab
    // statusbar stays quiet.
    const hash = "pk1-d631b526902f7eb5bcbb683721b9b2a1e3373c6892";
    const markup = renderToStaticMarkup(
      <PromptInlineLab prompt={prompt} savedHash={hash} />,
    );

    expect(markup).not.toContain(hash);
    expect(markup).not.toContain("d631b52690");
  });

  test("renders host revisions content inside the inspector", () => {
    const markup = renderToStaticMarkup(
      <PromptInlineLab
        prompt={prompt}
        revisionsZone={<div data-testid="revisions">rev-history</div>}
      />,
    );

    // The inspector body defaults to DETAILS; the revisions node mounts only
    // when its tab is active, so the default markup omits it.
    expect(markup).not.toContain("rev-history");
    expect(markup).toContain("Select a prompt block");
  });
});

describe("PromptInlineLab undo/redo", () => {
  test("the statusbar carries no undo/redo buttons", () => {
    render(<PromptInlineLab prompt={prompt} />);

    // Undo/redo are keyboard-only; the statusbar keeps save status, ANNOTATE
    // and the collapsed-inspector affordance only.
    expect(screen.queryByLabelText("Undo")).toBeNull();
    expect(screen.queryByLabelText("Redo")).toBeNull();
    expect(document.querySelector('[title*="mod+z"]')).toBeNull();
    expect(screen.getByText("Annotate")).toBeTruthy();
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
  test("the ANNOTATE toggle swaps the inspector for the annotations pane", () => {
    render(<PromptInlineLab prompt={prompt} />);

    // Edit mode: no annotations pane on screen.
    expect(document.querySelector('[data-plannotator="root"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    // Annotate mode: pane mounted, inspector tabs gone.
    expect(document.querySelector('[data-plannotator="root"]')).toBeTruthy();
    expect(screen.getByText("Annotations")).toBeTruthy();
    expect(screen.queryByText("Details")).toBeNull();
    expect(screen.queryByText("Revisions")).toBeNull();

    // The pane header's exit affordance returns to edit mode.
    fireEvent.click(screen.getByLabelText("Exit annotate mode"));
    expect(document.querySelector('[data-plannotator="root"]')).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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
    });
    expect(added.body).toBe("Tighten the opener.");
    expect(added.intent).toBe("agent-request");
    expect(added.status).toBe("open");
  });

  test("hovering a node's row shows the glide ring and an inspector-named chip", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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

  test("plain hover targets a single bullet; Alt-hover expands to the whole list", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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

    // Alt held: the hovered row's PARENT block resolves — chip names the
    // list, exactly the way the inspector does.
    fireEvent.mouseMove(itemRow!, { altKey: true });
    expect(
      document.querySelector('[data-annotation-ui="hover-chip"]')?.textContent,
    ).toBe("Bullet list");
  });

  test("clicking a node opens the anchored popover and Annotate lands an agent request", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    fireEvent.click(
      document.querySelector('[data-prompt-node-id="paragraph-1"]')!,
    );

    // Pinning draws the selected ring over the node's rows...
    expect(
      document.querySelector('[data-annotation-ui="selected-ring"]'),
    ).toBeTruthy();

    // ...and opens the composer popover next to them, labeled like the
    // inspector. No intent picker — every annotation is an agent request.
    expect(composer()).toBeTruthy();
    expect(composer()!.textContent).toContain("Paragraph");
    expect(within(composer()!).queryByText("Note")).toBeNull();
    submitComposer("Fix the wording here.");

    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    expect(store.list()[0].target).toEqual({
      kind: "prompt-node",
      docId: "controlled-style-test",
      nodeId: "paragraph-1",
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
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    fireEvent.click(document.querySelector('[data-prompt-node-id="item-1"]')!);

    expect(composer()).toBeTruthy();
    expect(composer()!.textContent).toContain("List item");
    submitComposer("Reorder this step.");

    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    expect(store.list()[0].target).toEqual({
      kind: "prompt-node",
      docId: "controlled-style-test",
      nodeId: "item-1",
    });
    expect(store.list()[0].intent).toBe("agent-request");
  });

  test("Alt-clicking a bullet pins the whole LIST", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    fireEvent.click(document.querySelector('[data-prompt-node-id="item-2"]')!, {
      altKey: true,
    });

    expect(composer()).toBeTruthy();
    expect(composer()!.textContent).toContain("Bullet list");
    submitComposer("Merge these bullets.");

    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    expect(store.list()[0].target).toEqual({
      kind: "prompt-node",
      docId: "controlled-style-test",
      nodeId: "list-1",
    });
  });

  test("Escape and Cancel both dismiss the popover and clear the target", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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

    // The drag release pins the range target and opens the anchored popover
    // labeled with the quoted text.
    expect(composer()).toBeTruthy();
    expect(composer()!.textContent).toContain('Text "Hello"');
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
    });
  });

  test("a plain (unmodified) drag neither opens the composer nor pins a target", () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    const region = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="paragraph-1"] [data-prompt-row-text]',
    )!;
    // The drag starts with Cmd held; by the time the mouse releases the
    // modifier is already up — the drag must still count as modified.
    fireEvent.mouseDown(region, { metaKey: true });
    dragSelectHello({ modified: false });

    expect(composer()).toBeTruthy();
    expect(composer()!.textContent).toContain('Text "Hello"');
  });

  test("a Cmd+drag across bullets maps to the LIST: ring and composer cover the swath, the ancestor range lands", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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

    // Start and end rows are different bullets → the target widens to their
    // LIST: the composer opens on the swath with the list on the breadcrumb…
    expect(composer()).toBeTruthy();
    expect(composer()!.textContent).toContain('Text "');
    expect(
      composer()!.querySelector('[data-annotation-scope="list-1"]')
        ?.textContent,
    ).toBe("Bullet list");
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
    });
  });

  test("annotate mode disarms click-to-edit and keeps row text natively selectable", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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
    // hijack is gated on annotate mode, not gone.
    fireEvent.click(screen.getByLabelText("Exit annotate mode"));
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

    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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
    fireEvent.click(screen.getByLabelText("Exit annotate mode"));
    expect(
      Array.from(document.querySelectorAll("style"))
        .map((style) => style.textContent)
        .join("\n"),
    ).not.toContain("[data-prompt-affordance]");
  });

  test("the targeting rings hug the row's text region, not the full row", () => {
    render(<PromptInlineLab prompt={prompt} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    fireEvent.click(screen.getByText("Run agent"));

    await waitFor(() => {
      expect(runCalls).toEqual([added.id]);
    });
  });
});

describe("PromptInlineLab scope breadcrumb", () => {
  test("a pinned bullet shows the leaf-first chain and widening re-targets the list", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={nestedPrompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    // Give the item rows' TEXT regions real geometry so the selected ring's
    // union rect is observable (happy-dom rects default to zero). The ring
    // measures the regions, not the full-width rows — display auto-sizes to
    // the content.
    stubRect(
      textRegion(
        document.querySelector<HTMLElement>('[data-prompt-node-id="item-1"]')!,
      ),
      10,
      10,
    );
    stubRect(
      textRegion(
        document.querySelector<HTMLElement>('[data-prompt-node-id="item-2"]')!,
      ),
      20,
      10,
    );

    fireEvent.click(document.querySelector('[data-prompt-node-id="item-1"]')!);
    expect(composer()).toBeTruthy();

    // Leaf-first chain: item → list → section, leaf active.
    const segments = Array.from(
      composer()!.querySelectorAll<HTMLElement>("[data-annotation-scope]"),
    );
    expect(segments.map((segment) => segment.textContent)).toEqual([
      "List item",
      "Bullet list",
      "<steps>",
    ]);
    expect(segments.map((segment) => segment.getAttribute("aria-pressed"))).toEqual(
      ["true", "false", "false"],
    );
    // The selected ring covers just the pinned bullet's row (top 10, h 10,
    // inset 3).
    expect(selectedRing()!.style.top).toBe("7px");
    expect(selectedRing()!.style.height).toBe("16px");

    // Widening to the list re-rings BOTH item rows live (union 10..30) and
    // moves the active segment.
    fireEvent.click(composer()!.querySelector('[data-annotation-scope="list-1"]')!);
    expect(
      composer()!
        .querySelector('[data-annotation-scope="list-1"]')!
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(selectedRing()!.style.top).toBe("7px");
    expect(selectedRing()!.style.height).toBe("26px");

    // What submits is the widened target.
    submitComposer("Merge these steps.");
    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    expect(store.list()[0].target).toEqual({
      kind: "prompt-node",
      docId: "nested-scope-test",
      nodeId: "list-1",
    });
  });

  test("clicking the same bullet again widens one ancestor level and cycles at the top", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={nestedPrompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    // Ring geometry reads the rows' text regions — see the test above.
    stubRect(
      textRegion(
        document.querySelector<HTMLElement>('[data-prompt-node-id="item-1"]')!,
      ),
      10,
      10,
    );
    stubRect(
      textRegion(
        document.querySelector<HTMLElement>('[data-prompt-node-id="item-2"]')!,
      ),
      20,
      10,
    );

    const itemRow = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="item-1"]',
    )!;
    const activeScope = () =>
      composer()!
        .querySelector('[data-annotation-scope][aria-pressed="true"]')!
        .getAttribute("data-annotation-scope");

    // First click pins the bullet as the leaf base.
    fireEvent.click(itemRow);
    expect(composer()).toBeTruthy();
    expect(activeScope()).toBe("item-1");
    expect(selectedRing()!.style.height).toBe("16px");

    // Same row again: widen to the list — ring grows to both item rows.
    fireEvent.click(itemRow);
    expect(composer()).toBeTruthy();
    expect(activeScope()).toBe("list-1");
    expect(selectedRing()!.style.height).toBe("26px");

    // Again: the section.
    fireEvent.click(itemRow);
    expect(activeScope()).toBe("sec-1");

    // At the top the next click cycles back to the leaf.
    fireEvent.click(itemRow);
    expect(activeScope()).toBe("item-1");
    expect(selectedRing()!.style.height).toBe("16px");

    // One more widen, then submit — the widened list target is what lands.
    fireEvent.click(itemRow);
    submitComposer("Merge these steps.");
    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    expect(store.list()[0].target).toEqual({
      kind: "prompt-node",
      docId: "nested-scope-test",
      nodeId: "list-1",
    });
  });

  test("clicking a different bullet re-pins that row's leaf as a fresh base", () => {
    render(<PromptInlineLab prompt={nestedPrompt} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    const itemOne = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="item-1"]',
    )!;
    const itemTwo = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="item-2"]',
    )!;
    const activeScope = () =>
      composer()!
        .querySelector('[data-annotation-scope][aria-pressed="true"]')!
        .getAttribute("data-annotation-scope");

    // Pin item-1 and widen it to the list via click-again.
    fireEvent.click(itemOne);
    fireEvent.click(itemOne);
    expect(activeScope()).toBe("list-1");

    // A DIFFERENT row is a fresh pin: leaf base item-2, scope reset to it.
    fireEvent.click(itemTwo);
    expect(activeScope()).toBe("item-2");
  });

  test("breadcrumb absolute jumps compose with click-again advances", () => {
    render(<PromptInlineLab prompt={nestedPrompt} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    const itemRow = document.querySelector<HTMLElement>(
      '[data-prompt-node-id="item-1"]',
    )!;
    const activeScope = () =>
      composer()!
        .querySelector('[data-annotation-scope][aria-pressed="true"]')!
        .getAttribute("data-annotation-scope");

    // Click-again advances to the list...
    fireEvent.click(itemRow);
    fireEvent.click(itemRow);
    expect(activeScope()).toBe("list-1");

    // ...the breadcrumb jumps back to the leaf (absolute)...
    fireEvent.click(composer()!.querySelector('[data-annotation-scope="item-1"]')!);
    expect(activeScope()).toBe("item-1");

    // ...and click-again advances relative to the breadcrumb's level.
    fireEvent.click(itemRow);
    expect(activeScope()).toBe("list-1");

    // Breadcrumb to the top, then click-again wraps to the leaf.
    fireEvent.click(composer()!.querySelector('[data-annotation-scope="sec-1"]')!);
    expect(activeScope()).toBe("sec-1");
    fireEvent.click(itemRow);
    expect(activeScope()).toBe("item-1");
  });

  test("a range base chains range → node and submits the widened node", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    dragSelectHello();
    expect(composer()).toBeTruthy();

    const segments = Array.from(
      composer()!.querySelectorAll<HTMLElement>("[data-annotation-scope]"),
    );
    expect(segments.map((segment) => segment.textContent)).toEqual([
      'Text "Hello"',
      "Paragraph",
    ]);
    expect(segments[0].getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(
      composer()!.querySelector('[data-annotation-scope="paragraph-1"]')!,
    );
    submitComposer("Rework this paragraph.");

    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    expect(store.list()[0].target).toEqual({
      kind: "prompt-node",
      docId: "controlled-style-test",
      nodeId: "paragraph-1",
    });
  });

  test("the range segment restores the exact drag after widening", async () => {
    const store = createAnnotationStore();
    render(<PromptInlineLab prompt={prompt} annotationStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

    dragSelectHello();
    expect(composer()).toBeTruthy();

    // Widen to the owning node, then click the quote segment to restore the
    // original range target.
    fireEvent.click(
      composer()!.querySelector('[data-annotation-scope="paragraph-1"]')!,
    );
    fireEvent.click(composer()!.querySelector('[data-annotation-scope="range"]')!);
    expect(
      composer()!
        .querySelector('[data-annotation-scope="range"]')!
        .getAttribute("aria-pressed"),
    ).toBe("true");
    submitComposer("Tighten this phrase.");

    await waitFor(() => {
      expect(store.list().length).toBe(1);
    });
    expect(store.list()[0].target).toEqual({
      kind: "prompt-range",
      docId: "controlled-style-test",
      nodeId: "paragraph-1",
      start: 0,
      end: 5,
      quote: "Hello",
    });
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
  return document.querySelector<HTMLElement>("[data-annotation-composer]");
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

/** Types into the open popover and clicks its Annotate submit. */
function submitComposer(body: string): void {
  const popover = composer();
  expect(popover).toBeTruthy();
  const textarea = popover!.querySelector("textarea") as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: body } });
  fireEvent.click(within(popover!).getByText("Annotate"));
}

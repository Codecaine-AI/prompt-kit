import { describe, expect, test } from "bun:test";
import type { PromptDocument } from "../../index";
import { renderToStaticMarkup } from "react-dom/server";

import { PROMPT_STYLE_DEFAULTS } from "../style/prompt-style-settings";
import { PromptInlineLab } from ".";

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
        getItem() {
          storageOperations.push("getItem");
          return null;
        },
        setItem() {
          storageOperations.push("setItem");
        },
        removeItem() {
          storageOperations.push("removeItem");
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
      expect(storageOperations).toEqual([]);
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

const prompt: PromptDocument = {
  kind: "prompt",
  schemaVersion: "prompt-kit/v1",
  id: "controlled-style-test",
  nodes: [{ type: "paragraph", id: "paragraph-1", content: ["Hello"] }],
};

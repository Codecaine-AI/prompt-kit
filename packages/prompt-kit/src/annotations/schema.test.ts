import { describe, expect, test } from "bun:test";

import { PROMPT_KIT_SCHEMA_VERSION, type PromptDocument } from "../nodes/types";
import { ensurePromptNodeIds } from "../nodes/ids";
import {
  promptAnnotationSchema,
  promptNodeTargetAdapter,
  promptRangeTargetAdapter,
  targetForNode,
  type PromptAnnotation,
  type PromptAnnotationsDocument,
  type PromptRangeTarget,
} from "./schema";
import {
  buildXmlLineModel,
  nodeRenderedText,
} from "../ui/prompt-flow/xml-line-model";

const doc: PromptDocument = ensurePromptNodeIds({
  kind: "prompt",
  schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
  id: "prompt-doc-1",
  title: "Fixture",
  nodes: [
    {
      type: "section",
      tag: "context",
      children: [{ type: "paragraph", content: ["Some context."] }],
    },
    {
      type: "bulletList",
      items: [{ type: "listItem", content: ["First item"] }],
    },
  ],
});

const sectionId = doc.nodes[0]!.id!;
const paragraphId = (doc.nodes[0] as { children: { id?: string }[] }).children[0]!
  .id!;
// ensurePromptNodeIds assigns every list ITEM its own stable id too — items
// are annotation targets in their own right (bullet-level granularity).
const itemId = (doc.nodes[1] as { items: { id?: string }[] }).items[0]!.id!;

function annotation(overrides: Partial<PromptAnnotation> = {}): PromptAnnotation {
  return {
    id: "ann-1",
    target: targetForNode(doc, sectionId),
    body: "Tighten this section.",
    intent: "agent-request",
    author: "ford",
    status: "open",
    createdAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

function documentWith(
  ...annotations: PromptAnnotation[]
): PromptAnnotationsDocument {
  return { schemaVersion: 1, annotations };
}

describe("promptNodeTargetAdapter", () => {
  test("validates a well-formed target", () => {
    const issues: { path: string; message: string }[] = [];
    const target = promptNodeTargetAdapter.validateTarget(
      { kind: "prompt-node", docId: "prompt-doc-1", nodeId: sectionId },
      "$.annotations[0].target",
      issues,
    );
    expect(issues).toEqual([]);
    expect(target).toEqual({
      kind: "prompt-node",
      docId: "prompt-doc-1",
      nodeId: sectionId,
    });
  });

  test("accepts user-editable node ids outside the strict isId pattern", () => {
    const issues: { path: string; message: string }[] = [];
    const target = promptNodeTargetAdapter.validateTarget(
      { kind: "prompt-node", docId: "prompt-doc-1", nodeId: "my node (draft)" },
      "$.annotations[0].target",
      issues,
    );
    expect(issues).toEqual([]);
    expect(target?.nodeId).toBe("my node (draft)");
  });

  test("rejects a missing docId", () => {
    const issues: { path: string; message: string }[] = [];
    const target = promptNodeTargetAdapter.validateTarget(
      { kind: "prompt-node", nodeId: sectionId },
      "$.annotations[0].target",
      issues,
    );
    expect(target).toBeNull();
    expect(issues).toEqual([
      {
        path: "$.annotations[0].target.docId",
        message: "Prompt node target requires a non-empty docId.",
      },
    ]);
  });

  test("rejects empty nodeId", () => {
    const issues: { path: string; message: string }[] = [];
    const target = promptNodeTargetAdapter.validateTarget(
      { kind: "prompt-node", docId: "prompt-doc-1", nodeId: "" },
      "$.annotations[0].target",
      issues,
    );
    expect(target).toBeNull();
    expect(issues).toEqual([
      {
        path: "$.annotations[0].target.nodeId",
        message: "Prompt node target requires a non-empty nodeId.",
      },
    ]);
  });

  test("keys and labels targets", () => {
    const target = targetForNode(doc, sectionId);
    expect(promptAnnotationSchema.targetKey(target)).toBe(
      `prompt-node:prompt-doc-1:${sectionId}`,
    );
    expect(promptAnnotationSchema.targetLabel(target)).toBe(`Node ${sectionId}`);
  });

  test("does not report an existing LIST ITEM id as dangling", () => {
    // promptHasNode's visitPrompt walk reaches list items, so an item-id
    // target resolves like any block target.
    expect(itemId).toBeTruthy();
    expect(
      promptNodeTargetAdapter.dangling(targetForNode(doc, itemId), doc),
    ).toBeNull();
  });

  test("reports a removed list item id as dangling", () => {
    const docWithoutItems = ensurePromptNodeIds({
      ...doc,
      nodes: [doc.nodes[0]!],
    });
    expect(
      promptNodeTargetAdapter.dangling(targetForNode(doc, itemId), docWithoutItems),
    ).toBe(`Node "${itemId}" no longer exists.`);
  });
});

describe("promptRangeTargetAdapter", () => {
  // Offsets index the node's rendered text — its own lines joined with "\n"
  // — so the fixture derives them from the same helper the adapter uses.
  const paragraphText = nodeRenderedText(buildXmlLineModel(doc).lines, paragraphId);
  const quote = "Some context.";
  const start = paragraphText.indexOf(quote);
  const rangeTarget: PromptRangeTarget = {
    kind: "prompt-range",
    docId: "prompt-doc-1",
    nodeId: paragraphId,
    start,
    end: start + quote.length,
    quote,
  };

  test("the fixture quote exists in the rendered node text", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(paragraphText.slice(rangeTarget.start, rangeTarget.end)).toBe(quote);
  });

  test("validates a well-formed target", () => {
    const issues: { path: string; message: string }[] = [];
    const target = promptRangeTargetAdapter.validateTarget(
      { ...rangeTarget },
      "$.annotations[0].target",
      issues,
    );
    expect(issues).toEqual([]);
    expect(target).toEqual(rangeTarget);
  });

  test("rejects missing/invalid fields with per-field issues", () => {
    const issues: { path: string; message: string }[] = [];
    const target = promptRangeTargetAdapter.validateTarget(
      { kind: "prompt-range", docId: "", nodeId: "", start: -1, end: 4, quote: "" },
      "$.t",
      issues,
    );
    expect(target).toBeNull();
    expect(issues).toEqual([
      { path: "$.t.docId", message: "Prompt range target requires a non-empty docId." },
      { path: "$.t.nodeId", message: "Prompt range target requires a non-empty nodeId." },
      { path: "$.t.start", message: "Prompt range target requires an integer start >= 0." },
      { path: "$.t.quote", message: "Prompt range target requires a non-empty quote." },
    ]);
  });

  test("rejects end <= start and non-integer offsets", () => {
    const issues: { path: string; message: string }[] = [];
    const target = promptRangeTargetAdapter.validateTarget(
      { ...rangeTarget, start: 4, end: 4 },
      "$.t",
      issues,
    );
    expect(target).toBeNull();
    expect(issues).toEqual([
      { path: "$.t.end", message: "Prompt range target requires an integer end > start." },
    ]);

    const fractional: { path: string; message: string }[] = [];
    expect(
      promptRangeTargetAdapter.validateTarget(
        { ...rangeTarget, start: 1.5 },
        "$.t",
        fractional,
      ),
    ).toBeNull();
    expect(fractional).toEqual([
      { path: "$.t.start", message: "Prompt range target requires an integer start >= 0." },
    ]);
  });

  test("keys and labels targets", () => {
    expect(promptAnnotationSchema.targetKey(rangeTarget)).toBe(
      `prompt-range:prompt-doc-1:${paragraphId}:${rangeTarget.start}-${rangeTarget.end}`,
    );
    expect(promptAnnotationSchema.targetLabel(rangeTarget)).toBe(
      'Text "Some context."',
    );
  });

  test("label normalizes whitespace and truncates long quotes", () => {
    const longQuote =
      "  A   very\nlong selection whose text keeps going well past forty characters  ";
    const label = promptRangeTargetAdapter.label({
      ...rangeTarget,
      quote: longQuote,
    });
    expect(label).toBe('Text "A very long selection whose text keeps g…"');
    // 40 quote characters plus the ellipsis between the quotes.
    expect(label).not.toContain("\n");
  });

  test("round-trips through the schema alongside prompt-node annotations", () => {
    const input = documentWith(
      annotation(),
      annotation({ id: "ann-2", target: rangeTarget }),
    );
    const result = promptAnnotationSchema.validateDocument(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document).toEqual(input);
  });

  describe("dangling", () => {
    test("skips while the document is not loaded", () => {
      expect(promptRangeTargetAdapter.dangling(rangeTarget, null)).toBe("skip");
    });

    test("flags a document id mismatch", () => {
      expect(
        promptRangeTargetAdapter.dangling(
          { ...rangeTarget, docId: "other-doc" },
          doc,
        ),
      ).toBe('Annotation targets document "other-doc" but "prompt-doc-1" is loaded.');
    });

    test("flags a missing node", () => {
      expect(
        promptRangeTargetAdapter.dangling(
          { ...rangeTarget, nodeId: "node-gone" },
          doc,
        ),
      ).toBe('Node "node-gone" no longer exists.');
    });

    test("resolves while the quote still appears in the rendered text", () => {
      expect(promptRangeTargetAdapter.dangling(rangeTarget, doc)).toBeNull();
    });

    test("resolves a range anchored on a LIST ITEM id", () => {
      // An item's rendered text is its own line; offsets index that string.
      const itemText = nodeRenderedText(buildXmlLineModel(doc).lines, itemId);
      const itemQuote = "First item";
      const itemStart = itemText.indexOf(itemQuote);
      expect(itemStart).toBeGreaterThanOrEqual(0);
      expect(
        promptRangeTargetAdapter.dangling(
          {
            kind: "prompt-range",
            docId: "prompt-doc-1",
            nodeId: itemId,
            start: itemStart,
            end: itemStart + itemQuote.length,
            quote: itemQuote,
          },
          doc,
        ),
      ).toBeNull();
    });

    test("flags quote drift after the node's text is edited", () => {
      const drifted = JSON.parse(JSON.stringify(doc)) as PromptDocument;
      (
        drifted.nodes[0] as unknown as { children: { content: string[] }[] }
      ).children[0]!.content = ["Different words entirely."];
      expect(promptRangeTargetAdapter.dangling(rangeTarget, drifted)).toBe(
        "Selected text no longer matches.",
      );
    });
  });
});

describe("promptAnnotationSchema.validateDocument", () => {
  test("round-trips a document with prompt-node annotations", () => {
    const input = documentWith(
      annotation(),
      annotation({
        id: "ann-2",
        target: targetForNode(doc, paragraphId),
        intent: "note",
        status: "resolved",
        resolution: "Done.",
      }),
    );
    const result = promptAnnotationSchema.validateDocument(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document).toEqual(input);
    }
  });

  test("rejects an unknown target kind with the configured message", () => {
    const result = promptAnnotationSchema.validateDocument(
      documentWith(
        annotation({
          target: { kind: "block", blockId: "b1" } as never,
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        {
          path: "$.annotations[0].target.kind",
          message: "Annotation target kind must be prompt-node or prompt-range.",
        },
      ]);
    }
  });

  test("rejects intents and statuses outside the configured sets", () => {
    const result = promptAnnotationSchema.validateDocument(
      documentWith(
        annotation({ intent: "todo" as never, status: "archived" as never }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        {
          path: "$.annotations[0].intent",
          message: "Annotation intent must be note or agent-request.",
        },
        {
          path: "$.annotations[0].status",
          message: "Annotation status must be open or resolved.",
        },
      ]);
    }
  });

  test("surfaces target field issues at nested paths", () => {
    const result = promptAnnotationSchema.validateDocument(
      documentWith(annotation({ target: { kind: "prompt-node" } as never })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        {
          path: "$.annotations[0].target.docId",
          message: "Prompt node target requires a non-empty docId.",
        },
        {
          path: "$.annotations[0].target.nodeId",
          message: "Prompt node target requires a non-empty nodeId.",
        },
      ]);
    }
  });
});

describe("promptAnnotationSchema.detectDanglingTargets", () => {
  test("skips checks while the document is not loaded", () => {
    const dangling = promptAnnotationSchema.detectDanglingTargets(
      documentWith(annotation({ target: targetForNode(doc, "gone") })),
      { "prompt-node": null },
    );
    expect(dangling).toEqual([]);
  });

  test("flags a document id mismatch", () => {
    const dangling = promptAnnotationSchema.detectDanglingTargets(
      documentWith(
        annotation({
          target: { kind: "prompt-node", docId: "other-doc", nodeId: sectionId },
        }),
      ),
      { "prompt-node": doc },
    );
    expect(dangling).toEqual([
      {
        annotationId: "ann-1",
        reason:
          'Annotation targets document "other-doc" but "prompt-doc-1" is loaded.',
      },
    ]);
  });

  test("flags a missing node and passes present nodes", () => {
    const dangling = promptAnnotationSchema.detectDanglingTargets(
      documentWith(
        annotation({ target: targetForNode(doc, "node-gone") }),
        annotation({ id: "ann-2", target: targetForNode(doc, paragraphId) }),
      ),
      { "prompt-node": doc },
    );
    expect(dangling).toEqual([
      { annotationId: "ann-1", reason: 'Node "node-gone" no longer exists.' },
    ]);
  });

  test("resolves nested list item ids assigned by ensurePromptNodeIds", () => {
    const listItemId = (doc.nodes[1] as { items: { id?: string }[] }).items[0]!
      .id!;
    const dangling = promptAnnotationSchema.detectDanglingTargets(
      documentWith(annotation({ target: targetForNode(doc, listItemId) })),
      { "prompt-node": doc },
    );
    expect(dangling).toEqual([]);
  });
});

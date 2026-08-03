import { describe, expect, test } from "bun:test";

import { promptDocumentJsonSchema, validatePromptDocumentShape } from "./index";
import { canonicalizePrompt } from "../canonical";
import { PROMPT_KIT_SCHEMA_VERSION } from "../nodes/types";
import type { PromptDocument } from "../nodes/types";

function everyNodeTypeDocument(): PromptDocument {
  return {
    kind: "prompt",
    schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
    id: "schema-fixture",
    title: "Schema fixture",
    description: "Exercises every node type.",
    archetype: "workflow",
    metadata: { owner: "prompt-kit" },
    nodes: [
      {
        type: "section",
        tag: "purpose",
        title: "Purpose",
        attrs: { priority: 1, visible: true, note: null, label: "x" },
        children: [
          {
            type: "paragraph",
            content: [
              "Study ",
              { type: "variable", name: "topic", fallback: ["the codebase"] },
              " via ",
              { type: "reference", kind: "tool", name: "search" },
              ".",
            ],
          },
        ],
      },
      {
        type: "bulletList",
        items: [{ type: "listItem", content: ["Item."] }],
      },
      {
        type: "orderedList",
        start: 3,
        items: [
          {
            type: "listItem",
            content: ["Step."],
            children: [{ type: "raw", value: "verbatim" }],
          },
        ],
      },
      {
        type: "field",
        label: "constraints",
        value: ["Keep it short."],
        children: [{ type: "paragraph", content: ["Detail."] }],
      },
      { type: "codeBlock", language: "ts", code: "let x = 1;" },
      {
        type: "example",
        title: "Example",
        children: [{ type: "paragraph", content: ["Example content."] }],
      },
      { type: "raw", value: "raw text" },
      {
        type: "contextUsage",
        contextId: "notes",
        tag: "notes",
        instructions: [{ type: "paragraph", content: ["Use the notes."] }],
      },
    ],
  };
}

describe("promptDocumentJsonSchema", () => {
  test("is a draft 2020-12 schema covering every block node type", () => {
    expect(promptDocumentJsonSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(promptDocumentJsonSchema.properties.schemaVersion.const).toBe(
      PROMPT_KIT_SCHEMA_VERSION,
    );
    const blockRefs: string[] = promptDocumentJsonSchema.$defs.promptBlockNode.anyOf.map(
      (entry) => entry.$ref,
    );
    for (const def of [
      "sectionNode",
      "paragraphNode",
      "bulletListNode",
      "orderedListNode",
      "fieldNode",
      "codeBlockNode",
      "exampleNode",
      "rawNode",
      "contextUsageNode",
    ]) {
      expect(blockRefs).toContain(`#/$defs/${def}`);
      expect(promptDocumentJsonSchema.$defs).toHaveProperty(def);
    }
    expect(promptDocumentJsonSchema.$defs).toHaveProperty("listItemNode");
    expect(promptDocumentJsonSchema.$defs).toHaveProperty("variableReferenceNode");
    expect(promptDocumentJsonSchema.$defs).toHaveProperty("referenceNode");
  });
});

describe("validatePromptDocumentShape", () => {
  test("accepts a document containing every node type", () => {
    const result = validatePromptDocumentShape(everyNodeTypeDocument());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("round-trips through canonical serialization", () => {
    const canonical = canonicalizePrompt(everyNodeTypeDocument());
    const result = validatePromptDocumentShape(JSON.parse(canonical));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("rejects unknown node types with a useful path", () => {
    const doc = everyNodeTypeDocument() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    doc.nodes.push({ type: "mystery" });
    const result = validatePromptDocumentShape(doc);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('nodes[8]: unknown node type "mystery"');
  });

  test("rejects a section missing its tag", () => {
    const doc = everyNodeTypeDocument();
    const section = doc.nodes[0] as unknown as Record<string, unknown>;
    delete section.tag;
    const result = validatePromptDocumentShape(doc);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.startsWith('nodes[0]: missing required field "tag" on section node'),
      ),
    ).toBe(true);
  });

  test("rejects wrong schemaVersion", () => {
    const doc = { ...everyNodeTypeDocument(), schemaVersion: "prompt-kit/v0" };
    const result = validatePromptDocumentShape(doc);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.startsWith("document.schemaVersion:")),
    ).toBe(true);
  });

  test("rejects non-array nodes", () => {
    const doc = { ...everyNodeTypeDocument(), nodes: {} };
    const result = validatePromptDocumentShape(doc);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "document.nodes: expected an array, got an object",
    );
  });

  test("rejects non-object documents and nested corruption", () => {
    expect(validatePromptDocumentShape(null).valid).toBe(false);
    expect(validatePromptDocumentShape("prompt").valid).toBe(false);

    const doc = everyNodeTypeDocument();
    const section = doc.nodes[0];
    if (section?.type === "section") {
      section.children = [
        { type: "paragraph" } as unknown as (typeof section.children)[number],
      ];
    }
    const result = validatePromptDocumentShape(doc);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'nodes[0].children[0]: missing required field "content" on paragraph node',
    );
  });
});

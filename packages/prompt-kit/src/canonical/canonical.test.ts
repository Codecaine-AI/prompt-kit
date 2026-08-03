import { describe, expect, test } from "bun:test";

import { canonicalizePrompt, hashPrompt, PROMPT_HASH_PREFIX } from "./index";
import { PROMPT_KIT_SCHEMA_VERSION } from "../nodes/types";
import type { PromptDocument } from "../nodes/types";

function fixtureDocument(): PromptDocument {
  return {
    kind: "prompt",
    schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
    id: "canonical-fixture",
    title: "Canonical fixture",
    archetype: "workflow",
    metadata: { owner: "prompt-kit", zeta: 1, alpha: { b: 2, a: 1 } },
    nodes: [
      {
        type: "section",
        id: "purpose",
        tag: "purpose",
        title: "Purpose",
        attrs: { priority: 1, visible: true, note: null },
        children: [
          {
            type: "paragraph",
            id: "purpose-p1",
            content: [
              "Study ",
              { type: "variable", name: "topic", fallback: ["the codebase"] },
              " via ",
              { type: "reference", kind: "tool", name: "search" },
              ".",
            ],
          },
          {
            type: "orderedList",
            id: "steps",
            start: 2,
            items: [
              {
                type: "listItem",
                id: "step-1",
                content: ["Read context."],
                children: [
                  { type: "raw", id: "step-1-raw", value: "verbatim" },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "field",
        id: "constraints",
        label: "constraints",
        value: ["Keep it short."],
      },
      { type: "codeBlock", id: "snippet", language: "ts", code: "let x = 1;" },
      {
        type: "contextUsage",
        id: "notes-usage",
        contextId: "notes",
        tag: "notes",
        instructions: [
          { type: "paragraph", id: "notes-p1", content: ["Use the notes."] },
        ],
      },
    ],
  };
}

/**
 * Same document as `fixtureDocument`, but every object literal lists its
 * keys in a different insertion order.
 */
function permutedFixtureDocument(): PromptDocument {
  return {
    nodes: [
      {
        children: [
          {
            content: [
              "Study ",
              { fallback: ["the codebase"], name: "topic", type: "variable" },
              " via ",
              { name: "search", kind: "tool", type: "reference" },
              ".",
            ],
            id: "purpose-p1",
            type: "paragraph",
          },
          {
            items: [
              {
                children: [
                  { value: "verbatim", id: "step-1-raw", type: "raw" },
                ],
                content: ["Read context."],
                id: "step-1",
                type: "listItem",
              },
            ],
            start: 2,
            id: "steps",
            type: "orderedList",
          },
        ],
        attrs: { visible: true, note: null, priority: 1 },
        title: "Purpose",
        tag: "purpose",
        id: "purpose",
        type: "section",
      },
      {
        value: ["Keep it short."],
        label: "constraints",
        id: "constraints",
        type: "field",
      },
      { code: "let x = 1;", language: "ts", id: "snippet", type: "codeBlock" },
      {
        instructions: [
          { content: ["Use the notes."], id: "notes-p1", type: "paragraph" },
        ],
        tag: "notes",
        contextId: "notes",
        id: "notes-usage",
        type: "contextUsage",
      },
    ],
    metadata: { alpha: { a: 1, b: 2 }, zeta: 1, owner: "prompt-kit" },
    archetype: "workflow",
    title: "Canonical fixture",
    id: "canonical-fixture",
    schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
    kind: "prompt",
  };
}

describe("canonicalizePrompt", () => {
  test("permuted object key order produces identical bytes and hash", () => {
    const a = fixtureDocument();
    const b = permutedFixtureDocument();
    expect(canonicalizePrompt(a)).toBe(canonicalizePrompt(b));
    expect(hashPrompt(a)).toBe(hashPrompt(b));
  });

  test("any block edit changes the hash", () => {
    const base = fixtureDocument();
    const baseHash = hashPrompt(base);

    const edits: PromptDocument[] = [
      // text edit inside a paragraph
      (() => {
        const doc = fixtureDocument();
        const section = doc.nodes[0];
        if (section?.type === "section") {
          const paragraph = section.children[0];
          if (paragraph?.type === "paragraph") {
            paragraph.content = ["Study something else."];
          }
        }
        return doc;
      })(),
      // block removal
      (() => {
        const doc = fixtureDocument();
        doc.nodes = doc.nodes.slice(0, -1);
        return doc;
      })(),
      // block reorder
      (() => {
        const doc = fixtureDocument();
        doc.nodes = [...doc.nodes.slice(1), doc.nodes[0]!];
        return doc;
      })(),
      // metadata edit
      (() => {
        const doc = fixtureDocument();
        doc.metadata = { ...doc.metadata, owner: "someone-else" };
        return doc;
      })(),
      // attribute edit on a section
      (() => {
        const doc = fixtureDocument();
        const section = doc.nodes[0];
        if (section?.type === "section") {
          section.attrs = { ...section.attrs, priority: 2 };
        }
        return doc;
      })(),
    ];

    for (const edited of edits) {
      expect(hashPrompt(edited)).not.toBe(baseHash);
    }
  });

  test("id assignment is stable across repeated canonicalize calls", () => {
    const withoutIds: PromptDocument = {
      kind: "prompt",
      schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
      id: "no-ids",
      nodes: [
        {
          type: "section",
          tag: "workflow",
          children: [
            { type: "paragraph", content: ["First."] },
            {
              type: "bulletList",
              items: [{ type: "listItem", content: ["Item."] }],
            },
          ],
        },
        { type: "paragraph", content: ["Second."] },
      ],
    };

    const first = canonicalizePrompt(withoutIds);
    const second = canonicalizePrompt(withoutIds);
    expect(first).toBe(second);
    expect(hashPrompt(withoutIds)).toBe(hashPrompt(withoutIds));

    // Canonicalizing the parsed canonical form is a fixed point.
    const parsed = JSON.parse(first) as PromptDocument;
    expect(canonicalizePrompt(parsed)).toBe(first);
  });

  test("drops undefined members and uses the pk1 prefix", () => {
    const doc = fixtureDocument();
    doc.title = undefined;
    const canonical = canonicalizePrompt(doc);
    expect(canonical).not.toContain('"title": "Canonical fixture"');
    expect(canonical.endsWith("\n")).toBe(true);
    expect(canonical).not.toContain("\r");
    expect(hashPrompt(doc)).toMatch(new RegExp(`^${PROMPT_HASH_PREFIX}[0-9a-f]{64}$`));
  });

  test("throws on unknown node types", () => {
    const doc = fixtureDocument();
    doc.nodes = [
      ...doc.nodes,
      { type: "mystery", id: "x" } as unknown as PromptDocument["nodes"][number],
    ];
    expect(() => canonicalizePrompt(doc)).toThrow('unknown node type "mystery"');
  });
});

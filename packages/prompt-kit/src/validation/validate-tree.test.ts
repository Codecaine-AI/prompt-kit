import { describe, expect, test } from "bun:test";

import { definePrompt, validatePrompt } from "..";

describe("validatePrompt", () => {
  test("accepts a valid prompt tree", () => {
    const prompt = definePrompt({
      id: "validPrompt",
      archetype: "workflow",
      nodes: [
        {
          type: "section",
          tag: "purpose",
          children: [
            {
              type: "paragraph",
              content: ["Handle ", { type: "variable", name: "request" }],
            },
          ],
        },
      ],
    });

    const result = validatePrompt(prompt, {
      declaredVariables: ["request"],
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  test("reports duplicate ids, invalid tags, and unknown variables", () => {
    const prompt = definePrompt({
      id: "invalidPrompt",
      archetype: "workflow",
      nodes: [
        {
          type: "section",
          id: "dup",
          tag: "not valid",
          children: [
            {
              type: "paragraph",
              content: [{ type: "variable", name: "missing" }],
            },
          ],
        },
        { type: "section", id: "dup", tag: "rules", children: [] },
      ],
    });

    const result = validatePrompt(prompt, {
      declaredVariables: ["known"],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "invalid_section_tag",
      "unknown_variable",
      "duplicate_node_id",
    ]);
  });
});

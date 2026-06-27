import { describe, expect, test } from "bun:test";

import {
  paragraph,
  section,
  validatePrompt,
  variable,
  workflowPrompt,
} from "..";

describe("validatePrompt", () => {
  test("accepts a valid prompt tree", () => {
    const prompt = workflowPrompt({
      id: "validPrompt",
      purpose: [paragraph(["Handle ", variable("request")])],
    });

    const result = validatePrompt(prompt, {
      declaredVariables: ["request"],
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  test("reports duplicate ids, invalid tags, and unknown variables", () => {
    const prompt = workflowPrompt({
      id: "invalidPrompt",
      sections: [
        section("not valid", [paragraph(variable("missing"))], { id: "dup" }),
        section("rules", [], { id: "dup" }),
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

import { describe, expect, test } from "bun:test";

import {
  bulletList,
  item,
  orderedList,
  paragraph,
  section,
  usesContext,
  variable,
  workflowPrompt,
} from "../../..";
import { renderXmlMarkdown } from "./render";

describe("renderXmlMarkdown", () => {
  test("renders nested sections and lists as XML-tagged Markdown", () => {
    const prompt = workflowPrompt({
      id: "sourceScoutPrompt",
      purpose: [
        bulletList(["Find and evaluate sources for a focused assignment."]),
      ],
      workflow: [
        orderedList([
          "Read the research brief.",
          item("Search for relevant evidence.", [
            bulletList(["Prefer primary sources.", "Track uncertainty explicitly."]),
          ]),
          "Write source notes.",
        ]),
      ],
    });

    expect(renderXmlMarkdown(prompt)).toBe(`<purpose>
    - Find and evaluate sources for a focused assignment.
</purpose>

<workflow>
    1. Read the research brief.
    2. Search for relevant evidence.
        - Prefer primary sources.
        - Track uncertainty explicitly.
    3. Write source notes.
</workflow>`);
  });

  test("renders variable references with provided values or placeholders", () => {
    const prompt = workflowPrompt({
      id: "requestPrompt",
      sections: [
        section("request", [
          paragraph(["Current request: ", variable("userRequest")]),
        ]),
      ],
    });

    expect(
      renderXmlMarkdown(prompt, { variables: { userRequest: "Map the API." } }),
    ).toContain("Current request: Map the API.");
    expect(renderXmlMarkdown(prompt)).toContain("Current request: {{userRequest}}");
  });

  test("renders context usage as a structured node", () => {
    const prompt = workflowPrompt({
      id: "contextPrompt",
      sections: [
        usesContext("researchContext", {
          instructions: ["Use loaded notes as evidence."],
        }),
      ],
    });

    expect(renderXmlMarkdown(prompt)).toBe(`<context_usage context_id="researchContext">
    - Use loaded notes as evidence.
</context_usage>`);
  });
});

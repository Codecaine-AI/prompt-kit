import { describe, expect, test } from "bun:test";

import { definePrompt, type ListItemNode } from "../../../src/document/nodes";
import { renderXmlMarkdown } from "../../../src/document/render/render";

function listItem(
  content: string,
  children: ListItemNode["children"] = [],
): ListItemNode {
  return { type: "listItem", content: [content], children };
}

describe("renderXmlMarkdown", () => {
  test("renders nested sections and lists as XML-tagged Markdown", () => {
    const prompt = definePrompt({
      id: "sourceScoutPrompt",
      archetype: "workflow",
      nodes: [
        {
          type: "section",
          tag: "purpose",
          children: [
            {
              type: "bulletList",
              items: [
                listItem("Find and evaluate sources for a focused assignment."),
              ],
            },
          ],
        },
        {
          type: "section",
          tag: "workflow",
          children: [
            {
              type: "orderedList",
              items: [
                listItem("Read the research brief."),
                listItem("Search for relevant evidence.", [
                  {
                    type: "bulletList",
                    items: [
                      listItem("Prefer primary sources."),
                      listItem("Track uncertainty explicitly."),
                    ],
                  },
                ]),
                listItem("Write source notes."),
              ],
            },
          ],
        },
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
    const prompt = definePrompt({
      id: "requestPrompt",
      archetype: "workflow",
      nodes: [
        {
          type: "section",
          tag: "request",
          children: [
            {
              type: "paragraph",
              content: [
                "Current request: ",
                { type: "variable", name: "userRequest" },
              ],
            },
          ],
        },
      ],
    });

    expect(
      renderXmlMarkdown(prompt, { variables: { userRequest: "Map the API." } }),
    ).toContain("Current request: Map the API.");
    expect(renderXmlMarkdown(prompt)).toContain("Current request: {{userRequest}}");
  });

  test("renders context usage as a structured node", () => {
    const prompt = definePrompt({
      id: "contextPrompt",
      archetype: "workflow",
      nodes: [
        {
          type: "contextUsage",
          contextId: "researchContext",
          instructions: [
            {
              type: "bulletList",
              items: [listItem("Use loaded notes as evidence.")],
            },
          ],
        },
      ],
    });

    expect(renderXmlMarkdown(prompt)).toBe(`<context_usage context_id="researchContext">
    - Use loaded notes as evidence.
</context_usage>`);
  });
});

import { describe, expect, test } from "bun:test";

import {
  definePrompt,
  findNodeById,
  insertAfterId,
  omitNodeById,
  replaceNodeById,
  renderXmlMarkdown,
  type SectionNode,
} from "..";

function sectionNode(tag: string, text: string, id: string): SectionNode {
  return {
    type: "section",
    id,
    tag,
    children: [{ type: "paragraph", content: [text] }],
  };
}

describe("prompt transforms", () => {
  test("finds, replaces, inserts, and omits nodes by stable id", () => {
    const prompt = definePrompt({
      id: "transformPrompt",
      archetype: "workflow",
      nodes: [
        sectionNode("purpose", "Original purpose.", "purpose"),
        sectionNode("workflow", "Original workflow.", "workflow"),
      ],
    });

    expect(findNodeById(prompt, "workflow")?.path).toEqual(["nodes", 1]);

    const replaced = replaceNodeById(
      prompt,
      "purpose",
      sectionNode("purpose", "Updated purpose.", "purpose"),
    );
    const inserted = insertAfterId(
      replaced,
      "purpose",
      sectionNode("rules", "Stay focused.", "rules"),
    );
    const omitted = omitNodeById(inserted, "workflow");

    expect(renderXmlMarkdown(omitted)).toBe(`<purpose>
    Updated purpose.
</purpose>

<rules>
    Stay focused.
</rules>`);
  });
});

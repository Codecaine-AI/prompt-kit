import { describe, expect, test } from "bun:test";

import {
  findNodeById,
  insertAfterId,
  omitNodeById,
  replaceNodeById,
  renderXmlMarkdown,
  section,
  workflowPrompt,
} from "..";

describe("prompt transforms", () => {
  test("finds, replaces, inserts, and omits nodes by stable id", () => {
    const prompt = workflowPrompt({
      id: "transformPrompt",
      sections: [
        section("purpose", ["Original purpose."], { id: "purpose" }),
        section("workflow", ["Original workflow."], { id: "workflow" }),
      ],
    });

    expect(findNodeById(prompt, "workflow")?.path).toEqual(["nodes", 1]);

    const replaced = replaceNodeById(
      prompt,
      "purpose",
      section("purpose", ["Updated purpose."], { id: "purpose" }),
    );
    const inserted = insertAfterId(
      replaced,
      "purpose",
      section("rules", ["Stay focused."], { id: "rules" }),
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

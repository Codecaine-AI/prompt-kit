import { describe, expect, test } from "bun:test";

import {
  createPromptBlockTemplate,
  createPromptEditorModel,
  duplicatePromptBlockNodeById,
  editableTextToInline,
  insertPromptBlockNode,
  movePromptBlockNodeById,
  removePromptBlockNodeById,
  updatePromptBlockNodeById,
} from "./model";
import {
  PROMPT_KIT_SCHEMA_VERSION,
  definePrompt,
  renderXmlMarkdown,
} from "../..";

describe("prompt editor model", () => {
  test("adds ids and edits prompt blocks through editor commands", () => {
    const prompt = definePrompt({
      id: "editorPrompt",
      archetype: "workflow",
      nodes: [
        {
          type: "section",
          tag: "purpose",
          children: [
            {
              type: "paragraph",
              content: ["Study ", { type: "variable", name: "topic" }, "."],
            },
          ],
        },
        {
          type: "section",
          tag: "workflow",
          children: [{ type: "paragraph", content: ["Read context."] }],
        },
      ],
    });

    const model = createPromptEditorModel(prompt, {
      declaredVariables: ["topic"],
    });
    const purpose = model.tree.find((entry) => entry.node.type === "section");
    expect(purpose?.id).toBeTruthy();
    expect(model.validation.ok).toBe(true);

    const insertedNode = createPromptBlockTemplate("paragraph", model.prompt);
    const inserted = insertPromptBlockNode(
      model.prompt,
      purpose?.id ?? null,
      insertedNode,
      "after",
    );
    const moved = movePromptBlockNodeById(inserted, insertedNode.id!, "up");
    const updated = updatePromptBlockNodeById(
      moved,
      insertedNode.id!,
      (node) =>
        node.type === "paragraph"
          ? {
              ...node,
              content: editableTextToInline("Focus {{topic}}."),
            }
          : node,
    );
    const duplicated = duplicatePromptBlockNodeById(updated, insertedNode.id!);
    const removed = removePromptBlockNodeById(duplicated, insertedNode.id!);

    expect(createPromptEditorModel(removed).tree.length).toBeGreaterThan(
      model.tree.length,
    );
    expect(
      renderXmlMarkdown(updated, { variables: { topic: "AST editing" } }),
    ).toContain("Focus AST editing.");
  });

  test("inserts child blocks into optional field children arrays", () => {
    const model = createPromptEditorModel({
      kind: "prompt",
      schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
      id: "fieldEditorPrompt",
      nodes: [
        {
          type: "field",
          id: "constraints-field",
          label: "constraints",
          value: ["Keep it short."],
        },
      ],
    });
    const insertedNode = createPromptBlockTemplate("paragraph", model.prompt);
    const updated = insertPromptBlockNode(
      model.prompt,
      "constraints-field",
      insertedNode,
      "child",
    );
    const fieldEntry = createPromptEditorModel(updated).tree.find(
      (entry) => entry.id === "constraints-field",
    );

    expect(fieldEntry?.node.type).toBe("field");
    expect(
      fieldEntry?.node.type === "field"
        ? fieldEntry.node.children?.[0]?.id
        : undefined,
    ).toBe(insertedNode.id);
  });
});

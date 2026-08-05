import { describe, expect, test } from "bun:test";

import {
  applyStep,
  applySteps,
  createPromptBlockTemplate,
  createPromptEditorTree,
  createTransactionLog,
  duplicatePromptBlockNodeByIdWithStep,
  ensurePromptNodeIds,
  insertPromptBlockNodeWithStep,
  invertStep,
  movePromptBlockNodeByIdWithStep,
  removePromptBlockNodeByIdWithStep,
  revertSteps,
  updatePromptBlockNodeByIdWithStep,
  type PromptStep,
} from "./index";
import { hashPrompt } from "../../document/canonical";
import { PROMPT_KIT_SCHEMA_VERSION } from "../../document/nodes/types";
import type { PromptBlockNode, PromptDocument } from "../../document/nodes/types";

function baseDocument(): PromptDocument {
  return ensurePromptNodeIds({
    kind: "prompt",
    schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
    id: "transaction-fixture",
    nodes: [
      {
        type: "section",
        tag: "purpose",
        children: [
          {
            type: "paragraph",
            content: ["Study ", { type: "variable", name: "topic" }, "."],
          },
          {
            type: "orderedList",
            items: [{ type: "listItem", content: ["Read context."] }],
          },
        ],
      },
      {
        type: "field",
        label: "constraints",
        value: ["Keep it short."],
      },
      { type: "codeBlock", language: "ts", code: "let x = 1;" },
      {
        type: "example",
        title: "Example",
        children: [{ type: "paragraph", content: ["Example content."] }],
      },
      {
        type: "contextUsage",
        contextId: "notes",
        instructions: [{ type: "paragraph", content: ["Use the notes."] }],
      },
    ],
  });
}

function editBlockNode(node: PromptBlockNode): PromptBlockNode {
  switch (node.type) {
    case "section":
      return { ...node, tag: `${node.tag}-edited`, title: "Edited" };
    case "paragraph":
      return { ...node, content: [...node.content, " Edited."] };
    case "bulletList":
    case "orderedList":
      return {
        ...node,
        items: [...node.items, { type: "listItem", id: `${node.id}-new-item`, content: ["Added."] }],
      };
    case "field":
      return { ...node, label: `${node.label}-edited`, value: ["Changed."] };
    case "codeBlock":
      return { ...node, code: `${node.code}\nlet y = 2;`, language: undefined };
    case "example":
      return { ...node, title: undefined };
    case "raw":
      return { ...node, value: `${node.value} edited` };
    case "contextUsage":
      return { ...node, tag: "notes", contextId: `${node.contextId}-edited` };
  }
}

describe("prompt editor transactions", () => {
  test("insert steps: apply matches the wrapper and inverse restores the hash", () => {
    const base = baseDocument();
    const baseHash = hashPrompt(base);
    const targets: Array<{ id: string | null; position: "before" | "after" | "child" }> = [
      { id: null, position: "after" },
      ...createPromptEditorTree(base).flatMap((entry) => {
        const cases: Array<{ id: string | null; position: "before" | "after" | "child" }> = [
          { id: entry.id, position: "before" },
          { id: entry.id, position: "after" },
        ];
        if (entry.canHaveChildren) cases.push({ id: entry.id, position: "child" });
        return cases;
      }),
    ];

    for (const target of targets) {
      const node = createPromptBlockTemplate("paragraph", base);
      const result = insertPromptBlockNodeWithStep(base, target.id, node, target.position);
      expect(result.step?.op).toBe("insert");
      if (!result.step) continue;
      expect(hashPrompt(applyStep(base, result.step))).toBe(hashPrompt(result.prompt));
      expect(hashPrompt(applyStep(result.prompt, invertStep(result.step)))).toBe(baseHash);
    }
  });

  test("remove steps: apply-inverse restores the hash for every block", () => {
    const base = baseDocument();
    const baseHash = hashPrompt(base);
    for (const entry of createPromptEditorTree(base)) {
      const result = removePromptBlockNodeByIdWithStep(base, entry.id);
      expect(result.step?.op).toBe("remove");
      if (!result.step) continue;
      expect(hashPrompt(applyStep(base, result.step))).toBe(hashPrompt(result.prompt));
      expect(hashPrompt(applyStep(result.prompt, invertStep(result.step)))).toBe(baseHash);
    }
  });

  test("move steps: apply-inverse restores the hash in both directions", () => {
    const base = baseDocument();
    const baseHash = hashPrompt(base);
    let movable = 0;
    for (const entry of createPromptEditorTree(base)) {
      for (const direction of ["up", "down"] as const) {
        const result = movePromptBlockNodeByIdWithStep(base, entry.id, direction);
        if (!result.step) {
          expect(result.prompt).toBe(base);
          continue;
        }
        movable += 1;
        expect(result.step.op).toBe("move");
        expect(hashPrompt(applyStep(base, result.step))).toBe(hashPrompt(result.prompt));
        expect(hashPrompt(applyStep(result.prompt, invertStep(result.step)))).toBe(baseHash);
      }
    }
    expect(movable).toBeGreaterThan(0);
  });

  test("update steps: apply-inverse restores the hash for every node type", () => {
    const base = baseDocument();
    const baseHash = hashPrompt(base);
    for (const entry of createPromptEditorTree(base)) {
      const result = updatePromptBlockNodeByIdWithStep(base, entry.id, editBlockNode);
      expect(result.step?.op).toBe("update");
      if (!result.step) continue;
      expect(hashPrompt(result.prompt)).not.toBe(baseHash);
      expect(hashPrompt(applyStep(base, result.step))).toBe(hashPrompt(result.prompt));
      expect(hashPrompt(applyStep(result.prompt, invertStep(result.step)))).toBe(baseHash);
    }
  });

  test("update with an identity updater produces no step", () => {
    const base = baseDocument();
    const entry = createPromptEditorTree(base)[0]!;
    const result = updatePromptBlockNodeByIdWithStep(base, entry.id, (node) => ({
      ...node,
    }));
    expect(result.step).toBeUndefined();
    expect(result.prompt).toBe(base);
  });

  test("duplicate steps: apply-inverse restores the hash", () => {
    const base = baseDocument();
    const baseHash = hashPrompt(base);
    for (const entry of createPromptEditorTree(base)) {
      const result = duplicatePromptBlockNodeByIdWithStep(base, entry.id);
      expect(result.step?.op).toBe("insert");
      if (!result.step) continue;
      expect(hashPrompt(applyStep(base, result.step))).toBe(hashPrompt(result.prompt));
      expect(hashPrompt(applyStep(result.prompt, invertStep(result.step)))).toBe(baseHash);
    }
  });

  test("random edit sequences revert to the base hash", () => {
    const base = baseDocument();
    const baseHash = hashPrompt(base);
    const random = mulberry32(0xc0dec0de);

    let doc = base;
    const steps: PromptStep[] = [];
    for (let i = 0; i < 40; i += 1) {
      const tree = createPromptEditorTree(doc);
      const entry = tree[Math.floor(random() * tree.length)];
      if (!entry) break;
      const op = Math.floor(random() * 5);
      let result;
      switch (op) {
        case 0:
          result = insertPromptBlockNodeWithStep(
            doc,
            entry.id,
            createPromptBlockTemplate("paragraph", doc),
            entry.canHaveChildren && random() > 0.5 ? "child" : "after",
          );
          break;
        case 1:
          result =
            tree.length > 2
              ? removePromptBlockNodeByIdWithStep(doc, entry.id)
              : { prompt: doc, step: undefined };
          break;
        case 2:
          result = movePromptBlockNodeByIdWithStep(
            doc,
            entry.id,
            random() > 0.5 ? "up" : "down",
          );
          break;
        case 3:
          result = updatePromptBlockNodeByIdWithStep(doc, entry.id, editBlockNode);
          break;
        default:
          result = duplicatePromptBlockNodeByIdWithStep(doc, entry.id);
          break;
      }
      doc = result.prompt;
      if (result.step) steps.push(result.step);
    }

    expect(steps.length).toBeGreaterThan(10);
    expect(hashPrompt(doc)).not.toBe(baseHash);
    expect(hashPrompt(applySteps(base, steps))).toBe(hashPrompt(doc));
    expect(hashPrompt(revertSteps(doc, steps))).toBe(baseHash);
  });

  test("transaction log commits, undoes, and redoes immutably", () => {
    const base = baseDocument();
    const baseHash = hashPrompt(base);
    const log = createTransactionLog(base, {
      now: () => "2026-07-01T00:00:00.000Z",
      generateId: () => "txn-fixed",
    });

    const firstEdit = insertPromptBlockNodeWithStep(
      log.current(),
      null,
      createPromptBlockTemplate("paragraph", log.current()),
    );
    const first = log.commit([firstEdit.step!]);
    expect(first?.baseHash).toBe(baseHash);
    expect(first?.timestamp).toBe("2026-07-01T00:00:00.000Z");
    const afterFirstHash = hashPrompt(log.current());
    expect(afterFirstHash).not.toBe(baseHash);

    const secondEdit = updatePromptBlockNodeByIdWithStep(
      log.current(),
      createPromptEditorTree(log.current())[0]!.id,
      editBlockNode,
    );
    const second = log.commit([secondEdit.step!]);
    expect(second?.baseHash).toBe(afterFirstHash);
    expect(log.history()).toHaveLength(2);
    const afterSecondHash = hashPrompt(log.current());

    expect(hashPrompt(log.undo()!)).toBe(afterFirstHash);
    expect(hashPrompt(log.undo()!)).toBe(baseHash);
    expect(log.undo()).toBeUndefined();
    expect(log.history()).toHaveLength(0);

    expect(hashPrompt(log.redo()!)).toBe(afterFirstHash);
    expect(hashPrompt(log.redo()!)).toBe(afterSecondHash);
    expect(log.redo()).toBeUndefined();
    expect(log.history()).toHaveLength(2);

    // The base document is never mutated.
    expect(hashPrompt(base)).toBe(baseHash);

    // Committing after an undo clears the redo stack.
    log.undo();
    const branchEdit = duplicatePromptBlockNodeByIdWithStep(
      log.current(),
      createPromptEditorTree(log.current())[0]!.id,
    );
    log.commit([branchEdit.step!]);
    expect(log.redo()).toBeUndefined();

    expect(log.commit([])).toBeUndefined();
  });
});

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

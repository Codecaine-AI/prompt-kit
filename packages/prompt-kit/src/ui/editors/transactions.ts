import { hashPrompt } from "../../canonical";
import { ensurePromptNodeIds } from "../../nodes/ids";
import type { PromptBlockNode, PromptDocument } from "../../nodes/types";
import {
  createPromptEditorTree,
  duplicatePromptBlockNodeById,
  getPromptBlockNodeById,
  insertPromptBlockNode,
  movePromptBlockNodeById,
  removePromptBlockNodeById,
  updatePromptBlockNodeById,
  type PromptEditorTreeEntry,
  type PromptNodePath,
} from "./index";

/**
 * Distributes `Partial` over the block-node union so a patch can carry
 * type-specific fields (`content`, `tag`, `items`, ...), not just the keys
 * shared by every node type.
 */
export type PromptBlockNodePatch = PromptBlockNode extends infer TNode
  ? TNode extends PromptBlockNode
    ? Partial<TNode>
    : never
  : never;

export interface PromptInsertStep {
  op: "insert";
  path: PromptNodePath;
  node: PromptBlockNode;
}

export interface PromptRemoveStep {
  op: "remove";
  path: PromptNodePath;
  removed: PromptBlockNode;
}

export interface PromptMoveStep {
  op: "move";
  from: PromptNodePath;
  to: PromptNodePath;
}

export interface PromptUpdateStep {
  op: "update";
  id: string;
  before: PromptBlockNodePatch;
  after: PromptBlockNodePatch;
}

export type PromptStep =
  | PromptInsertStep
  | PromptRemoveStep
  | PromptMoveStep
  | PromptUpdateStep;

export interface PromptTransaction {
  id: string;
  /** Hash of the revision this edit started from. */
  baseHash: string;
  steps: PromptStep[];
  timestamp: string;
}

/**
 * Result of a step-producing editor mutation. `step` is undefined when the
 * mutation was a no-op (missing target, move out of range, empty diff).
 */
export interface PromptStepResult {
  prompt: PromptDocument;
  step?: PromptStep;
}

export function insertPromptBlockNodeWithStep(
  prompt: PromptDocument,
  targetId: string | null,
  node: PromptBlockNode,
  position: "before" | "after" | "child" = "after",
): PromptStepResult {
  const next = insertPromptBlockNode(prompt, targetId, node, position);
  if (next === prompt) return { prompt };
  const inserted = findInsertedEntry(prompt, next);
  if (!inserted) return { prompt: next };
  return {
    prompt: next,
    step: { op: "insert", path: inserted.path, node: inserted.node },
  };
}

export function removePromptBlockNodeByIdWithStep(
  prompt: PromptDocument,
  id: string,
): PromptStepResult {
  const entry = getPromptBlockNodeById(prompt, id);
  if (!entry) return { prompt };
  const next = removePromptBlockNodeById(prompt, id);
  return {
    prompt: next,
    step: { op: "remove", path: entry.path, removed: entry.node },
  };
}

export function movePromptBlockNodeByIdWithStep(
  prompt: PromptDocument,
  id: string,
  direction: "up" | "down",
): PromptStepResult {
  const before = getPromptBlockNodeById(prompt, id);
  if (!before) return { prompt };
  const next = movePromptBlockNodeById(prompt, id, direction);
  if (next === prompt) return { prompt };
  const after = getPromptBlockNodeById(next, id);
  if (!after) return { prompt: next };
  return {
    prompt: next,
    step: { op: "move", from: before.path, to: after.path },
  };
}

export function updatePromptBlockNodeByIdWithStep(
  prompt: PromptDocument,
  id: string,
  updater: (node: PromptBlockNode) => PromptBlockNode,
): PromptStepResult {
  const before = getPromptBlockNodeById(prompt, id);
  if (!before) return { prompt };
  const next = updatePromptBlockNodeById(prompt, id, updater);
  const after = getPromptBlockNodeById(next, id);
  if (!after) return { prompt };
  const diff = diffBlockNodes(before.node, after.node);
  if (!diff) return { prompt };
  return {
    prompt: next,
    step: { op: "update", id, before: diff.before, after: diff.after },
  };
}

export function duplicatePromptBlockNodeByIdWithStep(
  prompt: PromptDocument,
  id: string,
): PromptStepResult {
  const next = duplicatePromptBlockNodeById(prompt, id);
  if (next === prompt) return { prompt };
  const inserted = findInsertedEntry(prompt, next);
  if (!inserted) return { prompt: next };
  return {
    prompt: next,
    step: { op: "insert", path: inserted.path, node: inserted.node },
  };
}

export function applyStep(
  prompt: PromptDocument,
  step: PromptStep,
): PromptDocument {
  switch (step.op) {
    case "insert":
      return insertNodeAtPath(prompt, step.path, step.node);
    case "remove":
      return removeNodeAtPath(prompt, step.path);
    case "move": {
      const node = getNodeAtPath(prompt, step.from);
      if (!node) return prompt;
      const removed = removeNodeAtPath(prompt, step.from);
      return insertNodeAtPath(removed, step.to, node);
    }
    case "update":
      return updatePromptBlockNodeById(prompt, step.id, (node) =>
        applyNodePatch(node, step.after),
      );
  }
}

export function applySteps(
  prompt: PromptDocument,
  steps: readonly PromptStep[],
): PromptDocument {
  return steps.reduce((doc, step) => applyStep(doc, step), prompt);
}

export function invertStep(step: PromptStep): PromptStep {
  switch (step.op) {
    case "insert":
      return { op: "remove", path: step.path, removed: step.node };
    case "remove":
      return { op: "insert", path: step.path, node: step.removed };
    case "move":
      return { op: "move", from: step.to, to: step.from };
    case "update":
      return { op: "update", id: step.id, before: step.after, after: step.before };
  }
}

/** Undoes `steps` by applying inverse steps in reverse order. */
export function revertSteps(
  prompt: PromptDocument,
  steps: readonly PromptStep[],
): PromptDocument {
  return [...steps]
    .reverse()
    .reduce((doc, step) => applyStep(doc, invertStep(step)), prompt);
}

export interface CreateTransactionLogOptions {
  /** Hash of the base revision; computed with `hashPrompt` when omitted. */
  baseHash?: string;
  /** Override the content hasher (defaults to `hashPrompt`). */
  hash?: (doc: PromptDocument) => string;
  /** Override the timestamp source (defaults to `new Date().toISOString()`). */
  now?: () => string;
  /** Override transaction id generation. */
  generateId?: () => string;
}

export interface PromptTransactionLog {
  /**
   * Applies `steps` to the current document and records them as one
   * transaction. Returns the transaction, or undefined for an empty commit.
   * Committing clears the redo stack.
   */
  commit(steps: PromptStep[]): PromptTransaction | undefined;
  /** Reverts the latest transaction; returns the new current document. */
  undo(): PromptDocument | undefined;
  /** Re-applies the latest undone transaction. */
  redo(): PromptDocument | undefined;
  current(): PromptDocument;
  /** Committed transactions, oldest first. */
  history(): PromptTransaction[];
}

/**
 * Pure, immutable transaction log over a PromptDocument: documents are never
 * mutated, every state is derived by applying (or inverting) steps.
 */
export function createTransactionLog(
  baseDoc: PromptDocument,
  options: CreateTransactionLogOptions = {},
): PromptTransactionLog {
  const hash = options.hash ?? hashPrompt;
  const now = options.now ?? (() => new Date().toISOString());
  let counter = 0;
  const generateId =
    options.generateId ?? (() => `txn-${(counter += 1)}-${Date.now().toString(36)}`);

  let currentDoc = ensurePromptNodeIds(baseDoc);
  let currentHash = options.baseHash ?? hash(currentDoc);
  const committed: PromptTransaction[] = [];
  const undone: PromptTransaction[] = [];

  return {
    commit(steps) {
      if (steps.length === 0) return undefined;
      const nextDoc = applySteps(currentDoc, steps);
      const transaction: PromptTransaction = {
        id: generateId(),
        baseHash: currentHash,
        steps: [...steps],
        timestamp: now(),
      };
      committed.push(transaction);
      undone.length = 0;
      currentDoc = nextDoc;
      currentHash = hash(nextDoc);
      return transaction;
    },
    undo() {
      const transaction = committed.pop();
      if (!transaction) return undefined;
      currentDoc = revertSteps(currentDoc, transaction.steps);
      currentHash = transaction.baseHash;
      undone.push(transaction);
      return currentDoc;
    },
    redo() {
      const transaction = undone.pop();
      if (!transaction) return undefined;
      currentDoc = applySteps(currentDoc, transaction.steps);
      currentHash = hash(currentDoc);
      committed.push(transaction);
      return currentDoc;
    },
    current() {
      return currentDoc;
    },
    history() {
      return [...committed];
    },
  };
}

function findInsertedEntry(
  prev: PromptDocument,
  next: PromptDocument,
): PromptEditorTreeEntry | undefined {
  const prevIds = new Set(createPromptEditorTree(prev).map((entry) => entry.id));
  // Tree entries are in depth-first document order, so the first unseen id is
  // the root of the inserted subtree.
  return createPromptEditorTree(next).find((entry) => !prevIds.has(entry.id));
}

function diffBlockNodes(
  before: PromptBlockNode,
  after: PromptBlockNode,
):
  | { before: PromptBlockNodePatch; after: PromptBlockNodePatch }
  | undefined {
  const beforeRecord = before as unknown as Record<string, unknown>;
  const afterRecord = after as unknown as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(beforeRecord),
    ...Object.keys(afterRecord),
  ]);
  const beforePatch: Record<string, unknown> = {};
  const afterPatch: Record<string, unknown> = {};
  let changed = false;
  for (const key of keys) {
    if (deepEquals(beforeRecord[key], afterRecord[key])) continue;
    beforePatch[key] = beforeRecord[key];
    afterPatch[key] = afterRecord[key];
    changed = true;
  }
  if (!changed) return undefined;
  return {
    before: beforePatch as PromptBlockNodePatch,
    after: afterPatch as PromptBlockNodePatch,
  };
}

function applyNodePatch(
  node: PromptBlockNode,
  patch: PromptBlockNodePatch,
): PromptBlockNode {
  const merged: Record<string, unknown> = {
    ...(node as unknown as Record<string, unknown>),
    ...(patch as Record<string, unknown>),
  };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged as unknown as PromptBlockNode;
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((entry, index) => deepEquals(entry, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined);
  const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEquals(aRecord[key], bRecord[key]));
}

function getNodeAtPath(
  prompt: PromptDocument,
  path: PromptNodePath,
): PromptBlockNode | undefined {
  let current: unknown = prompt;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current as PromptBlockNode | undefined;
}

function insertNodeAtPath(
  prompt: PromptDocument,
  path: PromptNodePath,
  node: PromptBlockNode,
): PromptDocument {
  const index = path[path.length - 1];
  if (typeof index !== "number") return prompt;
  return updateContainerAtPath(prompt, path.slice(0, -1), (items) => {
    const next = [...items];
    next.splice(Math.min(Math.max(index, 0), next.length), 0, node);
    return next;
  }) as PromptDocument;
}

function removeNodeAtPath(
  prompt: PromptDocument,
  path: PromptNodePath,
): PromptDocument {
  const index = path[path.length - 1];
  if (typeof index !== "number") return prompt;
  return updateContainerAtPath(prompt, path.slice(0, -1), (items) =>
    items.filter((_, itemIndex) => itemIndex !== index),
  ) as PromptDocument;
}

function updateContainerAtPath(
  value: unknown,
  containerPath: PromptNodePath,
  updater: (items: PromptBlockNode[]) => PromptBlockNode[],
): unknown {
  if (containerPath.length === 0) {
    const items = Array.isArray(value) ? (value as PromptBlockNode[]) : [];
    return updater(items);
  }
  const [head, ...tail] = containerPath;
  if (typeof head === "number") {
    const list = Array.isArray(value) ? [...(value as unknown[])] : [];
    list[head] = updateContainerAtPath(list[head], tail, updater);
    return list;
  }
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    ...record,
    [head as string]: updateContainerAtPath(record[head as string], tail, updater),
  };
}

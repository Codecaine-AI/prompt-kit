import { renderXmlMarkdown } from "../../document/render";
import { validatePrompt, type PromptValidationResult } from "../../document/validate";
import {
  assignBlockIds,
  collectPromptIds,
  ensurePromptNodeIds,
  prepareBlockForInsert,
} from "../../document/nodes/ids";
import type {
  PromptBlockNode,
  PromptDocument,
  PromptInline,
} from "../../document/nodes/types";

export { ensurePromptNodeIds };
export * from "./transactions";

export type PromptNodePath = Array<string | number>;

export type PromptBlockNodeType = PromptBlockNode["type"];

export interface PromptEditorTreeEntry {
  id: string;
  node: PromptBlockNode;
  path: PromptNodePath;
  parentPath: PromptNodePath;
  depth: number;
  index: number;
  siblingCount: number;
  label: string;
  summary: string;
  canHaveChildren: boolean;
}

export interface CreatePromptEditorModelOptions {
  selectedNodeId?: string;
  declaredVariables?: Iterable<string>;
  ensureIds?: boolean;
  renderVariables?: Record<string, unknown>;
}

export interface PromptEditorModel {
  prompt: PromptDocument;
  selectedNodeId?: string;
  selectedEntry?: PromptEditorTreeEntry;
  tree: PromptEditorTreeEntry[];
  rendered: string;
  validation: PromptValidationResult;
}

export function createPromptEditorModel(
  prompt: PromptDocument,
  options: CreatePromptEditorModelOptions = {},
): PromptEditorModel {
  const editorPrompt =
    options.ensureIds === false ? prompt : ensurePromptNodeIds(prompt);
  const tree = createPromptEditorTree(editorPrompt);
  const selectedNodeId =
    options.selectedNodeId && tree.some((entry) => entry.id === options.selectedNodeId)
      ? options.selectedNodeId
      : tree[0]?.id;
  const selectedEntry = selectedNodeId
    ? tree.find((entry) => entry.id === selectedNodeId)
    : undefined;

  return {
    prompt: editorPrompt,
    selectedNodeId,
    selectedEntry,
    tree,
    rendered: renderXmlMarkdown(editorPrompt, {
      variables: options.renderVariables,
    }),
    validation: validatePrompt(editorPrompt, {
      declaredVariables: options.declaredVariables,
    }),
  };
}

export function createPromptEditorTree(
  prompt: PromptDocument,
): PromptEditorTreeEntry[] {
  const entries: PromptEditorTreeEntry[] = [];
  collectBlockEntries(prompt.nodes, ["nodes"], 0, entries);
  return entries;
}

export function getPromptBlockNodeById(
  prompt: PromptDocument,
  id: string,
): PromptEditorTreeEntry | undefined {
  return createPromptEditorTree(prompt).find((entry) => entry.id === id);
}

export function replacePromptBlockNodeById(
  prompt: PromptDocument,
  id: string,
  replacement: PromptBlockNode,
): PromptDocument {
  const entry = getPromptBlockNodeById(prompt, id);
  if (!entry) return prompt;
  return updateAtPath(prompt, entry.path, () => replacement);
}

export function updatePromptBlockNodeById(
  prompt: PromptDocument,
  id: string,
  updater: (node: PromptBlockNode) => PromptBlockNode,
): PromptDocument {
  const entry = getPromptBlockNodeById(prompt, id);
  if (!entry) return prompt;
  return updateAtPath(prompt, entry.path, (node) =>
    updater(node as PromptBlockNode),
  );
}

export function removePromptBlockNodeById(
  prompt: PromptDocument,
  id: string,
): PromptDocument {
  const entry = getPromptBlockNodeById(prompt, id);
  if (!entry) return prompt;
  return updateArrayAtPath(prompt, entry.parentPath, (siblings) =>
    siblings.filter((_, index) => index !== entry.index),
  );
}

export function insertPromptBlockNode(
  prompt: PromptDocument,
  targetId: string | null,
  node: PromptBlockNode,
  position: "before" | "after" | "child" = "after",
): PromptDocument {
  const prepared = prepareBlockForInsert(node, prompt);

  if (!targetId) {
    return updateArrayAtPath(prompt, ["nodes"], (siblings) => [
      ...siblings,
      prepared,
    ]);
  }

  const target = getPromptBlockNodeById(prompt, targetId);
  if (!target) return prompt;

  if (position === "child") {
    const childPath = childBlockPath(target.path, target.node);
    if (!childPath) return prompt;
    return updateArrayAtPath(prompt, childPath, (children) => [
      ...children,
      prepared,
    ]);
  }

  return updateArrayAtPath(prompt, target.parentPath, (siblings) => {
    const next = [...siblings];
    next.splice(target.index + (position === "after" ? 1 : 0), 0, prepared);
    return next;
  });
}

export function duplicatePromptBlockNodeById(
  prompt: PromptDocument,
  id: string,
): PromptDocument {
  const entry = getPromptBlockNodeById(prompt, id);
  if (!entry) return prompt;
  return insertPromptBlockNode(prompt, id, entry.node, "after");
}

export function movePromptBlockNodeById(
  prompt: PromptDocument,
  id: string,
  direction: "up" | "down",
): PromptDocument {
  const entry = getPromptBlockNodeById(prompt, id);
  if (!entry) return prompt;
  const offset = direction === "up" ? -1 : 1;
  const targetIndex = entry.index + offset;
  if (targetIndex < 0 || targetIndex >= entry.siblingCount) return prompt;

  return updateArrayAtPath(prompt, entry.parentPath, (siblings) => {
    const next = [...siblings];
    const [node] = next.splice(entry.index, 1);
    if (!node) return siblings;
    next.splice(targetIndex, 0, node);
    return next;
  });
}

export function createPromptBlockTemplate(
  type: PromptBlockNodeType,
  prompt?: PromptDocument,
): PromptBlockNode {
  const used = prompt ? collectPromptIds(prompt) : new Set<string>();
  const withId = <TNode extends PromptBlockNode>(node: TNode): TNode =>
    assignBlockIds(node, used) as TNode;

  switch (type) {
    case "section":
      return withId({
        type: "section",
        tag: "section",
        children: [
          {
            type: "paragraph",
            content: ["New instruction."],
          },
        ],
      });
    case "paragraph":
      return withId({ type: "paragraph", content: ["New instruction."] });
    case "bulletList":
      return withId({
        type: "bulletList",
        items: [{ type: "listItem", content: ["New item."] }],
      });
    case "orderedList":
      return withId({
        type: "orderedList",
        items: [{ type: "listItem", content: ["New step."] }],
      });
    case "field":
      return withId({ type: "field", label: "label", value: ["value"] });
    case "codeBlock":
      return withId({ type: "codeBlock", language: "text", code: "" });
    case "example":
      return withId({
        type: "example",
        title: "Example",
        children: [{ type: "paragraph", content: ["Example content."] }],
      });
    case "raw":
      return withId({ type: "raw", value: "" });
    case "contextUsage":
      return withId({
        type: "contextUsage",
        contextId: "contextId",
        instructions: [{ type: "paragraph", content: ["Use this context."] }],
      });
  }
}

export function inlineToEditableText(content: readonly PromptInline[]): string {
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.type === "variable") return `{{${part.name}}}`;
      return `{{${part.kind}:${part.name}}}`;
    })
    .join("");
}

export function editableTextToInline(text: string): PromptInline[] {
  const parts: PromptInline[] = [];
  const tokenPattern = /\{\{\s*([a-zA-Z_][\w-]*)(?::([a-zA-Z0-9_.-]+))?\s*\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const first = match[1];
    const second = match[2];
    if (second) {
      parts.push({ type: "reference", kind: first, name: second });
    } else {
      parts.push({ type: "variable", name: first });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : [""];
}

export function renamePromptNodeId(
  prompt: PromptDocument,
  id: string,
  nextId: string | undefined,
): PromptDocument {
  const trimmed = nextId?.trim();
  return updatePromptBlockNodeById(prompt, id, (node) => ({
    ...node,
    id: trimmed && trimmed.length > 0 ? trimmed : undefined,
  }));
}

function collectBlockEntries(
  nodes: readonly PromptBlockNode[],
  parentPath: PromptNodePath,
  depth: number,
  entries: PromptEditorTreeEntry[],
): void {
  nodes.forEach((node, index) => {
    if (!node.id) return;
    const path = [...parentPath, index];
    const entry: PromptEditorTreeEntry = {
      id: node.id,
      node,
      path,
      parentPath,
      depth,
      index,
      siblingCount: nodes.length,
      label: labelForBlock(node),
      summary: summaryForBlock(node),
      canHaveChildren: childBlockPath(path, node) !== null,
    };
    entries.push(entry);

    const childPath = childBlockPath(path, node);
    const children = childBlocksForNode(node);
    if (childPath && children) {
      collectBlockEntries(children, childPath, depth + 1, entries);
    }
  });
}

/**
 * Human label for one block node — `<tag>` for sections, the node type
 * otherwise. The inspector tree entries carry the same string (see
 * `PromptEditorTreeEntry.label`); exported so overlay layers (annotation
 * targeting chips) name nodes exactly the way the inspector does.
 */
export function promptBlockLabel(node: PromptBlockNode): string {
  return labelForBlock(node);
}

function labelForBlock(node: PromptBlockNode): string {
  switch (node.type) {
    case "section":
      return `<${node.tag}>`;
    case "paragraph":
      return "Paragraph";
    case "bulletList":
      return "Bullet list";
    case "orderedList":
      return "Ordered list";
    case "field":
      return node.label;
    case "codeBlock":
      return node.language ? `Code: ${node.language}` : "Code block";
    case "example":
      return node.title ? `Example: ${node.title}` : "Example";
    case "raw":
      return "Raw";
    case "contextUsage":
      return `Context: ${node.contextId || "unnamed"}`;
  }
}

function summaryForBlock(node: PromptBlockNode): string {
  switch (node.type) {
    case "section":
      return `${node.children.length} child${node.children.length === 1 ? "" : "ren"}`;
    case "paragraph":
      return inlineToEditableText(node.content);
    case "bulletList":
    case "orderedList":
      return `${node.items.length} item${node.items.length === 1 ? "" : "s"}`;
    case "field":
      return inlineToEditableText(node.value);
    case "codeBlock":
      return node.code.split("\n")[0] ?? "";
    case "example":
      return `${node.children.length} child${node.children.length === 1 ? "" : "ren"}`;
    case "raw":
      return node.value.split("\n")[0] ?? "";
    case "contextUsage":
      return node.tag ? `<${node.tag}>` : "context usage";
  }
}

function childBlockPath(
  path: PromptNodePath,
  node: PromptBlockNode,
): PromptNodePath | null {
  switch (node.type) {
    case "section":
    case "example":
      return [...path, "children"];
    case "field":
      return [...path, "children"];
    case "contextUsage":
      return [...path, "instructions"];
    case "paragraph":
    case "bulletList":
    case "orderedList":
    case "codeBlock":
    case "raw":
      return null;
  }
}

function childBlocksForNode(
  node: PromptBlockNode,
): readonly PromptBlockNode[] | null {
  switch (node.type) {
    case "section":
    case "example":
      return node.children;
    case "field":
      return node.children ?? [];
    case "contextUsage":
      return node.instructions;
    case "paragraph":
    case "bulletList":
    case "orderedList":
    case "codeBlock":
    case "raw":
      return null;
  }
}

function updateArrayAtPath(
  prompt: PromptDocument,
  path: PromptNodePath,
  updater: (value: PromptBlockNode[]) => PromptBlockNode[],
): PromptDocument {
  return updateAtPath(prompt, path, (value) =>
    updater(Array.isArray(value) ? (value as PromptBlockNode[]) : []),
  );
}

function updateAtPath<TValue>(
  value: TValue,
  path: PromptNodePath,
  updater: (value: unknown) => unknown,
): TValue {
  if (path.length === 0) return updater(value) as TValue;
  const [head, ...tail] = path;
  if (Array.isArray(value)) {
    const next = [...value];
    next[head as number] = updateAtPath(next[head as number], tail, updater);
    return next as TValue;
  }
  const object = value as Record<string, unknown>;
  return {
    ...object,
    [head]: updateAtPath(object[head as string], tail, updater),
  } as TValue;
}

function getPathValue(value: unknown, path: PromptNodePath): unknown {
  return path.reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return (current as Record<string, unknown>)[key as string];
  }, value);
}

import type {
  ContextUsageNode,
  FieldNode,
  ListItemNode,
  PromptBlockNode,
  PromptDocument,
  PromptInline,
  PromptNode,
  SectionNode,
  VariableReferenceNode,
} from "../nodes/types";

export interface VisitEntry {
  node: PromptNode;
  parent?: PromptNode;
  path: Array<string | number>;
}

export type Visitor = (entry: VisitEntry) => void;

export function visitPrompt(prompt: PromptDocument, visitor: Visitor): void {
  visitor({ node: prompt, path: [] });
  prompt.nodes.forEach((node, index) => {
    visitBlockNode(node, visitor, prompt, ["nodes", index]);
  });
}

export function visitBlockNode(
  node: PromptBlockNode,
  visitor: Visitor,
  parent: PromptNode,
  path: Array<string | number>,
): void {
  visitor({ node, parent, path });

  switch (node.type) {
    case "section":
      visitSectionChildren(node, visitor, path);
      return;
    case "paragraph":
      visitInline(node.content, visitor, node, [...path, "content"]);
      return;
    case "bulletList":
    case "orderedList":
      node.items.forEach((item, index) => {
        visitListItem(item, visitor, node, [...path, "items", index]);
      });
      return;
    case "field":
      visitField(node, visitor, path);
      return;
    case "example":
      node.children.forEach((child, index) => {
        visitBlockNode(child, visitor, node, [...path, "children", index]);
      });
      return;
    case "contextUsage":
      visitContextUsage(node, visitor, path);
      return;
    case "codeBlock":
    case "raw":
      return;
  }
}

function visitSectionChildren(
  node: SectionNode,
  visitor: Visitor,
  path: Array<string | number>,
): void {
  node.children.forEach((child, index) => {
    visitBlockNode(child, visitor, node, [...path, "children", index]);
  });
}

function visitField(
  node: FieldNode,
  visitor: Visitor,
  path: Array<string | number>,
): void {
  visitInline(node.value, visitor, node, [...path, "value"]);
  node.children?.forEach((child, index) => {
    visitBlockNode(child, visitor, node, [...path, "children", index]);
  });
}

function visitContextUsage(
  node: ContextUsageNode,
  visitor: Visitor,
  path: Array<string | number>,
): void {
  node.instructions.forEach((child, index) => {
    visitBlockNode(child, visitor, node, [...path, "instructions", index]);
  });
}

function visitListItem(
  node: ListItemNode,
  visitor: Visitor,
  parent: PromptNode,
  path: Array<string | number>,
): void {
  visitor({ node, parent, path });
  visitInline(node.content, visitor, node, [...path, "content"]);
  node.children?.forEach((child, index) => {
    visitBlockNode(child, visitor, node, [...path, "children", index]);
  });
}

function visitInline(
  content: readonly PromptInline[],
  visitor: Visitor,
  parent: PromptNode,
  path: Array<string | number>,
): void {
  content.forEach((part, index) => {
    if (typeof part !== "string") {
      visitor({
        node: part as VariableReferenceNode,
        parent,
        path: [...path, index],
      });
    }
  });
}

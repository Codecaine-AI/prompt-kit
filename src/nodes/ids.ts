import type {
  ListItemNode,
  PromptBlockNode,
  PromptDocument,
  PromptNode,
} from "./types";

/**
 * Ensures every block node (and list item) in the document carries a stable
 * id. Runs before canonical serialization so revisions can be diffed at the
 * block level, and before editor sessions so tree entries are addressable.
 */
export function ensurePromptNodeIds(prompt: PromptDocument): PromptDocument {
  const used = collectPromptIds(prompt);
  const nodes = prompt.nodes.map((node) => assignBlockIds(node, used));
  return { ...prompt, nodes };
}

export function collectPromptIds(prompt: PromptDocument): Set<string> {
  const ids = new Set<string>();
  const visit = (node: PromptNode) => {
    if ("id" in node && node.id) ids.add(node.id);
    if ("type" in node) {
      switch (node.type) {
        case "section":
        case "example":
          node.children.forEach(visit);
          return;
        case "bulletList":
        case "orderedList":
          node.items.forEach(visit);
          return;
        case "field":
          node.children?.forEach(visit);
          return;
        case "contextUsage":
          node.instructions.forEach(visit);
          return;
        case "paragraph":
          node.content.forEach((part) => {
            if (typeof part !== "string") visit(part);
          });
          return;
        case "listItem":
          node.children?.forEach(visit);
          node.content.forEach((part) => {
            if (typeof part !== "string") visit(part);
          });
          return;
        case "codeBlock":
        case "raw":
        case "variable":
        case "reference":
          return;
      }
    }
  };
  prompt.nodes.forEach(visit);
  return ids;
}

export function assignBlockIds(
  node: PromptBlockNode,
  used: Set<string>,
): PromptBlockNode {
  const id = node.id ?? nextPromptNodeId(node.type, used);
  used.add(id);

  switch (node.type) {
    case "section":
      return {
        ...node,
        id,
        children: node.children.map((child) => assignBlockIds(child, used)),
      };
    case "bulletList":
    case "orderedList":
      return {
        ...node,
        id,
        items: node.items.map((item) => assignListItemIds(item, used)),
      };
    case "field":
      return {
        ...node,
        id,
        children: node.children?.map((child) => assignBlockIds(child, used)),
      };
    case "example":
      return {
        ...node,
        id,
        children: node.children.map((child) => assignBlockIds(child, used)),
      };
    case "contextUsage":
      return {
        ...node,
        id,
        instructions: node.instructions.map((child) => assignBlockIds(child, used)),
      };
    case "paragraph":
    case "codeBlock":
    case "raw":
      return { ...node, id };
  }
  // Unknown node types pass through unchanged so downstream consumers
  // (canonicalization, validation) can report them by name.
  return { ...(node as PromptBlockNode), id };
}

export function assignListItemIds(
  node: ListItemNode,
  used: Set<string>,
): ListItemNode {
  const id = node.id ?? nextPromptNodeId("listItem", used);
  used.add(id);
  return {
    ...node,
    id,
    children: node.children?.map((child) => assignBlockIds(child, used)),
  };
}

export function nextPromptNodeId(type: string, used: Set<string>): string {
  const prefix = `node-${type.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
  let index = 1;
  let id = `${prefix}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

export function prepareBlockForInsert(
  node: PromptBlockNode,
  prompt: PromptDocument,
): PromptBlockNode {
  const used = collectPromptIds(prompt);
  const nodeIds = collectBlockIds(node);
  if (nodeIds.length > 0 && nodeIds.every((id) => !used.has(id))) {
    return assignBlockIds(node, used);
  }
  return assignBlockIds(stripBlockIds(node), used);
}

export function collectBlockIds(node: PromptBlockNode): string[] {
  const ids: string[] = [];
  const visitBlock = (block: PromptBlockNode) => {
    if (block.id) ids.push(block.id);
    switch (block.type) {
      case "section":
      case "example":
        block.children.forEach(visitBlock);
        return;
      case "bulletList":
      case "orderedList":
        block.items.forEach((item) => {
          if (item.id) ids.push(item.id);
          item.children?.forEach(visitBlock);
        });
        return;
      case "field":
        block.children?.forEach(visitBlock);
        return;
      case "contextUsage":
        block.instructions.forEach(visitBlock);
        return;
      case "paragraph":
      case "codeBlock":
      case "raw":
        return;
    }
  };
  visitBlock(node);
  return ids;
}

export function stripBlockIds(node: PromptBlockNode): PromptBlockNode {
  switch (node.type) {
    case "section":
      return {
        ...node,
        id: undefined,
        children: node.children.map(stripBlockIds),
      };
    case "bulletList":
    case "orderedList":
      return {
        ...node,
        id: undefined,
        items: node.items.map(stripListItemIds),
      };
    case "field":
      return {
        ...node,
        id: undefined,
        children: node.children?.map(stripBlockIds),
      };
    case "example":
      return {
        ...node,
        id: undefined,
        children: node.children.map(stripBlockIds),
      };
    case "contextUsage":
      return {
        ...node,
        id: undefined,
        instructions: node.instructions.map(stripBlockIds),
      };
    case "paragraph":
    case "codeBlock":
    case "raw":
      return { ...node, id: undefined };
  }
}

export function stripListItemIds(node: ListItemNode): ListItemNode {
  return {
    ...node,
    id: undefined,
    children: node.children?.map(stripBlockIds),
  };
}

import type { PromptBlockNode, PromptDocument } from "../nodes/types";
import { mapPromptBlocks } from "./tree-utils";

export function insertBeforeId(
  prompt: PromptDocument,
  id: string,
  nodes: PromptBlockNode | readonly PromptBlockNode[],
): PromptDocument {
  const insertions = Array.isArray(nodes) ? nodes : [nodes];
  return {
    ...prompt,
    nodes: mapPromptBlocks(prompt.nodes, (node) =>
      node.id === id ? [...insertions, node] : node,
    ),
  };
}

export function insertAfterId(
  prompt: PromptDocument,
  id: string,
  nodes: PromptBlockNode | readonly PromptBlockNode[],
): PromptDocument {
  const insertions = Array.isArray(nodes) ? nodes : [nodes];
  return {
    ...prompt,
    nodes: mapPromptBlocks(prompt.nodes, (node) =>
      node.id === id ? [node, ...insertions] : node,
    ),
  };
}

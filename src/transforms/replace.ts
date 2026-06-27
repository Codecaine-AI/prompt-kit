import type { PromptBlockNode, PromptDocument } from "../nodes/types";
import { mapPromptBlocks } from "./tree-utils";

export function replaceNodeById(
  prompt: PromptDocument,
  id: string,
  replacement: PromptBlockNode | readonly PromptBlockNode[],
): PromptDocument {
  const replacements = Array.isArray(replacement) ? replacement : [replacement];
  return {
    ...prompt,
    nodes: mapPromptBlocks(prompt.nodes, (node) =>
      node.id === id ? replacements : node,
    ),
  };
}

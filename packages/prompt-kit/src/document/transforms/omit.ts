import type { PromptDocument } from "../nodes/types";
import { mapPromptBlocks } from "./tree-utils";

export function omitNodeById(prompt: PromptDocument, id: string): PromptDocument {
  return {
    ...prompt,
    nodes: mapPromptBlocks(prompt.nodes, (node) => (node.id === id ? [] : node)),
  };
}

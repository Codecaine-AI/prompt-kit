import {
  PROMPT_KIT_SCHEMA_VERSION,
  type PromptDocument,
  type PromptDocumentInput,
  type PromptNode,
} from "./types";

export function createNode<TNode extends PromptNode>(node: TNode): TNode {
  return node;
}

export function definePrompt(input: PromptDocumentInput): PromptDocument {
  return {
    kind: "prompt",
    schemaVersion: input.schemaVersion ?? PROMPT_KIT_SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    description: input.description,
    archetype: input.archetype,
    nodes: input.nodes ?? [],
    metadata: input.metadata,
  };
}

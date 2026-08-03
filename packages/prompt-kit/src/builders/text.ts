import type {
  ParagraphNode,
  PromptInline,
  ReferenceNode,
  VariableReferenceNode,
} from "../nodes/types";

export type InlineInput = PromptInline | PromptInline[];

export interface InlineNodeOptions {
  id?: string;
  metadata?: Record<string, unknown>;
}

export function inline(input: InlineInput | undefined): PromptInline[] {
  if (input === undefined) return [];
  return Array.isArray(input) ? input : [input];
}

export function paragraph(
  content: InlineInput,
  options: InlineNodeOptions = {},
): ParagraphNode {
  return {
    type: "paragraph",
    id: options.id,
    metadata: options.metadata,
    content: inline(content),
  };
}

export function variable(
  name: string,
  options: InlineNodeOptions & { fallback?: InlineInput } = {},
): VariableReferenceNode {
  return {
    type: "variable",
    id: options.id,
    metadata: options.metadata,
    name,
    fallback: inline(options.fallback),
  };
}

export function reference(
  kind: string,
  name: string,
  options: InlineNodeOptions = {},
): ReferenceNode {
  return {
    type: "reference",
    id: options.id,
    metadata: options.metadata,
    kind,
    name,
  };
}

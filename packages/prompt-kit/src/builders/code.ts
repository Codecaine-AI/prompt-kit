import type { CodeBlockNode, RawNode } from "../nodes/types";

export interface CodeBlockOptions {
  id?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export interface RawOptions {
  id?: string;
  metadata?: Record<string, unknown>;
}

export function codeBlock(
  code: string,
  options: CodeBlockOptions = {},
): CodeBlockNode {
  return {
    type: "codeBlock",
    id: options.id,
    metadata: options.metadata,
    language: options.language,
    code,
  };
}

export function raw(value: string, options: RawOptions = {}): RawNode {
  return {
    type: "raw",
    id: options.id,
    metadata: options.metadata,
    value,
  };
}

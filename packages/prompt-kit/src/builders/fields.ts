import type { FieldNode } from "../nodes/types";
import { blocks, type BlockInput } from "./normalize";
import { inline, type InlineInput } from "./text";

export interface FieldOptions {
  id?: string;
  children?: readonly BlockInput[];
  metadata?: Record<string, unknown>;
}

export function field(
  label: string,
  value: InlineInput,
  options: FieldOptions = {},
): FieldNode {
  return {
    type: "field",
    id: options.id,
    metadata: options.metadata,
    label,
    value: inline(value),
    children: blocks(options.children),
  };
}

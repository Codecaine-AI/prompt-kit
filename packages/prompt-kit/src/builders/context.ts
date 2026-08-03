import type { ContextUsageNode } from "../nodes/types";
import { bulletList } from "./lists";
import { blocks, type BlockInput } from "./normalize";

export interface UsesContextOptions {
  id?: string;
  tag?: string;
  instructions?: readonly string[] | readonly BlockInput[];
  metadata?: Record<string, unknown>;
}

export function usesContext(
  contextId: string,
  options: UsesContextOptions = {},
): ContextUsageNode {
  const instructions = options.instructions ?? [];
  const instructionNodes =
    instructions.length > 0 && instructions.every((entry) => typeof entry === "string")
      ? [bulletList(instructions as readonly string[])]
      : blocks(instructions as readonly BlockInput[]);

  return {
    type: "contextUsage",
    id: options.id,
    metadata: options.metadata,
    contextId,
    tag: options.tag,
    instructions: instructionNodes,
  };
}

import type { ExampleNode } from "../nodes/types";
import { blocks, type BlockInput } from "./normalize";

export interface ExampleOptions {
  id?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export function example(
  children: readonly BlockInput[],
  options: ExampleOptions = {},
): ExampleNode {
  return {
    type: "example",
    id: options.id,
    metadata: options.metadata,
    title: options.title,
    children: blocks(children),
  };
}

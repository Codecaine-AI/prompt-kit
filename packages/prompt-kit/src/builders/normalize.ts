import type { PromptBlockNode, PromptInline } from "../nodes/types";
import { paragraph, type InlineInput } from "./text";

export type BlockInput = PromptBlockNode | string;

export function block(input: BlockInput): PromptBlockNode {
  return typeof input === "string" ? paragraph(input) : input;
}

export function blocks(inputs: readonly BlockInput[] = []): PromptBlockNode[] {
  return inputs.map(block);
}

export function inlineText(input: InlineInput): PromptInline[] {
  return Array.isArray(input) ? input : [input];
}

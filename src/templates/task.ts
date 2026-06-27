import { definePrompt } from "../nodes/create-node";
import type {
  PromptBlockNode,
  PromptDocument,
  PromptDocumentInput,
} from "../nodes/types";
import { blocks, type BlockInput } from "../builders/normalize";
import { section } from "../builders/section";

export interface SingleOutputPromptInput
  extends Omit<PromptDocumentInput, "archetype" | "nodes"> {
  purpose?: readonly BlockInput[];
  instructions?: readonly BlockInput[];
  output?: readonly BlockInput[];
  sections?: readonly PromptBlockNode[];
}

export function singleOutputPrompt(
  input: SingleOutputPromptInput,
): PromptDocument {
  const nodes: PromptBlockNode[] = [
    ...(input.purpose ? [section("purpose", input.purpose)] : []),
    ...(input.instructions ? [section("instructions", input.instructions)] : []),
    ...(input.output ? [section("output_format", input.output)] : []),
    ...(input.sections ?? []),
  ];

  return definePrompt({
    ...input,
    archetype: "singleOutput",
    nodes,
  });
}

export function taskSection(tag: string, children: readonly BlockInput[]) {
  return section(tag, blocks(children));
}

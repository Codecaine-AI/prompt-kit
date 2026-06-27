import { definePrompt } from "../nodes/create-node";
import type {
  PromptBlockNode,
  PromptDocument,
  PromptDocumentInput,
} from "../nodes/types";
import { section } from "../builders/section";
import type { BlockInput } from "../builders/normalize";

export interface WorkflowPromptInput
  extends Omit<PromptDocumentInput, "archetype" | "nodes"> {
  purpose?: readonly BlockInput[];
  rules?: readonly BlockInput[];
  workflow?: readonly BlockInput[];
  output?: readonly BlockInput[];
  sections?: readonly PromptBlockNode[];
}

export function workflowPrompt(input: WorkflowPromptInput): PromptDocument {
  const nodes: PromptBlockNode[] = [
    ...(input.purpose ? [section("purpose", input.purpose)] : []),
    ...(input.rules ? [section("rules", input.rules)] : []),
    ...(input.workflow ? [section("workflow", input.workflow)] : []),
    ...(input.output ? [section("output_format", input.output)] : []),
    ...(input.sections ?? []),
  ];

  return definePrompt({
    ...input,
    archetype: "workflow",
    nodes,
  });
}

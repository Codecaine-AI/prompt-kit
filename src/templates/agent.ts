import type { PromptBlockNode, PromptDocument } from "../nodes/types";
import { section } from "../builders/section";
import type { WorkflowPromptInput } from "./workflow";
import { workflowPrompt } from "./workflow";

export interface AgentPromptInput extends WorkflowPromptInput {
  reminders?: readonly PromptBlockNode[];
}

export function agentPrompt(input: AgentPromptInput): PromptDocument {
  return workflowPrompt({
    ...input,
    sections: [
      ...(input.sections ?? []),
      ...(input.reminders ? [section("reminders", input.reminders)] : []),
    ],
  });
}

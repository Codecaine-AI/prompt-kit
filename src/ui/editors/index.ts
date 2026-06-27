import type { PromptDocument } from "../../nodes/types";

export interface PromptEditorModel {
  prompt: PromptDocument;
  selectedNodeId?: string;
}

export function createPromptEditorModel(
  prompt: PromptDocument,
): PromptEditorModel {
  return { prompt };
}

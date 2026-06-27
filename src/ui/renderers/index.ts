import type { PromptDocument } from "../../nodes/types";
import { renderXmlMarkdown } from "../../renderers/xml-markdown";

export interface PromptPreviewModel {
  prompt: PromptDocument;
  rendered: string;
}

export function createPromptPreviewModel(
  prompt: PromptDocument,
): PromptPreviewModel {
  return {
    prompt,
    rendered: renderXmlMarkdown(prompt),
  };
}

import type { PromptDocument } from "../nodes/types";
import {
  createRenderContext,
  renderNodes,
  type XmlMarkdownRenderOptions,
} from "./render-node";

export type RenderXmlMarkdownOptions = XmlMarkdownRenderOptions;

export function renderXmlMarkdown(
  prompt: PromptDocument,
  options: RenderXmlMarkdownOptions = {},
): string {
  const ctx = createRenderContext(options);
  return renderNodes(prompt.nodes, 0, ctx);
}

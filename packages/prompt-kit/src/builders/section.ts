import type { PromptBlockNode, SectionNode } from "../nodes/types";
import { blocks, type BlockInput } from "./normalize";

export interface SectionOptions {
  id?: string;
  title?: string;
  attrs?: SectionNode["attrs"];
  metadata?: Record<string, unknown>;
}

export function section(
  tag: string,
  children: readonly BlockInput[] = [],
  options: SectionOptions = {},
): SectionNode {
  return {
    type: "section",
    id: options.id,
    metadata: options.metadata,
    tag,
    title: options.title,
    attrs: options.attrs,
    children: blocks(children) as PromptBlockNode[],
  };
}

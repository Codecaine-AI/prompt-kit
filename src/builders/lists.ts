import type {
  BulletListNode,
  ListItemNode,
  OrderedListNode,
} from "../nodes/types";
import { blocks, type BlockInput } from "./normalize";
import { inline, type InlineInput } from "./text";

export type ListItemInput = string | ListItemNode;

export interface ListItemOptions {
  id?: string;
  metadata?: Record<string, unknown>;
}

export interface ListOptions {
  id?: string;
  metadata?: Record<string, unknown>;
}

export interface OrderedListOptions extends ListOptions {
  start?: number;
}

export function item(
  content: InlineInput,
  children: readonly BlockInput[] = [],
  options: ListItemOptions = {},
): ListItemNode {
  return {
    type: "listItem",
    id: options.id,
    metadata: options.metadata,
    content: inline(content),
    children: blocks(children),
  };
}

function normalizeListItem(input: ListItemInput): ListItemNode {
  return typeof input === "string" ? item(input) : input;
}

export function bulletList(
  items: readonly ListItemInput[],
  options: ListOptions = {},
): BulletListNode {
  return {
    type: "bulletList",
    id: options.id,
    metadata: options.metadata,
    items: items.map(normalizeListItem),
  };
}

export function orderedList(
  items: readonly ListItemInput[],
  options: OrderedListOptions = {},
): OrderedListNode {
  return {
    type: "orderedList",
    id: options.id,
    metadata: options.metadata,
    start: options.start,
    items: items.map(normalizeListItem),
  };
}

import { createHash } from "node:crypto";

import { ensurePromptNodeIds } from "../nodes/ids";
import type {
  ListItemNode,
  PromptBlockNode,
  PromptDocument,
  PromptInline,
  ReferenceNode,
  VariableReferenceNode,
} from "../nodes/types";

/**
 * Versions the canonicalization itself, independent of the `schemaVersion`
 * carried inside the document. Bump when the canonical byte layout changes.
 */
export const PROMPT_HASH_PREFIX = "pk1-";

/**
 * Schema-defined key order for the document envelope. Members that are
 * `undefined` are never serialized.
 */
export const CANONICAL_DOCUMENT_KEY_ORDER = [
  "kind",
  "schemaVersion",
  "id",
  "title",
  "description",
  "archetype",
  "nodes",
  "metadata",
] as const;

/**
 * Schema-defined key order per node type. Rule: `type`, `id`, then the
 * type-specific scalar and inline fields in declaration order, then child
 * node collections, then `metadata`. Object insertion order of incoming
 * documents is irrelevant — this table is the single source of truth.
 */
export const CANONICAL_NODE_KEY_ORDER: Readonly<
  Record<string, readonly string[]>
> = {
  section: ["type", "id", "tag", "title", "attrs", "children", "metadata"],
  paragraph: ["type", "id", "content", "metadata"],
  bulletList: ["type", "id", "items", "metadata"],
  orderedList: ["type", "id", "start", "items", "metadata"],
  listItem: ["type", "id", "content", "children", "metadata"],
  field: ["type", "id", "label", "value", "children", "metadata"],
  codeBlock: ["type", "id", "language", "code", "metadata"],
  example: ["type", "id", "title", "children", "metadata"],
  raw: ["type", "id", "value", "metadata"],
  contextUsage: ["type", "id", "contextId", "tag", "instructions", "metadata"],
  variable: ["type", "id", "name", "fallback", "metadata"],
  reference: ["type", "id", "kind", "name", "metadata"],
};

/** Keys whose values are arrays of block/list-item nodes. */
const NODE_ARRAY_KEYS = new Set(["children", "items", "instructions"]);

/** `type.key` pairs whose values are `PromptInline[]`. */
const INLINE_ARRAY_KEYS = new Set([
  "paragraph.content",
  "listItem.content",
  "field.value",
  "variable.fallback",
]);

/**
 * Optional child collections where an empty array is semantically identical
 * to the member being absent; both forms canonicalize to the omitted form so
 * editor round-trips (insert child, then remove it) keep a stable hash.
 */
const OMIT_WHEN_EMPTY_KEYS = new Set(["field.children", "listItem.children"]);

type CanonicalNode =
  | PromptBlockNode
  | ListItemNode
  | VariableReferenceNode
  | ReferenceNode;

/**
 * Deterministic serialization of a PromptDocument: `ensurePromptNodeIds` is
 * applied first, keys follow the canonical key-order tables, `undefined`
 * members are dropped, metadata object keys are sorted recursively, and the
 * output is UTF-8 JSON with LF line endings (2-space indent, trailing
 * newline).
 */
export function canonicalizePrompt(doc: PromptDocument): string {
  const prompt = ensurePromptNodeIds(doc);
  const canonical: Record<string, unknown> = {};
  for (const key of CANONICAL_DOCUMENT_KEY_ORDER) {
    const value = prompt[key];
    if (value === undefined) continue;
    if (key === "nodes") {
      canonical[key] = prompt.nodes.map((node) => canonicalizeNode(node));
    } else if (key === "metadata") {
      canonical[key] = canonicalizeUnknown(value);
    } else {
      canonical[key] = value;
    }
  }
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/**
 * Content address for a PromptDocument: `"pk1-" + sha256hex(canonicalBytes)`.
 */
export function hashPrompt(doc: PromptDocument): string {
  const digest = createHash("sha256")
    .update(canonicalizePrompt(doc), "utf8")
    .digest("hex");
  return `${PROMPT_HASH_PREFIX}${digest}`;
}

function canonicalizeNode(node: CanonicalNode): Record<string, unknown> {
  const order = CANONICAL_NODE_KEY_ORDER[node.type];
  if (!order) {
    throw new Error(
      `canonicalizePrompt: unknown node type "${String((node as { type?: unknown }).type)}"`,
    );
  }
  const record = node as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of order) {
    const value = record[key];
    if (value === undefined) continue;
    if (
      OMIT_WHEN_EMPTY_KEYS.has(`${node.type}.${key}`) &&
      Array.isArray(value) &&
      value.length === 0
    ) {
      continue;
    }
    out[key] = canonicalizeNodeValue(node.type, key, value);
  }
  return out;
}

function canonicalizeNodeValue(
  type: string,
  key: string,
  value: unknown,
): unknown {
  if (key === "metadata") return canonicalizeUnknown(value);
  if (key === "attrs") return canonicalizeUnknown(value);
  if (NODE_ARRAY_KEYS.has(key)) {
    return (value as CanonicalNode[]).map((child) => canonicalizeNode(child));
  }
  if (INLINE_ARRAY_KEYS.has(`${type}.${key}`)) {
    return (value as PromptInline[]).map((part) =>
      typeof part === "string" ? part : canonicalizeNode(part),
    );
  }
  return value;
}

function canonicalizeUnknown(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeUnknown(entry));
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const member = record[key];
    if (member === undefined) continue;
    out[key] = canonicalizeUnknown(member);
  }
  return out;
}

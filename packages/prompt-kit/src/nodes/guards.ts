import type {
  ListItemNode,
  PromptBlockNode,
  PromptDocument,
  PromptInline,
  PromptNode,
  VariableReferenceNode,
} from "./types";

export function isPromptDocument(node: PromptNode): node is PromptDocument {
  return "kind" in node && node.kind === "prompt";
}

export function isPromptBlockNode(node: unknown): node is PromptBlockNode {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    typeof (node as { type?: unknown }).type === "string" &&
    (node as { type: string }).type !== "listItem" &&
    (node as { type: string }).type !== "variable" &&
    (node as { type: string }).type !== "reference"
  );
}

export function isListItemNode(node: unknown): node is ListItemNode {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "listItem"
  );
}

export function isVariableReference(
  value: PromptInline,
): value is VariableReferenceNode {
  return typeof value === "object" && value.type === "variable";
}

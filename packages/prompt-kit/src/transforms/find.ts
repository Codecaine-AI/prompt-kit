import type { PromptDocument, PromptNode } from "../nodes/types";
import { visitPrompt, type VisitEntry } from "./visit";

export function findNodeById(
  prompt: PromptDocument,
  id: string,
): VisitEntry | undefined {
  let match: VisitEntry | undefined;
  visitPrompt(prompt, (entry) => {
    if (match) return;
    if ("id" in entry.node && entry.node.id === id) {
      match = entry;
    }
  });
  return match;
}

export function findNodes(
  prompt: PromptDocument,
  predicate: (node: PromptNode) => boolean,
): VisitEntry[] {
  const matches: VisitEntry[] = [];
  visitPrompt(prompt, (entry) => {
    if (predicate(entry.node)) matches.push(entry);
  });
  return matches;
}

export function findSectionsByTag(
  prompt: PromptDocument,
  tag: string,
): VisitEntry[] {
  return findNodes(
    prompt,
    (node) => "type" in node && node.type === "section" && node.tag === tag,
  );
}

/**
 * Prompt annotations — an annotation marks a node in a `PromptDocument` and
 * carries a note or agent request. The validation/dangling engine lives in
 * `@codecaine-ai/annotations/core`; this module supplies the prompt-kit
 * target adapter (`prompt-node`) and the configured schema.
 */

import {
  createAnnotationSchema,
  type TargetAdapter,
  type ValidationIssue,
} from "@codecaine-ai/annotations/core";

import type { PromptDocument } from "../nodes/types";
import { visitPrompt } from "../transforms/visit";
import {
  buildXmlLineModel,
  nodeRenderedText,
  type XmlLine,
} from "../ui/prompt-flow/xml-line-model";

export type {
  Annotation,
  AnnotationAgentRun,
  AnnotationReply,
  AnnotationsDocument,
  DanglingTarget,
  ValidationIssue,
  ValidationResult,
} from "@codecaine-ai/annotations/core";
import type { Annotation, AnnotationsDocument } from "@codecaine-ai/annotations/core";

export type PromptNodeTarget = {
  kind: "prompt-node";
  docId: string;
  nodeId: string;
};

/**
 * A text range inside ONE node's rendered XML. `start`/`end` are character
 * offsets into the node's rendered text — its extent's `XmlLine.text` values
 * (gap rows excluded, leading indentation included) joined with "\n"; see
 * `nodeRenderedText` in the xml-line-model. For a leaf that is its own lines;
 * for a container (a list, a section) the extent spans its descendants too,
 * so a multi-bullet drag can anchor a range on the nearest common ancestor.
 * `end` is exclusive. `quote` is the exact `slice(start, end)` of that string
 * at annotation time, kept so drift is detectable after edits.
 */
export type PromptRangeTarget = {
  kind: "prompt-range";
  docId: string;
  nodeId: string;
  start: number;
  end: number;
  quote: string;
};

export type PromptAnnotationTarget = PromptNodeTarget | PromptRangeTarget;

export type PromptAnnotationIntent = "note" | "agent-request";
export type PromptAnnotationStatus = "open" | "resolved";

export type PromptAnnotation = Annotation<PromptAnnotationTarget>;
export type PromptAnnotationsDocument = AnnotationsDocument<PromptAnnotationTarget>;

export const promptNodeTargetAdapter: TargetAdapter<
  PromptNodeTarget,
  PromptDocument | null
> = {
  kind: "prompt-node",
  validateTarget(raw, path, issues: ValidationIssue[]) {
    // Prompt node ids are user-editable (see PromptFlowInspector's
    // NodeIdField) and may contain characters outside the engine's strict
    // `isId` pattern, so we only require non-empty strings here rather than
    // rejecting ids the editor itself allows.
    let ok = true;
    if (typeof raw.docId !== "string" || raw.docId.length === 0) {
      issues.push({
        path: `${path}.docId`,
        message: "Prompt node target requires a non-empty docId.",
      });
      ok = false;
    }
    if (typeof raw.nodeId !== "string" || raw.nodeId.length === 0) {
      issues.push({
        path: `${path}.nodeId`,
        message: "Prompt node target requires a non-empty nodeId.",
      });
      ok = false;
    }
    if (!ok) return null;
    return {
      kind: "prompt-node",
      docId: raw.docId as string,
      nodeId: raw.nodeId as string,
    };
  },
  key: (target) => `prompt-node:${target.docId}:${target.nodeId}`,
  label: (target) => `Node ${target.nodeId}`,
  dangling(target, doc) {
    // Document not loaded yet — can't tell dangling from in-flight.
    if (!doc) return "skip";
    if (doc.id !== target.docId) {
      return `Annotation targets document "${target.docId}" but "${doc.id}" is loaded.`;
    }
    if (!promptHasNode(doc, target.nodeId)) {
      return `Node "${target.nodeId}" no longer exists.`;
    }
    return null;
  },
};

function promptHasNode(doc: PromptDocument, nodeId: string): boolean {
  let found = false;
  visitPrompt(doc, ({ node }) => {
    if (found) return;
    // Only tree nodes count — the document itself carries an `id` too but is
    // not an annotatable node.
    if ("type" in node && node.id === nodeId) found = true;
  });
  return found;
}

// Dangling checks run per annotation but the line model is per document, so
// one build is shared across every prompt-range check of the same doc object.
const lineModelCache = new WeakMap<PromptDocument, readonly XmlLine[]>();

function cachedLines(doc: PromptDocument): readonly XmlLine[] {
  let lines = lineModelCache.get(doc);
  if (!lines) {
    lines = buildXmlLineModel(doc).lines;
    lineModelCache.set(doc, lines);
  }
  return lines;
}

/** The rendered text a range target's offsets index — a node's extent, or the
 * whole document (every non-gap line) when `nodeId === docId`. */
function renderedRangeTextFor(
  doc: PromptDocument,
  target: PromptRangeTarget,
): string {
  const lines = cachedLines(doc);
  if (target.nodeId === target.docId) {
    return lines
      .filter((line) => line.role !== "gap")
      .map((line) => line.text)
      .join("\n");
  }
  return nodeRenderedText(lines, target.nodeId);
}

/** Composer/label truncation width for quoted range text. */
const RANGE_LABEL_QUOTE_LENGTH = 40;

export const promptRangeTargetAdapter: TargetAdapter<
  PromptRangeTarget,
  PromptDocument | null
> = {
  kind: "prompt-range",
  validateTarget(raw, path, issues: ValidationIssue[]) {
    let ok = true;
    if (typeof raw.docId !== "string" || raw.docId.length === 0) {
      issues.push({
        path: `${path}.docId`,
        message: "Prompt range target requires a non-empty docId.",
      });
      ok = false;
    }
    if (typeof raw.nodeId !== "string" || raw.nodeId.length === 0) {
      issues.push({
        path: `${path}.nodeId`,
        message: "Prompt range target requires a non-empty nodeId.",
      });
      ok = false;
    }
    if (!Number.isInteger(raw.start) || (raw.start as number) < 0) {
      issues.push({
        path: `${path}.start`,
        message: "Prompt range target requires an integer start >= 0.",
      });
      ok = false;
    } else if (
      !Number.isInteger(raw.end) ||
      (raw.end as number) <= (raw.start as number)
    ) {
      issues.push({
        path: `${path}.end`,
        message: "Prompt range target requires an integer end > start.",
      });
      ok = false;
    }
    if (typeof raw.quote !== "string" || raw.quote.length === 0) {
      issues.push({
        path: `${path}.quote`,
        message: "Prompt range target requires a non-empty quote.",
      });
      ok = false;
    }
    if (!ok) return null;
    return {
      kind: "prompt-range",
      docId: raw.docId as string,
      nodeId: raw.nodeId as string,
      start: raw.start as number,
      end: raw.end as number,
      quote: raw.quote as string,
    };
  },
  key: (target) =>
    `prompt-range:${target.docId}:${target.nodeId}:${target.start}-${target.end}`,
  label(target) {
    const normalized = target.quote.replace(/\s+/g, " ").trim();
    const truncated =
      normalized.length > RANGE_LABEL_QUOTE_LENGTH
        ? `${normalized.slice(0, RANGE_LABEL_QUOTE_LENGTH).trimEnd()}…`
        : normalized;
    return `Text "${truncated}"`;
  },
  dangling(target, doc) {
    // Document not loaded yet — can't tell dangling from in-flight.
    if (!doc) return "skip";
    if (doc.id !== target.docId) {
      return `Annotation targets document "${target.docId}" but "${doc.id}" is loaded.`;
    }
    // `nodeId === docId` anchors the range to the whole document (a
    // cross-section drag with no common ancestor block) — there is no node
    // to look up; the quote checks against the full rendered text below.
    if (target.nodeId !== target.docId && !promptHasNode(doc, target.nodeId)) {
      return `Node "${target.nodeId}" no longer exists.`;
    }
    // The quote must still appear in the CURRENT rendered text (the same
    // join the offsets index) — anywhere, not just at the original offsets,
    // so surrounding edits don't strand an intact quote.
    if (!renderedRangeTextFor(doc, target).includes(target.quote)) {
      return "Selected text no longer matches.";
    }
    return null;
  },
};

export const promptAnnotationSchema =
  createAnnotationSchema<PromptAnnotationTarget>({
    adapters: [promptNodeTargetAdapter, promptRangeTargetAdapter],
    intents: ["note", "agent-request"],
    statuses: ["open", "resolved"],
  });

export function targetForNode(
  doc: PromptDocument,
  nodeId: string,
): PromptNodeTarget {
  return { kind: "prompt-node", docId: doc.id, nodeId };
}

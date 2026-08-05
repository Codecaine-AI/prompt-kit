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

import type { PromptDocument } from "../document/nodes/types";
import { visitPrompt } from "../document/transforms/visit";
import {
  buildXmlLineModel,
  nodeRenderedText,
  type XmlLine,
} from "../document/render/line-model";

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

/**
 * OPTIONAL/ADDITIVE on both target kinds: a short content hash of the
 * target node's rendered text, stamped when the annotation was FILED (see
 * `withTargetFingerprint`). It is drift evidence, never identity — `key()`
 * ignores it, the dangling checks ignore it, and documents written before it
 * existed still validate byte-identically (same discipline as the engine's
 * `agentRun.changedIds` / `replies`). The queue's "target changed since
 * filed" chip is the one consumer: compare it against the CURRENT
 * fingerprint with `targetFingerprintChanged`.
 */
export type PromptTargetFingerprint = string;

export type PromptNodeTarget = {
  kind: "prompt-node";
  docId: string;
  nodeId: string;
  fingerprint?: PromptTargetFingerprint;
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
  fingerprint?: PromptTargetFingerprint;
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
    const fingerprint = validateFingerprint(raw, path, issues);
    if (fingerprint === INVALID_FINGERPRINT) ok = false;
    if (!ok) return null;
    return {
      kind: "prompt-node",
      docId: raw.docId as string,
      nodeId: raw.nodeId as string,
      ...(typeof fingerprint === "string" ? { fingerprint } : {}),
    };
  },
  key: (target) => `prompt-node:${target.docId}:${target.nodeId}`,
  label: (target) =>
    target.nodeId === target.docId ? "Document" : `Node ${target.nodeId}`,
  dangling(target, doc) {
    // Document not loaded yet — can't tell dangling from in-flight.
    if (!doc) return "skip";
    if (doc.id !== target.docId) {
      return `Annotation targets document "${target.docId}" but "${doc.id}" is loaded.`;
    }
    // `nodeId === docId` is the whole-document target (the schema has no
    // separate doc kind — same convention as prompt-range below): there is
    // no tree node to look up, and the target can never dangle while the
    // document itself is loaded.
    if (target.nodeId !== target.docId && !promptHasNode(doc, target.nodeId)) {
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

/** Sentinel distinguishing "absent" (undefined) from "present but invalid". */
const INVALID_FINGERPRINT = Symbol("invalid-fingerprint");

/**
 * Shared additive check for the optional `fingerprint` both adapters accept.
 * Absent → undefined (the overwhelmingly common case, and every document
 * written before the field existed); present and a non-empty string → the
 * value; anything else → an issue plus the sentinel.
 */
function validateFingerprint(
  raw: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): string | undefined | typeof INVALID_FINGERPRINT {
  if (raw.fingerprint === undefined) return undefined;
  if (typeof raw.fingerprint !== "string" || raw.fingerprint.length === 0) {
    issues.push({
      path: `${path}.fingerprint`,
      message: "Annotation target fingerprint must be a non-empty string.",
    });
    return INVALID_FINGERPRINT;
  }
  return raw.fingerprint;
}

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
    const fingerprint = validateFingerprint(raw, path, issues);
    if (fingerprint === INVALID_FINGERPRINT) ok = false;
    if (!ok) return null;
    return {
      kind: "prompt-range",
      docId: raw.docId as string,
      nodeId: raw.nodeId as string,
      start: raw.start as number,
      end: raw.end as number,
      quote: raw.quote as string,
      ...(typeof fingerprint === "string" ? { fingerprint } : {}),
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
  // Deliberately UNSTAMPED: this builds the LIVE pin (hover ring, selection,
  // the open composer's target). A fingerprint is evidence about a moment,
  // and the moment that matters is filing — see `withTargetFingerprint`.
  return { kind: "prompt-node", docId: doc.id, nodeId };
}

/* ------------------------------------------------------------------ */
/* Target fingerprints — drift evidence, not identity                  */
/* ------------------------------------------------------------------ */

/**
 * FNV-1a (32-bit), hex. Short, dependency-free, and deterministic across
 * runtimes — the fingerprint is compared for INEQUALITY only (has this node
 * changed since the note was filed?), so collision resistance beyond "two
 * different renderings rarely collide" buys nothing.
 */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The target node's content fingerprint in `doc` right now, or undefined for
 * document-level targets (the whole prompt always "changed" — a chip there
 * would be noise) and for nodes no longer in the render.
 *
 * Range targets fingerprint their OWNING NODE, not the quote: the quote is
 * frozen at file time by definition, so only the node around it can drift.
 */
export function promptTargetFingerprint(
  doc: PromptDocument,
  target: PromptAnnotationTarget,
): string | undefined {
  if (target.nodeId === target.docId) return undefined;
  if (doc.id !== target.docId) return undefined;
  const text = nodeRenderedText(cachedLines(doc), target.nodeId);
  return text.length > 0 ? hashText(text) : undefined;
}

/** The target, stamped with its content fingerprint at FILE time. */
export function withTargetFingerprint<T extends PromptAnnotationTarget>(
  doc: PromptDocument,
  target: T,
): T {
  const fingerprint = promptTargetFingerprint(doc, target);
  return fingerprint === undefined ? target : { ...target, fingerprint };
}

/**
 * True when the target carries a filed fingerprint AND the node's content
 * has moved under it since — the "target changed since filed" signal. An
 * unstamped target (older document, document-level note) never reports drift.
 */
export function targetFingerprintChanged(
  doc: PromptDocument,
  target: PromptAnnotationTarget,
): boolean {
  if (target.fingerprint === undefined) return false;
  const current = promptTargetFingerprint(doc, target);
  return current !== undefined && current !== target.fingerprint;
}

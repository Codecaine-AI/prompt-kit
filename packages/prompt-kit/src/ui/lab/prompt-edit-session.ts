// Slice: the prompt-edit session PROPS contract (the lab receives everything
// from a host container — it never fetches) plus the pure helpers that turn a
// session into inline surface geometry: staged-diff row plans, widget anchor
// rows, and the accept/reject/undo ordering discipline.

import type { PromptAnnotationTarget } from "../../annotations/schema";
import type { PromptStep } from "../editors";
import {
	nodeRenderedLines,
	type XmlLine,
} from "../prompt-flow/xml-line-model";
import { addedLines, afterRegionForRun, findLineRun } from "./staged-diff";

/**
 * Request lifecycle, mirroring the canvas queue vocabulary:
 * open → working → (waiting ↔) ready → applied | declined, with `resolved`
 * for requests closed without a proposal (doc-level notes). `waiting` is the
 * waiting-on-human flag — those requests render an inline amber thread bar.
 */
export type PromptEditRequestStatus =
	| "open"
	| "working"
	| "waiting"
	| "ready"
	| "applied"
	| "declined"
	| "resolved";

export interface PromptEditThreadMessage {
	author: "you" | "agent";
	body: string;
}

/** One R-alias request in the session queue (usually born as an annotation). */
export interface PromptEditRequest {
	/** Queue alias — "R1", "R2", agent-authored notes "A1"… Unique per session. */
	alias: string;
	/** The driving annotation, when the request came from the annotate flow. */
	annotationId?: string;
	author: "you" | "agent";
	status: PromptEditRequestStatus;
	/** The request text (or the agent's pinned note). */
	body: string;
	/** Anchor in the prompt; null = document-level request. */
	target: PromptAnnotationTarget | null;
	thread?: PromptEditThreadMessage[];
}

/**
 * A staged (not yet accepted) proposal. `renderedBefore`/`renderedAfter` are
 * whole-document `renderXmlMarkdown` outputs around this proposal's steps;
 * `changedIds` are the node ids the steps touch — the inline diff renders at
 * those nodes' rows. `steps` travel through for hosts that apply on accept.
 */
export interface PromptEditProposal {
	requestAlias: string;
	annotationId?: string;
	transactionId: string;
	changedIds: string[];
	summary: string;
	renderedBefore: string;
	renderedAfter: string;
	steps: PromptStep[];
}

/**
 * THE props contract between the lab and a session container (the wiring
 * spec for AgentPromptLabContainer). Ordering discipline, enforced by the
 * lab's buttons (disabled + tooltip reason, never an error after click):
 *
 * - `proposals` is the STAGING ORDER. Accept is enabled only on the first
 *   staged proposal; later Accepts are disabled until their turn.
 * - Reject is enabled only on the LAST staged proposal.
 * - Undo is enabled only on the request named by `undoableAlias` (the most
 *   recently applied change).
 * - While any proposal is staged the lab blocks manual editing of the blocks
 *   it touches (their rows are replaced by the inline diff).
 *
 * When `onSendRequest` is provided the container owns request creation: every
 * composer submit routes through it (and the doc-level rail input sends
 * `target: null`), and the lab does NOT write to its annotation store — the
 * container echoes the request back via `requests`. Without it the lab falls
 * back to its store-only annotate flow.
 */
export interface PromptEditSession {
	requests: PromptEditRequest[];
	/** Staged proposals in staging order (accept front-to-back). */
	proposals: PromptEditProposal[];
	/** Alias of the most recently APPLIED request — the only undoable one. */
	undoableAlias?: string;
	onAccept?: (alias: string) => void | Promise<void>;
	onReject?: (alias: string, note?: string) => void | Promise<void>;
	onUndo?: (alias: string) => void | Promise<void>;
	onAcceptAll?: () => void | Promise<void>;
	onDiscardDraft?: () => void | Promise<void>;
	onReplyToRequest?: (alias: string, body: string) => void | Promise<void>;
	onSendRequest?: (
		target: PromptAnnotationTarget | null,
		body: string,
	) => void | Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Ordering discipline                                                 */
/* ------------------------------------------------------------------ */

/** Why this proposal's Accept is disabled, or null when it may accept. */
export function acceptDisabledReason(
	proposals: readonly PromptEditProposal[],
	alias: string,
): string | null {
	const index = proposals.findIndex((p) => p.requestAlias === alias);
	if (index <= 0) return null;
	return `Accept ${proposals[0]!.requestAlias} first — accepts apply in staging order.`;
}

/** Why this proposal's Reject is disabled, or null when it may reject. */
export function rejectDisabledReason(
	proposals: readonly PromptEditProposal[],
	alias: string,
): string | null {
	const index = proposals.findIndex((p) => p.requestAlias === alias);
	if (index === -1 || index === proposals.length - 1) return null;
	return `Only the latest staged proposal (${proposals[proposals.length - 1]!.requestAlias}) can be rejected.`;
}

/** Why this applied request's Undo is disabled, or null when it may undo. */
export function undoDisabledReason(
	session: Pick<PromptEditSession, "undoableAlias">,
	alias: string,
): string | null {
	if (session.undoableAlias === alias) return null;
	return session.undoableAlias
		? `Undo ${session.undoableAlias} first — only the most recent applied change can be undone.`
		: "Nothing to undo.";
}

/* ------------------------------------------------------------------ */
/* Line-model geometry                                                 */
/* ------------------------------------------------------------------ */

/**
 * Row range (inclusive, indices into `lines`) of a node's rendered extent —
 * `nodeRenderedLines` re-anchored to line indices. Null when the node (or
 * list item) is not in the current render.
 */
export function nodeRowRange(
	lines: readonly XmlLine[],
	nodeId: string,
): { start: number; end: number } | null {
	const extent = nodeRenderedLines(lines, nodeId);
	if (extent.length === 0) return null;
	const start = lines.indexOf(extent[0]!);
	const end = lines.indexOf(extent[extent.length - 1]!);
	if (start === -1 || end === -1) return null;
	return { start, end };
}

/**
 * The row an inline widget for `target` inserts ABOVE. Node targets anchor at
 * their extent's first row; range targets at the first row the offsets
 * intersect; document-level targets (nodeId === docId, or null) at row 0.
 */
export function targetAnchorRow(
	lines: readonly XmlLine[],
	target: PromptAnnotationTarget | null,
): number | null {
	if (target === null) return 0;
	if (target.nodeId === target.docId) return 0;
	if (target.kind === "prompt-range") {
		const extent = nodeRenderedLines(lines, target.nodeId);
		let cursor = 0;
		for (const line of extent) {
			const rowStart = cursor;
			const rowEnd = cursor + line.text.length;
			cursor = rowEnd + 1;
			if (rowStart < target.end && rowEnd > target.start) {
				const index = lines.indexOf(line);
				return index === -1 ? null : index;
			}
		}
		// Offsets drifted past the extent — fall back to the node's first row.
	}
	const range = nodeRowRange(lines, target.nodeId);
	return range ? range.start : null;
}

/** The inline row plan for one staged proposal. */
export interface StagedRowPlan {
	/** Inclusive row range of the current render this proposal replaces. */
	rowStart: number;
	rowEnd: number;
	/** Old text — the replaced rows, red-tinted. */
	delLines: string[];
	/** New text — the proposal's replacement rows, green-tinted. */
	addLines: string[];
}

/**
 * Where (and as what) a proposal renders inline. The row range is the union
 * of the changed nodes' extents in the CURRENT line model; `delLines` is that
 * range's text (internal blank separator rows included — they are real
 * rendered lines); `addLines` comes from aligning the range against the
 * proposal's renderedBefore/renderedAfter line diff. Null when none of the
 * changed ids exist in the current render (pure inserts land at the end of
 * their parent — not yet supported inline; the proposal still shows in the
 * rail and banner).
 */
export function stagedRowPlan(
	lines: readonly XmlLine[],
	proposal: Pick<
		PromptEditProposal,
		"changedIds" | "renderedBefore" | "renderedAfter"
	>,
): StagedRowPlan | null {
	let rowStart = Number.POSITIVE_INFINITY;
	let rowEnd = Number.NEGATIVE_INFINITY;
	for (const id of proposal.changedIds) {
		const range = nodeRowRange(lines, id);
		if (!range) continue;
		rowStart = Math.min(rowStart, range.start);
		rowEnd = Math.max(rowEnd, range.end);
	}
	if (rowEnd < rowStart) return null;

	const delLines = lines
		.slice(rowStart, rowEnd + 1)
		.map((line) => line.text);
	const before = proposal.renderedBefore.split("\n");
	const after = proposal.renderedAfter.split("\n");
	const run = findLineRun(before, delLines);
	const addLines =
		run >= 0
			? afterRegionForRun(before, after, run, run + delLines.length - 1)
			: // Extent not present in renderedBefore (drift): best effort — the
				// diff's added lines. Still reviewable; accept order guards apply.
				addedLines(before, after);
	return { rowStart, rowEnd, delLines, addLines };
}

// Slice: the queue's derivation — pure functions that turn a session's
// requests into the queue the interaction model runs on (run-now retired
// 2026-08-05: EVERYTHING queues).
//
//   Notes file instantly into the queue and nothing runs until Apply; then
//   the queue narrates the run, `processing` on one card and `queued · next`
//   / `queued · #2` on the rest, advancing as each proposal stages. Closed
//   loops file as compact records.
//
// No React, no DOM — the lab feeds it the session and renders the result.

import type {
	PromptEditProposal,
	PromptEditRequest,
	PromptEditRequestStatus,
	PromptRequestDisposition,
} from "./prompt-edit-session";

/** Statuses that mean the loop is CLOSED — a record, not a live request. */
const DISPOSED: ReadonlySet<PromptEditRequestStatus> = new Set([
	"applied",
	"declined",
	"resolved",
]);

export function isDisposedStatus(status: PromptEditRequestStatus): boolean {
	return DISPOSED.has(status);
}

/**
 * The request's disposition. ADDITIVE default for requests filed before
 * dispositions existed (and for hosts that never set one): a request with
 * no target is a document note (`global`), anything else is a queue card
 * (`batch`). A legacy `run-now` disposition still round-trips — its request
 * simply queues like everything else now.
 */
export function requestDisposition(
	request: Pick<PromptEditRequest, "disposition" | "target">,
): PromptRequestDisposition {
	if (request.disposition) return request.disposition;
	return request.target === null ? "global" : "batch";
}

/** One live queue card (batch/global, loop still open). */
export interface QueueEntry {
	request: PromptEditRequest;
	disposition: PromptRequestDisposition;
	/** A proposal for this request is staged and waiting on the human. */
	staged: boolean;
	/** The one card the batch run is working right now. */
	processing: boolean;
	/** `processing` · `staged` · `queued · next` · `queued · #2` · … */
	stateLabel: string;
	/** An accepted change has moved the node this note was filed against. */
	conflict: boolean;
}

/** One closed request, as the compact `✓ R4 · target · resolved` record. */
export interface RecordEntry {
	request: PromptEditRequest;
	disposition: PromptRequestDisposition;
	/** Accepted/closed cleanly (`applied` | `resolved`) vs `declined`. */
	ok: boolean;
	/** `resolved` | `discarded`. */
	stateLabel: string;
	/** The node the record names — `document` for global notes. */
	targetLabel: string;
}

export interface RequestQueueModel {
	/** Every open request, in filing order. */
	queue: QueueEntry[];
	/** Every closed request, in filing order. */
	records: RecordEntry[];
	/** The queue card being worked, or null when the queue is at rest. */
	activeAlias: string | null;
	/** `processing R2 · 1 queued · 1 staged`, or `queue idle`. */
	pipeline: string;
	/** Apply has something to do. */
	canApply: boolean;
}

export interface RequestQueueInput {
	requests: readonly PromptEditRequest[];
	proposals: readonly PromptEditProposal[];
	/**
	 * Apply has been pressed and the batch has not drained. Only then does a
	 * card read `processing` — before Apply the queue is quiet, however many
	 * notes are waiting in it.
	 */
	applying: boolean;
	/** Aliases whose filed target has drifted (see `targetFingerprintChanged`). */
	conflictedAliases?: ReadonlySet<string>;
}

/** The node id a request names, or null for document-level notes. */
export function requestNodeId(
	request: Pick<PromptEditRequest, "target">,
): string | null {
	const target = request.target;
	if (!target) return null;
	return target.nodeId === target.docId ? null : target.nodeId;
}

/**
 * The whole REQUESTS-zone model in one pass.
 *
 * `activeAlias` is derived, not tracked: it is the first queued request
 * WITHOUT a staged proposal. Session events already arrive per staged
 * proposal, so the narration advances by itself as each one lands — there is
 * no separate "which one is running" signal to keep in sync (and none to go
 * stale when a host stages out of order).
 */
export function buildRequestQueue({
	requests,
	proposals,
	applying,
	conflictedAliases,
}: RequestQueueInput): RequestQueueModel {
	const stagedAliases = new Set(
		proposals.map((proposal) => proposal.requestAlias),
	);

	const queueRequests: PromptEditRequest[] = [];
	const records: RecordEntry[] = [];

	for (const request of requests) {
		const disposition = requestDisposition(request);
		if (isDisposedStatus(request.status)) {
			const ok = request.status !== "declined";
			records.push({
				request,
				disposition,
				ok,
				stateLabel: ok ? "resolved" : "discarded",
				targetLabel:
					disposition === "global"
						? "document"
						: (requestNodeId(request) ?? "document"),
			});
			continue;
		}
		queueRequests.push(request);
	}

	const unstaged = queueRequests.filter(
		(request) => !stagedAliases.has(request.alias),
	);
	const activeAlias = applying ? (unstaged[0]?.alias ?? null) : null;
	// Positions are counted over what is still WAITING — the processing card
	// is not "queued · next" to itself.
	const waiting = unstaged.filter((request) => request.alias !== activeAlias);

	const queue = queueRequests.map<QueueEntry>((request) => {
		const staged = stagedAliases.has(request.alias);
		const processing = request.alias === activeAlias;
		const waitingIndex = waiting.indexOf(request);
		return {
			request,
			disposition: requestDisposition(request),
			staged,
			processing,
			stateLabel: staged
				? "staged"
				: processing
					? "processing"
					: queuePositionLabel(waitingIndex),
			conflict: conflictedAliases?.has(request.alias) ?? false,
		};
	});

	return {
		queue,
		records,
		activeAlias,
		pipeline: pipelineSummary({
			activeAlias,
			queued: waiting.length,
			staged: queue.filter((entry) => entry.staged).length,
		}),
		canApply: !applying && unstaged.length > 0,
	};
}

/** `queued · next` for the head of the wait, `queued · #n` behind it. */
export function queuePositionLabel(waitingIndex: number): string {
	if (waitingIndex < 0) return "queued";
	return waitingIndex === 0 ? "queued · next" : `queued · #${waitingIndex + 1}`;
}

/** The pipeline line above the queue: what runs, what waits, what is staged. */
export function pipelineSummary({
	activeAlias,
	queued,
	staged,
}: {
	activeAlias: string | null;
	queued: number;
	staged: number;
}): string {
	const parts: string[] = [];
	if (activeAlias) parts.push(`processing ${activeAlias}`);
	if (queued > 0) parts.push(`${queued} queued`);
	if (staged > 0) parts.push(`${staged} staged`);
	return parts.length > 0 ? parts.join(" · ") : "queue idle";
}


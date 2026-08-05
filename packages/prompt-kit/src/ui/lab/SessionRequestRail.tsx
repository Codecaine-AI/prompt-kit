// Slice: the AI panel's queue — restyled 2026-08-05 (mockup A) as a CHAT
// PANEL:
//
//   TARGETS   one flat row per node note, filing order: target label
//             (violet, human-readable) · note text · quiet state · × on
//             hover. No positions, no counts — order IS the order, and only
//             meaningful states (staged/processing/waiting) speak.
//   DOCUMENT  whole-document notes, with their own input right in the
//             section. Closed loops follow under a hairline as slim ✓/✕
//             records (Undo stays reachable).
//   DOCK      pinned at the bottom: just Apply, click-only. One Apply for
//             the whole queue — both sections run as one batch in filing
//             order.
//
// Renders the PromptEditSession contract plus the derived RequestQueueModel;
// the container owns all state.
"use client";

import cn from "classnames";
import { useRef } from "react";
import {
	requestRunId,
	undoDisabledReason,
	type PromptEditRequest,
	type PromptEditSession,
} from "./prompt-edit-session";
import {
	requestNodeId,
	type QueueEntry,
	type RecordEntry,
	type RequestQueueModel,
} from "./request-queue";
import { ANNOTATE_COLORS } from "./AnnotateAmbient";

/** Live-status wording for cards the queue model does not narrate itself. */
const STATUS_LABEL: Record<PromptEditRequest["status"], string> = {
	open: "open",
	working: "working",
	waiting: "waiting on you",
	ready: "proposal ready",
	applied: "applied",
	declined: "declined",
	resolved: "resolved",
};

export interface SessionRequestRailProps {
	session: PromptEditSession;
	/** The derived queue/records split — see `buildRequestQueue`. */
	queue: RequestQueueModel;
	/** Apply has been pressed and the batch has not drained. */
	applying: boolean;
	/** Starts the batch session over the queued set. */
	onApply: () => void;
	/** Files a document-level note from the rail's input. */
	onFileGlobal?: (body: string) => void;
	/** Focus-click: select the card's target node on the surface. */
	onFocusTarget?: (nodeId: string | undefined) => void;
	/** Hover: light the card's target rows in the document (null on leave). */
	onHoverTarget?: (nodeId: string | null) => void;
	/** Human-readable label for a target node (outline section name); the
	 * raw node id is the fallback. */
	targetLabel?: (nodeId: string) => string;
}

export function SessionRequestRail({
	session,
	queue,
	applying,
	onApply,
	onFileGlobal,
	onFocusTarget,
	onHoverTarget,
	targetLabel,
}: SessionRequestRailProps) {
	const docInputRef = useRef<HTMLInputElement | null>(null);

	const sendDocMessage = () => {
		const body = docInputRef.current?.value.trim() ?? "";
		if (!body) return;
		if (onFileGlobal) onFileGlobal(body);
		else if (session.onSendRequest) void session.onSendRequest(null, body);
		else return;
		if (docInputRef.current) docInputRef.current.value = "";
	};

	const showDocInput = Boolean(onFileGlobal ?? session.onSendRequest);
	// The two sections: whole-document notes vs node-targeted notes. Filing
	// order holds within each; the RUN still drains the whole queue in
	// filing order — the split is wayfinding, not scheduling.
	const documentEntries = queue.queue.filter(
		(entry) => entry.disposition === "global",
	);
	const targetEntries = queue.queue.filter(
		(entry) => entry.disposition !== "global",
	);

	const renderRow = (entry: QueueEntry) => (
		<QueueRow
			key={entry.request.alias}
			entry={entry}
			session={session}
			onFocusTarget={onFocusTarget}
			onHoverTarget={onHoverTarget}
			targetLabel={targetLabel}
		/>
	);

	return (
		<div
			className="flex h-full min-h-0 flex-col"
			data-prompt-session-rail=""
		>
			{/* The list: TARGET notes, DOCUMENT notes (with their input), then
			    closed loops — the dock stays put below while this scrolls. */}
			<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
				<GroupHeader label="Targets" />
				{targetEntries.length === 0 ? (
					<p className="px-1.5 py-1 text-[13px] leading-relaxed text-muted-foreground/60">
						Nothing queued — Enter in a composer files here.
					</p>
				) : (
					targetEntries.map(renderRow)
				)}

				{(documentEntries.length > 0 || showDocInput) && (
					<>
						<GroupHeader label="Document" />
						{documentEntries.map(renderRow)}
						{/* The input lives WITH its section — a document note is
						    composed here, far from Apply, so nothing implies the
						    two are one gesture. */}
						{showDocInput && (
							<input
								ref={docInputRef}
								aria-label="Message the whole prompt"
								placeholder="Note about the whole document…"
								className="mx-1.5 mb-1.5 mt-0.5 min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-ring"
								onKeyDown={(event) => {
									if (event.key !== "Enter") return;
									event.preventDefault();
									sendDocMessage();
								}}
							/>
						)}
					</>
				)}

				{queue.records.length > 0 && (
					<>
						<div
							aria-hidden
							className="mx-1.5 mb-1 mt-2 h-px shrink-0 bg-border/60"
						/>
						{queue.records.map((record) => (
							<RecordRow
								key={record.request.alias}
								record={record}
								session={session}
								onFocusTarget={onFocusTarget}
							/>
						))}
					</>
				)}
			</div>

			{/* THE DOCK — just the one run affordance, click-only (no Enter
			    binding): a keystroke should never start the batch by
			    accident. Counts and positions left the UI 2026-08-05; the
			    rows themselves say what is processing/staged. */}
			<div
				className="mt-2 flex shrink-0 items-center justify-end gap-2 border-t pt-2.5"
				style={{ borderColor: ANNOTATE_COLORS.line }}
			>
				<button
					type="button"
					aria-label="Apply queue"
					data-prompt-queue-apply=""
					disabled={!queue.canApply}
					title={
						queue.canApply
							? "Run the queued notes"
							: applying
								? "The queue is running"
								: "Nothing queued"
					}
					className="shrink-0 rounded-md border px-2.5 py-1 text-[12px] tracking-[0.02em] transition-colors disabled:cursor-default disabled:opacity-50"
					style={
						queue.canApply
							? {
									color: ANNOTATE_COLORS.accentLit,
									borderColor: ANNOTATE_COLORS.line,
									background: "rgb(138 122 176 / 0.11)",
								}
							: { borderColor: "var(--prompt-editor-panel-border, #2B2B2B)" }
					}
					onClick={onApply}
				>
					{applying ? "running…" : "Apply"}
				</button>
			</div>
		</div>
	);
}

/** A section's micro-header: uppercase, letterspaced, nothing else. */
function GroupHeader({ label }: { label: string }) {
	return (
		<div className="px-1.5 pb-0.5 pt-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 first:pt-0.5">
			{label}
		</div>
	);
}

/**
 * One open note, flat: target · text · quiet state · × on hover. The row is
 * the whole affordance — hover lights the target in the document, click
 * jumps to it. Waiting rows keep their thread + reply inline below.
 */
function QueueRow({
	entry,
	session,
	onFocusTarget,
	onHoverTarget,
	targetLabel,
}: {
	entry: QueueEntry;
	session: PromptEditSession;
	onFocusTarget?: (nodeId: string | undefined) => void;
	onHoverTarget?: (nodeId: string | null) => void;
	targetLabel?: (nodeId: string) => string;
}) {
	const { request } = entry;
	const replyRef = useRef<HTMLInputElement | null>(null);
	const focusNodeId = requestNodeId(request) ?? undefined;
	const waiting = request.status === "waiting";
	// Positions ("queued · next", "#2") left the UI 2026-08-05: order is the
	// list order. Only states that MEAN something speak — staged, processing,
	// waiting on you.
	const stateLabel = entry.staged
		? "staged"
		: entry.processing
			? "processing"
			: waiting
				? STATUS_LABEL.waiting
				: "";
	const label =
		entry.disposition === "global"
			? "document"
			: focusNodeId
				? (targetLabel?.(focusNodeId) ?? focusNodeId)
				: "document";

	const sendReply = () => {
		const body = replyRef.current?.value.trim() ?? "";
		if (!body || !session.onReplyToRequest) return;
		void session.onReplyToRequest(request.alias, body);
		if (replyRef.current) replyRef.current.value = "";
	};

	return (
		<div
			data-prompt-session-card={request.alias}
			className={cn(
				"group rounded-md border-l-2 px-1.5 py-1 transition-colors",
				entry.processing || waiting
					? "border-transparent"
					: "border-transparent hover:bg-white/[0.03]",
				focusNodeId && "cursor-pointer",
			)}
			style={
				entry.processing
					? {
							borderLeftColor: ANNOTATE_COLORS.accent,
							background: ANNOTATE_COLORS.fill,
						}
					: waiting
						? { borderLeftColor: "rgb(245 158 11 / 0.6)" }
						: undefined
			}
			onMouseEnter={() => {
				if (focusNodeId) onHoverTarget?.(focusNodeId);
			}}
			onMouseLeave={() => onHoverTarget?.(null)}
			onClick={(event) => {
				if (
					event.target instanceof HTMLElement &&
					event.target.closest("button, input")
				) {
					return;
				}
				if (focusNodeId) onFocusTarget?.(focusNodeId);
			}}
		>
			<div className="flex items-baseline gap-2">
				<span
					data-prompt-card-target={request.alias}
					title={
						entry.disposition === "global" ? undefined : focusNodeId
					}
					className="min-w-0 truncate text-[12px]"
					style={{ color: ANNOTATE_COLORS.accentLit }}
				>
					{entry.disposition === "global" ? "document" : label}
				</span>
				{entry.processing && (
					<span
						aria-hidden
						className="h-[5px] w-[5px] shrink-0 self-center rounded-full"
						style={{
							background: ANNOTATE_COLORS.accent,
							animation:
								"prompt-annotate-breathe 0.72s ease-in-out infinite",
						}}
					/>
				)}
				<span
					data-prompt-card-state={request.alias}
					className="ml-auto shrink-0 text-[10px] tracking-[0.04em]"
					style={{
						color: entry.staged
							? "var(--prompt-editor-diff-add-fg, #3FB950)"
							: entry.processing
								? ANNOTATE_COLORS.accentLit
								: waiting
									? "rgb(245 158 11 / 0.9)"
									: undefined,
					}}
				>
					{stateLabel}
				</span>
				{/* Dismiss: a queued note nobody ran yet can simply leave.
				    Hidden while a run consumes the card or a proposal is
				    staged on it; visible on hover only, red under the cursor. */}
				{session.onDismissRequest && !entry.processing && !entry.staged && (
					<button
						type="button"
						aria-label={`Dismiss ${request.alias}`}
						title={`Dismiss ${request.alias} — removes it from the queue`}
						className="shrink-0 text-[12px] leading-none text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60 hover:!text-[#F85149]"
						onClick={() =>
							void session.onDismissRequest?.(requestRunId(request))
						}
					>
						✕
					</button>
				)}
			</div>
			{/* The note itself, INDENTED under its target: the label names the
			    place, the indent says "here is the comment on it". */}
			<p className="mt-0.5 pl-4 text-[13px] leading-[1.55] text-foreground">
				{request.body}
			</p>
			{entry.conflict && (
				<p
					data-prompt-card-conflict={request.alias}
					title="An accepted change touched this node after the note was filed."
					className="mt-0.5 text-[11px] text-amber-500/90"
				>
					target changed since filed
				</p>
			)}
			{(request.thread?.length ?? 0) > 0 && (
				<div className="mt-1 border-l-2 border-border pl-2">
					{request.thread!.map((message, index) => (
						<p
							key={`${request.alias}:msg:${index}`}
							className="mb-0.5 text-[12px] leading-[1.5]"
						>
							<span
								className={cn(
									"text-[11px]",
									message.author === "agent"
										? "text-teal-400"
										: "text-muted-foreground/70",
								)}
							>
								{message.author} ·{" "}
							</span>
							<span className="text-muted-foreground">{message.body}</span>
						</p>
					))}
				</div>
			)}
			{waiting && session.onReplyToRequest && (
				<div className="mt-1 flex gap-1.5">
					<input
						ref={replyRef}
						aria-label={`Reply to unblock ${request.alias}`}
						placeholder={`Reply to unblock ${request.alias}…`}
						className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-amber-500/60"
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							sendReply();
						}}
					/>
					<button
						type="button"
						aria-label={`Rail reply to ${request.alias}`}
						className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
						onClick={sendReply}
					>
						Reply
					</button>
				</div>
			)}
		</div>
	);
}

/** A closed loop, slim: `✓ R4 · rules-voice · resolved`. Undo stays. */
function RecordRow({
	record,
	session,
	onFocusTarget,
}: {
	record: RecordEntry;
	session: PromptEditSession;
	onFocusTarget?: (nodeId: string | undefined) => void;
}) {
	const { request } = record;
	const focusNodeId = requestNodeId(request) ?? undefined;
	const undoReason = undoDisabledReason(session, request.alias);

	return (
		<div
			data-prompt-session-record={request.alias}
			data-prompt-record-state={record.stateLabel}
			className={cn(
				"flex items-baseline gap-2 px-1.5 py-0.5 text-[12px] leading-[1.55] text-muted-foreground/70",
				focusNodeId && "cursor-pointer hover:text-foreground",
			)}
			title={request.body}
			onClick={(event) => {
				if (
					event.target instanceof HTMLElement &&
					event.target.closest("button")
				) {
					return;
				}
				if (focusNodeId) onFocusTarget?.(focusNodeId);
			}}
		>
			<span
				aria-hidden
				style={{
					color: record.ok
						? "var(--prompt-editor-diff-add-fg, #3FB950)"
						: undefined,
				}}
			>
				{record.ok ? "✓" : "✕"}
			</span>
			<span className="text-muted-foreground">{request.alias}</span>
			<span className="text-muted-foreground/40">·</span>
			<span className="min-w-0 truncate">{record.targetLabel}</span>
			<span className="text-muted-foreground/40">·</span>
			<span className="text-[11px] text-muted-foreground/60">
				{record.stateLabel}
			</span>
			{request.status === "applied" && session.onUndo && (
				<button
					type="button"
					aria-label={`Undo ${request.alias}`}
					disabled={undoReason !== null}
					title={undoReason ?? `Undo ${request.alias}`}
					data-prompt-record-undo={requestRunId(request)}
					className="ml-auto rounded-md border border-border px-2 text-[10px] text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
					onClick={() => void session.onUndo?.(request.alias)}
				>
					Undo
				</button>
			)}
		</div>
	);
}

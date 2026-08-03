// Slice: the session request rail — slim cards (alias + status + body +
// thread; no quote, no target chip — click-to-focus does that job), the
// doc-level message input, and the Undo affordance for applied requests.
// Renders the PromptEditSession contract; the container owns all state.
"use client";

import cn from "classnames";
import { useRef } from "react";
import {
	undoDisabledReason,
	type PromptEditRequest,
	type PromptEditSession,
} from "./prompt-edit-session";
import { AliasChip } from "./SessionInlineBars";

const STATUS_LABEL: Record<PromptEditRequest["status"], string> = {
	open: "open",
	working: "working",
	waiting: "waiting on you",
	ready: "proposal ready",
	applied: "applied",
	declined: "declined",
	resolved: "resolved",
};

const STATUS_CLASS: Record<PromptEditRequest["status"], string> = {
	open: "text-sky-400 bg-sky-400/10",
	working: "text-sky-400 bg-sky-400/10",
	waiting: "text-amber-500 bg-amber-500/10",
	ready: "text-teal-400 bg-teal-400/10",
	applied: "text-green-500 bg-green-500/10",
	declined: "text-muted-foreground bg-muted/40",
	resolved: "text-muted-foreground bg-muted/40",
};

export interface SessionRequestRailProps {
	session: PromptEditSession;
	/** Focus-click: select the card's target node on the surface. */
	onFocusTarget?: (nodeId: string | undefined) => void;
}

export function SessionRequestRail({
	session,
	onFocusTarget,
}: SessionRequestRailProps) {
	const docInputRef = useRef<HTMLInputElement | null>(null);

	const sendDocMessage = () => {
		const body = docInputRef.current?.value.trim() ?? "";
		if (!body || !session.onSendRequest) return;
		void session.onSendRequest(null, body);
		if (docInputRef.current) docInputRef.current.value = "";
	};

	return (
		<div className="flex flex-col gap-2.5" data-prompt-session-rail="">
			{session.onSendRequest && (
				<div className="flex gap-1.5">
					<input
						ref={docInputRef}
						aria-label="Message the whole prompt"
						placeholder="Message the whole prompt…"
						className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-ring"
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							sendDocMessage();
						}}
					/>
				</div>
			)}
			{session.requests.length === 0 && (
				<p className="text-[12px] leading-relaxed text-muted-foreground/70">
					No requests yet. Click a node or ⌘-drag text in the prompt to ask
					for a change.
				</p>
			)}
			{session.requests.map((request) => (
				<RequestCard
					key={request.alias}
					request={request}
					session={session}
					onFocusTarget={onFocusTarget}
				/>
			))}
		</div>
	);
}

function RequestCard({
	request,
	session,
	onFocusTarget,
}: {
	request: PromptEditRequest;
	session: PromptEditSession;
	onFocusTarget?: (nodeId: string | undefined) => void;
}) {
	const replyRef = useRef<HTMLInputElement | null>(null);
	const undoReason = undoDisabledReason(session, request.alias);
	const focusNodeId =
		request.target && request.target.nodeId !== request.target.docId
			? request.target.nodeId
			: undefined;

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
				"rounded-lg border border-border bg-background px-2.5 py-2",
				request.status === "waiting" && "border-amber-500/60",
				focusNodeId && "cursor-pointer hover:border-muted-foreground/40",
			)}
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
			<div className="mb-1 flex items-center gap-1.5">
				<AliasChip alias={request.alias} author={request.author} />
				<span
					className={cn(
						"rounded-full px-2 text-[10px]",
						STATUS_CLASS[request.status],
					)}
				>
					{STATUS_LABEL[request.status]}
				</span>
				{request.status === "applied" && session.onUndo && (
					<button
						type="button"
						aria-label={`Undo ${request.alias}`}
						disabled={undoReason !== null}
						title={undoReason ?? `Undo ${request.alias}`}
						className="ml-auto rounded-md border border-border px-2 text-[10px] text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
						onClick={() => void session.onUndo?.(request.alias)}
					>
						Undo
					</button>
				)}
			</div>
			<p className="text-[12px] leading-snug text-foreground">
				{request.body}
			</p>
			{(request.thread?.length ?? 0) > 0 && (
				<div className="mt-1.5 border-l-2 border-border pl-2">
					{request.thread!.map((message, index) => (
						<p
							key={`${request.alias}:msg:${index}`}
							className="mb-1 text-[11px] leading-snug"
						>
							<span
								className={cn(
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
			{request.status === "waiting" && session.onReplyToRequest && (
				<div className="mt-1.5 flex gap-1.5">
					<input
						ref={replyRef}
						aria-label={`Reply to unblock ${request.alias}`}
						placeholder={`Reply to unblock ${request.alias}…`}
						className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-amber-500/60"
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

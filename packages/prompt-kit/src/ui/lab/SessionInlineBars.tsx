// Slice: the inline session furniture — the compact per-request action bar
// that rides above a staged diff (alias chip + summary + Reject/Accept), and
// the amber waiting-on-human thread bar with its inline reply input. Both are
// pure presentation over the PromptEditSession contract; ordering discipline
// arrives pre-computed as disabled-reasons (buttons disable with a tooltip
// reason, they never error after a click).
"use client";

import { useRef } from "react";
import {
	EDITOR_COLORS,
	EDITOR_METRICS,
} from "../surface/editor-surface";

const PANEL_BORDER = "var(--prompt-editor-panel-border, #2B2B2B)";
const PANEL_RAISE = "var(--prompt-editor-panel-raise, #232323)";

/** The R-alias chip. Agent-authored aliases (A1…) take the thread amber. */
export function AliasChip({
	alias,
	author,
}: {
	alias: string;
	author?: "you" | "agent";
}) {
	const agent = author === "agent";
	return (
		<span
			data-prompt-alias={alias}
			className="rounded border px-1 text-[10px] font-bold"
			style={{
				color: agent ? EDITOR_COLORS.threadAccent : EDITOR_COLORS.selectionAccent,
				borderColor: agent
					? "rgb(210 153 34 / 0.45)"
					: "rgb(88 166 255 / 0.4)",
			}}
		>
			{alias}
		</span>
	);
}

export interface ProposalActionBarProps {
	alias: string;
	author?: "you" | "agent";
	summary: string;
	/** Non-null disables Accept and becomes its tooltip. */
	acceptDisabledReason: string | null;
	/** Non-null disables Reject and becomes its tooltip. */
	rejectDisabledReason: string | null;
	onAccept: () => void;
	onReject: () => void;
}

export function ProposalActionBar({
	alias,
	author,
	summary,
	acceptDisabledReason,
	rejectDisabledReason,
	onAccept,
	onReject,
}: ProposalActionBarProps) {
	return (
		<div
			data-prompt-proposal-bar={alias}
			className="flex items-center gap-2.5 rounded-lg border px-2.5 py-1"
			style={{
				maxWidth: 560,
				background: PANEL_RAISE,
				borderColor: PANEL_BORDER,
				fontFamily: EDITOR_METRICS.fontFamily,
			}}
		>
			<AliasChip alias={alias} author={author} />
			<span
				className="min-w-0 flex-1 truncate text-[11px]"
				style={{ color: EDITOR_COLORS.lineNumberActive }}
			>
				{summary}
			</span>
			<button
				type="button"
				aria-label={`Reject ${alias}`}
				disabled={rejectDisabledReason !== null}
				title={rejectDisabledReason ?? `Reject ${alias}`}
				className="rounded-md border px-2 py-0.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-40"
				style={{
					borderColor: PANEL_BORDER,
					color: EDITOR_COLORS.lineNumberActive,
					background: "transparent",
				}}
				onClick={onReject}
			>
				Reject
			</button>
			<button
				type="button"
				aria-label={`Accept ${alias}`}
				disabled={acceptDisabledReason !== null}
				title={acceptDisabledReason ?? `Accept ${alias}`}
				className="rounded-md px-3 py-0.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
				style={{ background: EDITOR_COLORS.diffAddFg, color: "#06210D" }}
				onClick={onAccept}
			>
				Accept
			</button>
		</div>
	);
}

export interface InlineThreadBarProps {
	alias: string;
	author?: "you" | "agent";
	/** The question being asked — the latest agent message, or the body. */
	message: string;
	onReply: (body: string) => void;
}

/** Amber waiting-on-human bar, pinned in the file above its target. */
export function InlineThreadBar({
	alias,
	author,
	message,
	onReply,
}: InlineThreadBarProps) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const send = () => {
		const body = inputRef.current?.value.trim() ?? "";
		if (!body) return;
		onReply(body);
		if (inputRef.current) inputRef.current.value = "";
	};

	return (
		<div
			data-prompt-thread-bar={alias}
			className="flex flex-col gap-1.5 rounded-lg border py-1.5 pl-2.5 pr-2.5"
			style={{
				maxWidth: 560,
				background: PANEL_RAISE,
				borderColor: "rgb(210 153 34 / 0.45)",
				borderLeftWidth: 3,
				fontFamily: EDITOR_METRICS.fontFamily,
			}}
		>
			<div className="flex items-baseline gap-2">
				<AliasChip alias={alias} author={author} />
				<span
					className="min-w-0 flex-1 text-[12px] leading-snug"
					style={{ color: EDITOR_COLORS.fg, whiteSpace: "normal" }}
				>
					{message}
				</span>
			</div>
			<div className="flex gap-1.5">
				<input
					ref={inputRef}
					placeholder={`Reply to ${alias}…`}
					aria-label={`Reply to ${alias}`}
					className="min-w-0 flex-1 rounded-md border px-2 py-1 text-[12px] outline-none"
					style={{
						background: "var(--prompt-editor-panel-input-bg, #141414)",
						borderColor: PANEL_BORDER,
						color: EDITOR_COLORS.fg,
						fontFamily: EDITOR_METRICS.fontFamily,
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							send();
						}
						event.stopPropagation();
					}}
				/>
				<button
					type="button"
					aria-label={`Send reply to ${alias}`}
					className="rounded-md border px-2.5 py-0.5 text-[12px]"
					style={{
						borderColor: PANEL_BORDER,
						color: EDITOR_COLORS.lineNumberActive,
						background: "transparent",
					}}
					onClick={send}
				>
					Reply
				</button>
			</div>
		</div>
	);
}

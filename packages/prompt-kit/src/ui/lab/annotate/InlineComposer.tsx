// Slice: the inline annotation composer — spawns IN the document flow,
// directly above the clicked target (Cursor ⌘K feel). No scope breadcrumb,
// no target label: what you clicked is the target, and the pinned ring
// already shows it.
//
// ONE gesture (2026-08-05, run-now retired): Enter files the note into the
// queue. Node targets queue as `batch`, a document target queues as `global`
// — you say "do this, do this, do this," then Apply sends the agent through
// the whole set. Esc cancels — handled by the lab's targeting container,
// which this bubbles to.
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, X } from "lucide-react";
import {
	EDITOR_COLORS,
	EDITOR_METRICS,
} from "../../surface/editor-surface";
import { ANNOTATE_COLORS } from "./AmbientWash";
import type { PromptRequestDisposition } from "../session/prompt-edit-session";

export interface InlineComposerProps {
	/** Files the note with the disposition the gesture chose. */
	onSubmit: (body: string, disposition: PromptRequestDisposition) => void;
	onCancel: () => void;
	/**
	 * The pinned target is the document itself — only `global` is on offer,
	 * and Enter files it.
	 */
	documentTarget?: boolean;
	/** Editing an existing note: the composer opens prefilled with it. */
	initialValue?: string;
}

interface ComposerAction {
	disposition: PromptRequestDisposition;
	label: string;
	hint: string;
}

// One gesture (2026-08-05, supersedes the two-gesture model): everything
// queues. A node note keeps its pinned target (`batch` on the wire); a
// document note is `global` — one door, two targets.
const NODE_ACTIONS: ComposerAction[] = [
	{ disposition: "batch", label: "Queue", hint: "Enter" },
];

const DOCUMENT_ACTIONS: ComposerAction[] = [
	{ disposition: "global", label: "Queue", hint: "Enter" },
];

/**
 * Cursor-style tooltip: a small dark bubble ABOVE the control, instantly on
 * hover (native `title` waits ~a second and floats wherever the OS likes).
 * Label first, then the key in muted small caps — `Close esc`, `Queue ⏎`.
 * Centered over the control.
 */
function ComposerTip({
	label,
	keys,
	children,
}: {
	label: string;
	keys: string;
	children: ReactNode;
}) {
	const [show, setShow] = useState(false);
	return (
		<span
			className="relative inline-flex shrink-0"
			onMouseEnter={() => setShow(true)}
			onMouseLeave={() => setShow(false)}
		>
			{children}
			{show && (
				<span
					data-lab-composer-tip=""
					className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 flex -translate-x-1/2 items-baseline gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] shadow-lg"
					style={{
						background: "var(--prompt-editor-panel-bg, #181818)",
						borderColor: "var(--prompt-editor-panel-border, #2B2B2B)",
						color: EDITOR_COLORS.fg,
					}}
				>
					{label}
					<span
						className="text-[10px] tracking-[0.05em]"
						style={{ color: EDITOR_COLORS.lineNumber }}
					>
						{keys}
					</span>
				</span>
			)}
		</span>
	);
}

export function InlineComposer({
	onSubmit,
	onCancel,
	documentTarget = false,
	initialValue,
}: InlineComposerProps) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	// Hover state instead of a hover: class — the base color is an inline
	// style (a theme var), which a utility class cannot override.
	const [closeHover, setCloseHover] = useState(false);
	const actions = documentTarget ? DOCUMENT_ACTIONS : NODE_ACTIONS;

	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.focus();
		// Editing: caret at the end of the prefilled note, ready to append.
		const end = textarea.value.length;
		if (end > 0) textarea.setSelectionRange(end, end);
	}, []);

	const submit = (disposition: PromptRequestDisposition) => {
		const body = textareaRef.current?.value.trim() ?? "";
		if (!body) return;
		onSubmit(body, disposition);
	};

	const action = actions[0]!;

	return (
		<div
			// NOT `data-annotation-composer`: that attribute belongs to the
			// annotations package's floating popover, whose injected TARGETING_CSS
			// makes it position:absolute/360px — which would rip this composer out
			// of its in-flow insert slot and paint it over the document.
			data-lab-composer=""
			// ONE box (2026-08-05, Cursor-style): the container IS the input —
			// no inner bordered field, no footer line. × top-right cancels, the
			// circular ↑ bottom-right queues, and the hotkeys live in tooltips.
			className="rounded-lg border shadow-lg"
			style={{
				background: "var(--prompt-editor-panel-bg, #181818)",
				borderColor: "var(--prompt-editor-panel-border, #2B2B2B)",
				fontFamily: EDITOR_METRICS.fontFamily,
				fontSize: 13,
				padding: "10px 12px",
				// Left edge stays pinned to the targeting ring (the slot's job);
				// the style rail's Composer width caps how far right the box
				// reaches, never past the ring's own width.
				width: "min(var(--prompt-editor-composer-width, 640px), 100%)",
			}}
		>
			<div className="flex items-start gap-2">
				<textarea
					ref={textareaRef}
					rows={2}
					defaultValue={initialValue}
					placeholder={
						documentTarget
							? "Note about the whole document"
							: "What should change here?"
					}
					className="w-full flex-1 resize-none bg-transparent outline-none"
					style={{
						color: EDITOR_COLORS.fg,
						fontFamily: EDITOR_METRICS.fontFamily,
						fontSize: 13,
						lineHeight: 1.55,
					}}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						// Every Enter queues — modifiers included, so old ⌘Enter/⇧Enter
						// muscle memory still files instead of silently doing nothing.
						event.preventDefault();
						submit(action.disposition);
						// Escape bubbles to the targeting container, which clears the
						// pinned target (and with it this composer).
					}}
				/>
				<ComposerTip label="Close" keys="esc">
					<button
						type="button"
						aria-label="Cancel"
						className="grid h-6 w-6 shrink-0 place-items-center rounded transition-colors"
						style={{
							color: closeHover
								? EDITOR_COLORS.diffDelFg
								: EDITOR_COLORS.lineNumber,
						}}
						onMouseEnter={() => setCloseHover(true)}
						onMouseLeave={() => setCloseHover(false)}
						onClick={onCancel}
					>
						<X aria-hidden size={14} />
					</button>
				</ComposerTip>
			</div>
			<div className="mt-1.5 flex items-center justify-end">
				<ComposerTip
					label={documentTarget ? "Queue · document" : "Queue"}
					keys="⏎"
				>
					<button
						type="button"
						aria-label={action.label}
						data-annotation-composer-action={action.disposition}
						className="grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors"
						style={{
							color: ANNOTATE_COLORS.accentLit,
							background: "rgb(138 122 176 / 0.16)",
						}}
						onClick={() => submit(action.disposition)}
					>
						<ArrowUp aria-hidden size={13} />
					</button>
				</ComposerTip>
			</div>
		</div>
	);
}

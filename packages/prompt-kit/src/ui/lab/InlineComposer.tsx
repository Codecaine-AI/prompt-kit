// Slice: the inline annotation composer — spawns IN the document flow,
// directly above the clicked target (Cursor ⌘K feel). No scope breadcrumb,
// no target label: what you clicked is the target, and the pinned ring
// already shows it. ⌘⏎ submits, Esc cancels (Esc is handled by the lab's
// targeting container, which this bubbles to).
"use client";

import { useEffect, useRef } from "react";
import {
	EDITOR_COLORS,
	EDITOR_METRICS,
} from "../surface/editor-surface";

export interface InlineComposerProps {
	onSubmit: (body: string) => void;
	onCancel: () => void;
}

export function InlineComposer({ onSubmit, onCancel }: InlineComposerProps) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	const submit = () => {
		const body = textareaRef.current?.value.trim() ?? "";
		if (!body) return;
		onSubmit(body);
	};

	return (
		<div
			data-annotation-composer=""
			className="rounded-lg border shadow-lg"
			style={{
				maxWidth: 560,
				background: "var(--prompt-editor-panel-bg, #181818)",
				borderColor: "var(--prompt-editor-panel-border, #2B2B2B)",
				fontFamily: EDITOR_METRICS.fontFamily,
				fontSize: EDITOR_METRICS.fontSize,
				padding: 10,
			}}
		>
			<textarea
				ref={textareaRef}
				placeholder="What should the agent do here?"
				className="w-full resize-y rounded-md border px-2 py-1.5 outline-none"
				style={{
					minHeight: 58,
					background: "var(--prompt-editor-panel-input-bg, #141414)",
					borderColor: "var(--prompt-editor-panel-border, #2B2B2B)",
					color: EDITOR_COLORS.fg,
					fontFamily: EDITOR_METRICS.fontFamily,
					fontSize: EDITOR_METRICS.fontSize,
				}}
				onKeyDown={(event) => {
					if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
						event.preventDefault();
						submit();
					}
					// Escape bubbles to the targeting container, which clears the
					// pinned target (and with it this composer).
				}}
			/>
			<div className="mt-2 flex items-center gap-2">
				<span
					className="flex-1 text-[10px]"
					style={{ color: EDITOR_COLORS.lineNumber }}
				>
					⌘⏎ to submit · esc to cancel
				</span>
				<button
					type="button"
					aria-label="Cancel"
					className="rounded-md border px-2.5 py-1 text-[12px]"
					style={{
						borderColor: "var(--prompt-editor-panel-border, #2B2B2B)",
						color: EDITOR_COLORS.lineNumberActive,
						background: "transparent",
					}}
					onClick={onCancel}
				>
					Cancel
				</button>
				<button
					type="button"
					className="rounded-md px-3 py-1 text-[12px] font-semibold"
					style={{
						background: EDITOR_COLORS.selectionAccent,
						color: "#0B1826",
					}}
					onClick={submit}
				>
					Annotate
				</button>
			</div>
		</div>
	);
}

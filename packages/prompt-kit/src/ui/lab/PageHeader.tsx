// THE NOTION PAGE HEADER (2026-08-04 redesign, second pass): the agent IS
// the document, so its identity renders where the page begins — the name as
// a large title, the description underneath as muted, collapsible text that
// edits IN PLACE (the editor is styled exactly like the display text, so
// entering edit changes nothing but the caret). No model chip — the title
// row is the name alone (Ford: "this should just be the agent name").
// Saves route through the same manifest-save path the old AGENT zone used.
"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { EDITOR_METRICS } from "../surface/editor-surface";

/** Collapsed state persists — a hidden description should stay hidden. */
const DESCRIPTION_COLLAPSED_KEY = "promptLab.pageHeader.descriptionCollapsed.v1";

function readCollapsed(): boolean {
	try {
		return (
			typeof window !== "undefined" &&
			window.localStorage.getItem(DESCRIPTION_COLLAPSED_KEY) === "1"
		);
	} catch {
		return false;
	}
}

export interface PromptPageHeaderProps {
	name: string;
	description: string;
	/** When false the description is display-only. */
	editable: boolean;
	error?: string;
	onSaveDescription: (description: string) => void;
}

export function PromptPageHeader({
	name,
	description,
	editable,
	error,
	onSaveDescription,
}: PromptPageHeaderProps) {
	const [collapsed, setCollapsed] = useState(readCollapsed);
	// In-place description editing: click → the same text becomes a caret.
	const [editingDescription, setEditingDescription] = useState(false);
	const [descriptionDraft, setDescriptionDraft] = useState(description);
	const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

	// Seamless inline editor: the textarea auto-grows to its content so it
	// never scrolls or shows a box — visually identical to the display text.
	useLayoutEffect(() => {
		const element = descriptionRef.current;
		if (!element) return;
		element.style.height = "0px";
		element.style.height = `${element.scrollHeight}px`;
	}, [editingDescription, descriptionDraft]);

	const toggleCollapsed = () => {
		setCollapsed((current) => {
			const next = !current;
			try {
				window.localStorage.setItem(
					DESCRIPTION_COLLAPSED_KEY,
					next ? "1" : "0",
				);
			} catch {
				// Storage may be unavailable (private mode); session state holds.
			}
			return next;
		});
	};

	const commitDescription = () => {
		setEditingDescription(false);
		if (descriptionDraft !== description) onSaveDescription(descriptionDraft);
	};

	return (
		<div data-lab-page-header="" className="flex min-w-0 flex-col gap-1">
			<div className="flex min-w-0 items-baseline gap-2.5">
				<h1
					data-lab-page-title=""
					className="min-w-0 truncate text-[24px] font-semibold leading-tight text-foreground"
					style={{ fontFamily: EDITOR_METRICS.fontFamily }}
				>
					{name}
				</h1>
				<button
					type="button"
					data-lab-page-description-toggle=""
					aria-label={collapsed ? "Expand description" : "Collapse description"}
					aria-expanded={!collapsed}
					onClick={toggleCollapsed}
					className="shrink-0 text-[10px] text-muted-foreground/50 transition-colors hover:text-foreground"
				>
					{collapsed ? "▸" : "▾"}
				</button>
			</div>

			{!collapsed &&
				(editingDescription ? (
					<textarea
						// eslint-disable-next-line jsx-a11y/no-autofocus
						autoFocus
						ref={descriptionRef}
						data-lab-page-description-input=""
						aria-label="Agent description"
						value={descriptionDraft}
						rows={1}
						spellCheck={false}
						onChange={(event) => setDescriptionDraft(event.target.value)}
						onBlur={commitDescription}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								commitDescription();
							}
							if (event.key === "Escape") {
								event.stopPropagation();
								setEditingDescription(false);
							}
						}}
						// Styled as the display text: transparent, borderless,
						// auto-grown — editing is a caret, not a form control.
						className="w-full max-w-[64ch] resize-none overflow-hidden bg-transparent p-0 text-[12px] leading-relaxed text-muted-foreground/70 caret-current outline-none"
					/>
				) : (
					<p
						data-lab-page-description=""
						title={editable ? "Click to edit description" : undefined}
						onClick={() => {
							if (!editable) return;
							setDescriptionDraft(description);
							setEditingDescription(true);
						}}
						className={
							"max-w-[64ch] text-[12px] leading-relaxed text-muted-foreground/70" +
							(editable ? " cursor-text" : "")
						}
					>
						{description || (editable ? "Add a description…" : "")}
					</p>
				))}

			{error && <p className="text-[11px] text-destructive">{error}</p>}
		</div>
	);
}

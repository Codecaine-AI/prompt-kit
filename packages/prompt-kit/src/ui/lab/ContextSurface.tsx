// Read-only CONTEXT surface: the assembled context preview rendered on the
// shared editor surface (same gutter, grid, zebra tokens, and opportunistic
// XML highlighting as the prompt views) via PromptView. Read-only means no
// hover/insert/drag affordances — native selection/copy only, and the
// rendered text stays byte-exact. The context token count surfaces in the lab
// statusbar, not here.
//
// It carries the same wayfinding column as the SYSTEM view: the outline is a
// map of the document, not an editing affordance, so a read-only surface
// wants it just as much. Entries are recovered from the rendered string (no
// document model here) and click scrolls the buffer — nothing writes.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
	LINE_HEIGHT_PX,
} from "../surface/editor-surface";
import {
	SectionOutline,
	type OutlineSection,
} from "../prompt-flow/PromptFlowXml/SectionOutline";
import { PromptView } from "../view/PromptView";
import { contextOutlineSections } from "./context-outline";

export interface LabContextPreview {
	renderedContext?: string | null;
	inputs?: Array<{ loaderKind: string; inputRef: string; status: string; bytes: number }>;
	modulePath?: string | null;
}

export function ContextSurface({
	context,
	showOutline = true,
}: {
	context?: LabContextPreview;
	/** Geometric guard from the host: below the lab's breakpoint, no column. */
	showOutline?: boolean;
}) {
	const rendered = context?.renderedContext ?? "";
	const hasContent = rendered.trim().length > 0;

	// One entry per top-level open tag plus its depth-1 children, names only —
	// the same rule (and the same column) the SYSTEM view uses.
	const sections = useMemo<OutlineSection[]>(
		() => (hasContent ? contextOutlineSections(rendered) : []),
		[rendered, hasContent],
	);
	const outlineShown = showOutline && sections.length > 0;

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [activeRow, setActiveRow] = useState<number | null>(null);

	// Rows are addressed by their line index: PromptView stamps each row with
	// `data-prompt-row`, which is the only anchor this surface needs.
	const rowElement = useCallback((row: number): HTMLElement | null => {
		return (
			scrollRef.current?.querySelector<HTMLElement>(
				`[data-prompt-row="${row}"]`,
			) ?? null
		);
	}, []);

	// Scroll tracking mirrors the editor's: the active entry is the last
	// section whose open tag sits at or above the top of the viewport (a
	// two-line grace), snapping to the last section at the bottom of the
	// scroller. Rects, not offsets — rows live inside PromptView's own
	// positioned wrapper.
	const updateActiveSection = useCallback(() => {
		const scroller = scrollRef.current;
		if (!scroller || sections.length === 0) {
			setActiveRow(null);
			return;
		}
		const threshold =
			scroller.getBoundingClientRect().top + LINE_HEIGHT_PX * 2;
		let active = sections[0]!.row;
		for (const section of sections) {
			const element = rowElement(section.row);
			if (element && element.getBoundingClientRect().top <= threshold) {
				active = section.row;
			}
		}
		if (
			scroller.scrollHeight > scroller.clientHeight &&
			scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
		) {
			active = sections[sections.length - 1]!.row;
		}
		setActiveRow(active);
	}, [sections, rowElement]);

	useEffect(() => {
		if (outlineShown) updateActiveSection();
		else setActiveRow(null);
	}, [outlineShown, updateActiveSection]);

	const scrollToSection = useCallback(
		(section: OutlineSection) => {
			const scroller = scrollRef.current;
			const element = rowElement(section.row);
			// Clicking is the selection here — mark it immediately rather than
			// waiting on a smooth scroll to settle.
			setActiveRow(section.row);
			if (!scroller || !element) return;
			// Land the open tag one line below the top edge, the same breathing
			// the buffer's first line gets from its top padding.
			const top =
				element.getBoundingClientRect().top -
				scroller.getBoundingClientRect().top +
				scroller.scrollTop -
				LINE_HEIGHT_PX;
			if (typeof scroller.scrollTo === "function") {
				scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
			} else {
				element.scrollIntoView?.({ block: "start", behavior: "smooth" });
			}
		},
		[rowElement],
	);

	return (
		<div
			className="flex h-full min-h-0 min-w-0 flex-1 flex-col font-mono"
			style={{ background: EDITOR_COLORS.bg }}
		>
			{hasContent ? (
				<div className="flex min-h-0 min-w-0 flex-1">
					<div
						ref={scrollRef}
						data-context-scroll="context"
						className="min-h-0 min-w-0 flex-1 overflow-auto"
						onScroll={outlineShown ? updateActiveSection : undefined}
						style={
							// Alongside the column the buffer stops at the content width,
							// so the outline hugs the text instead of stranding canvas.
							outlineShown
								? { maxWidth: EDITOR_METRICS.contentWidth }
								: undefined
						}
					>
						{/* Same breathing room the editor gives line 1 / the last line. */}
						<div style={{ paddingBlock: EDITOR_METRICS.lineHeight }}>
							<PromptView content={rendered} title="Context" bare inheritStyle />
						</div>
					</div>
					{outlineShown && (
						<SectionOutline
							sections={sections}
							activeRow={activeRow}
							onSelect={scrollToSection}
						/>
					)}
				</div>
			) : (
				<div className="flex min-h-0 flex-1 items-center justify-center p-6">
					<p className="max-w-64 text-center text-[12px] leading-relaxed text-muted-foreground/70">
						{context?.modulePath
							? "The context preview could not be assembled for this agent."
							: "This agent has no context module."}
					</p>
				</div>
			)}
		</div>
	);
}

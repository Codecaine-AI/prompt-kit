// Slice: quiet wayfinding column — one row per top-level section (and one
// indented row per depth-1 container inside it), names only: the column is a
// map of the document, and numeric/sparkline chrome pulled it toward being a
// chart. The active row tracks scroll position; click scrolls the editor to
// the section. Derived from the shared line model — purely presentational,
// never touches rendered text, hashes, or saves.
//
// The column is a margin of the document, not a pane rail: it shares the
// editor's background, type, and line grid, so a row occupies exactly one
// editor line and the first row sits on the buffer's first line. Nothing in
// it draws a border; spacing and the shared hairline do the separation.
"use client";

import cn from "classnames";
import type { CSSProperties } from "react";

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
} from "../../surface/editor-surface";
import type { XmlLine } from "../xml-line-model";

export interface OutlineSection {
	/** Row index (in the line model) of the section's opening tag. */
	row: number;
	/** Owning node id — stable identity for keys across edits. */
	nodeId: string;
	/** The section's `name` attribute when present, else its bare tag name. */
	label: string;
	/** Nesting depth of the open tag: 0 = landmark, 1 = indented child. */
	depth: number;
}

/** One editor line per row, never below a comfortable pointer target. */
const ROW_HEIGHT = `max(22px, ${EDITOR_METRICS.lineHeight})`;

/**
 * Wayfinding label for one open-tag line. A tag like `<phase name="plan">`
 * is named by its `name` attribute — five phases all labeled "phase" is no
 * map — falling back to the bare tag; non-section containers (example,
 * context usage) read the leading word out of their rendered tag text.
 */
export function outlineSectionLabel(line: XmlLine): string {
	const node = line.node;
	if (node.type === "section") {
		const name = node.attrs?.name;
		if (name !== null && name !== undefined) {
			const text = String(name).trim();
			if (text.length > 0) return text;
		}
		return node.tag;
	}
	return (
		line.text
			.trim()
			.replace(/^<\/?/, "")
			.replace(/\/?>$/, "")
			.split(/\s+/)[0] ?? ""
	);
}

export function SectionOutline({
	sections,
	activeRow,
	onSelect,
}: {
	sections: OutlineSection[];
	/** Row index of the section currently at the top of the viewport. */
	activeRow: number | null;
	onSelect: (section: OutlineSection) => void;
}) {
	return (
		<nav
			aria-label="Prompt sections"
			className="flex w-48 shrink-0 flex-col overflow-y-auto overscroll-contain pb-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5 hover:[&::-webkit-scrollbar-thumb]:bg-white/15"
			style={
				{
					background: EDITOR_COLORS.bg,
					borderLeft: `1px solid ${EDITOR_COLORS.guide}`,
					// Matches the buffer's top padding, so outline row 1 and editor
					// line 1 share a band.
					paddingTop: EDITOR_METRICS.lineHeight,
					fontFamily: EDITOR_METRICS.fontFamily,
					// Published as a variable because the wash is applied by a
					// Tailwind hover/focus utility on the rows below.
					"--prompt-outline-hover": EDITOR_COLORS.hoverBg,
				} as CSSProperties
			}
			onClick={(event) => event.stopPropagation()}
		>
			{sections.map((section) => {
				const active = section.row === activeRow;
				return (
					<button
						key={`${section.nodeId}:${section.row}`}
						type="button"
						onClick={() => onSelect(section)}
						aria-current={active ? "location" : undefined}
						className={cn(
							"relative flex shrink-0 items-center gap-2 pr-3 text-left text-[11px] leading-none transition-colors",
							"hover:bg-[var(--prompt-outline-hover)] focus-visible:bg-[var(--prompt-outline-hover)] focus-visible:outline-none",
							section.depth > 0 ? "pl-6" : "pl-3",
							active
								? "text-foreground"
								: "text-muted-foreground/70 hover:text-foreground",
						)}
						style={{ height: ROW_HEIGHT }}
						title={`<${section.label}>`}
					>
						{active && (
							// Sits ON the column's hairline rather than beside it: the
							// rule turns accent for this row instead of doubling.
							<span
								aria-hidden
								className="absolute inset-y-0 -left-px w-[2px]"
								style={{ background: EDITOR_COLORS.selectionAccent }}
							/>
						)}
						<span className="min-w-0 flex-initial truncate">
							{section.label}
						</span>
					</button>
				);
			})}
		</nav>
	);
}

// Slice: inline staged-diff presentation — red deletion rows, green addition
// rows, and the in-flow slot that hosts a per-request action bar or widget.
// Purely presentational: WHAT is staged (and what the bar's buttons do) is
// the host's business; this module only keeps the rows on the surface grid.
"use client";

import type { ReactNode } from "react";
import { EDITOR_COLORS, EDITOR_METRICS } from "../../surface/editor-surface";

/**
 * A staged change rendered IN PLACE: the rows `[rowStart, rowEnd]` of the
 * line model are replaced by `delLines` (old text, red) followed by
 * `addLines` (new text, green), with `bar` — typically the per-request
 * action bar — rendered in flow above them. Replacing the rows is also the
 * edit-collision guard: a block with a pending proposal has no editable rows
 * on screen until the proposal is accepted or rejected.
 */
export interface PromptFlowStagedRegion {
	key: string;
	/** Inclusive row range (line-model indices) this region replaces. */
	rowStart: number;
	rowEnd: number;
	delLines: string[];
	addLines: string[];
	bar?: ReactNode;
}

/** An element inserted into the document flow ABOVE a row (composer, thread
 * bar) — content below it is pushed down, Cursor-⌘K style. */
export interface PromptFlowInlineInsert {
	key: string;
	/** Line-model row index the element renders immediately above. */
	row: number;
	element: ReactNode;
}

/** In-flow wrapper aligning an inserted widget with the content column. */
export function InlineInsertSlot({
	insert,
	gutterWidth,
}: {
	insert: PromptFlowInlineInsert;
	gutterWidth: string;
}) {
	return (
		<div
			// The data-annotation-ui stamp keeps annotate-mode targeting (and the
			// lab's capture-phase click hijack) away from the widget's controls.
			data-annotation-ui="inline-insert"
			data-prompt-inline-insert={insert.key}
			style={{
				paddingLeft: `calc(${gutterWidth} + 0.75rem)`,
				paddingRight: "1rem",
				marginBlock: "4px",
			}}
		>
			{insert.element}
		</div>
	);
}

export function StagedRegionView({
	region,
	gutterWidth,
}: {
	region: PromptFlowStagedRegion;
	gutterWidth: string;
}) {
	return (
		<div data-prompt-staged-region={region.key}>
			{region.bar !== undefined && (
				<div
					data-annotation-ui="inline-insert"
					data-prompt-staged-bar={region.key}
					style={{
						paddingLeft: `calc(${gutterWidth} + 0.75rem)`,
						paddingRight: "1rem",
						marginBlock: "4px",
					}}
				>
					{region.bar}
				</div>
			)}
			{region.delLines.map((text, index) => (
				<DiffRow
					key={`del:${index}`}
					kind="del"
					text={text}
					gutterWidth={gutterWidth}
				/>
			))}
			{region.addLines.map((text, index) => (
				<DiffRow
					key={`add:${index}`}
					kind="add"
					text={text}
					gutterWidth={gutterWidth}
				/>
			))}
		</div>
	);
}

/**
 * One diff row on the strict surface grid: same gutter column, same body
 * padding, monospace text shown verbatim (leading indent included via
 * pre-wrap). Deliberately static — no node stamps, no hover affordances —
 * so neither editing nor annotate targeting can grab a staged line.
 */
function DiffRow({
	kind,
	text,
	gutterWidth,
}: {
	kind: "del" | "add";
	text: string;
	gutterWidth: string;
}) {
	const del = kind === "del";
	return (
		<div
			data-prompt-diff-row={kind}
			className="flex items-stretch"
			style={{
				minHeight: EDITOR_METRICS.lineHeight,
				background: del ? EDITOR_COLORS.diffDelBg : EDITOR_COLORS.diffAddBg,
			}}
		>
			<div
				className="sticky left-0 flex shrink-0 select-none items-start justify-end pr-3 text-right"
				style={{
					minWidth: gutterWidth,
					color: del ? EDITOR_COLORS.diffDelFg : EDITOR_COLORS.diffAddFg,
				}}
			>
				{del ? "−" : "+"}
			</div>
			<div
				className="min-w-0 flex-1 whitespace-pre-wrap pl-3 pr-4"
				style={{
					color: del ? EDITOR_COLORS.lineNumberActive : EDITOR_COLORS.fg,
				}}
			>
				{text.length > 0 ? text : " "}
			</div>
		</div>
	);
}

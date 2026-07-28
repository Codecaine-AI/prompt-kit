// Slice: one buffer row — gutter, hover/selection washes, affordance mounts,
// and the body column that dispatches to gap / item / inline-editor / text.
"use client";

import { X } from "lucide-react";
import type { PromptDocument } from "../../../index";
import type {
	PromptBlockNodeType,
	PromptEditorTreeEntry,
} from "../../editors";

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
	promptEditorIndentForSpaces,
	promptEditorZebraBackground,
} from "../../surface/editor-surface";
import type { PromptFlowViewProps } from "../types";
import type { XmlLine } from "../xml-line-model";
import { BlockCluster } from "./BlockCluster";
import type { EditorAriaAttributes } from "./GrowTextArea";
import { InlineEditor, RowText } from "./InlineEditor";
import { ItemRow } from "./ItemRow";
import { SectionTagRow } from "./SectionTagRow";

// Hanging indent: continuation lines of a wrapped row align under the line's
// content start. paddingLeft holds the leading whitespace; text-indent pulls
// the first line back to flush.
function leadingIndent(text: string): number {
	const match = text.match(/^ */);
	return match ? match[0].length : 0;
}

export interface XmlRowProps {
	line: XmlLine;
	lineNumber: number;
	gutterWidth: string;
	entry: PromptEditorTreeEntry | undefined;
	selected: boolean;
	inHighlight: boolean;
	isSelectionStart: boolean;
	isSelectionEnd: boolean;
	isRangeStart: boolean;
	isRangeEnd: boolean;
	isLandmark: boolean;
	dragging: boolean;
	flashing: boolean;
	editing: boolean;
	/** Caret to place on the editor's mount when this row owns the edit. */
	editCaret?: number | "end" | readonly [number, number];
	/** Bumped on every edit-target move so the editor remounts and re-seats. */
	editSeq: number;
	menuOpen: boolean;
	affordanceVisible: boolean;
	itemHovered: boolean;
	/** Whether this row's block can take children (drives the menu's Add child). */
	canInsertChild: boolean;
	prompt: PromptDocument;
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	onHoverNode: () => void;
	onHoverGap: () => void;
	onSelect: () => void;
	/** Enters edit mode with the caret at the clicked character. */
	onStartEdit: (caret: number | "end") => void;
	onEndEdit: () => void;
	onEditorKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	/** Every keystroke's resulting text, for the surface to interpret. */
	onEditorChange: (next: string, element: HTMLTextAreaElement) => void;
	/** Combobox wiring while the surface has the slash menu open on this row. */
	editorAria?: EditorAriaAttributes;
	onToggleMenu: () => void;
	onCloseMenu: () => void;
	onInsertChild: (type: PromptBlockNodeType) => void;
	onDuplicate: () => void;
	onRetag: (tag: string) => void;
	onRemove: () => void;
	onRemoveItem: () => void;
	onDragHandleDown: (event: React.PointerEvent<HTMLElement>) => void;
}

export function XmlRow({
	line,
	lineNumber,
	gutterWidth,
	entry,
	selected,
	inHighlight,
	isSelectionStart,
	isSelectionEnd,
	isRangeStart,
	isRangeEnd,
	isLandmark,
	dragging,
	flashing,
	editing,
	editCaret,
	editSeq,
	menuOpen,
	affordanceVisible,
	itemHovered,
	canInsertChild,
	prompt,
	onPromptChange,
	onHoverNode,
	onHoverGap,
	onSelect,
	onStartEdit,
	onEndEdit,
	onEditorKeyDown,
	onEditorChange,
	editorAria,
	onToggleMenu,
	onCloseMenu,
	onInsertChild,
	onDuplicate,
	onRetag,
	onRemove,
	onRemoveItem,
	onDragHandleDown,
}: XmlRowProps) {
	const isGap = line.role === "gap";
	const isItem = line.role === "item";
	// A section's open tag renders as editable trim + name (see SectionTagRow).
	const isSectionTag =
		line.role === "open" && line.node.type === "section" && line.editable;
	// Hanging indent: continuation lines of a wrapped row align under the
	// line's content start rather than flush-left. paddingLeft holds the
	// leading whitespace; text-indent pulls the first line back to flush.
	const indentCh = leadingIndent(line.text);
	const indentWidth = promptEditorIndentForSpaces(indentCh);

	// Strict grid: every row is EXACTLY one line-height, except where content
	// genuinely wraps — then it grows in whole line-height steps via min-height
	// (VS Code word-wrap idiom). Nothing else may add height to a row.
	const rowGridStyle = { minHeight: EDITOR_METRICS.lineHeight };
	const clusterVisible =
		!isGap && isRangeStart && entry !== undefined && affordanceVisible;

	return (
		<div
			data-row-index={lineNumber - 1}
			className="group relative flex items-stretch transition-opacity"
			style={{
				...rowGridStyle,
				background: promptEditorZebraBackground(lineNumber - 1),
				opacity: dragging
					? "var(--prompt-editor-drag-opacity, 0.3)"
					: undefined,
			}}
			onMouseEnter={isGap ? onHoverGap : onHoverNode}
		>
			{/* Landmark tint: a very faint full-width wash marking a top-level
			    section's opening line so section starts scan as landmarks. */}
			{isLandmark && (
				<div
					className="pointer-events-none absolute inset-0 z-0"
					style={{
						background: EDITOR_COLORS.landmark,
						opacity: "var(--prompt-editor-show-landmarks, 1)",
					}}
				/>
			)}

			{/* Range wash keeps hover quiet and gives selection the stronger
			    configured accent wash. */}
			{(inHighlight || flashing || selected) && (
				<div
					className="pointer-events-none absolute inset-0 z-0 transition-colors"
					style={{
						background:
							flashing || selected
								? EDITOR_COLORS.selectionBg
								: EDITOR_COLORS.hoverBg,
					}}
				/>
			)}
			{/* Selection keeps a full-opacity accent bar; hover uses only its
			    background wash. */}
			{selected && (
				<div
					className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-[2px]"
					style={{
						background: EDITOR_COLORS.selectionAccent,
						opacity: 1,
						borderTopLeftRadius: isSelectionStart ? 1 : 0,
						borderBottomLeftRadius: isSelectionEnd ? 1 : 0,
					}}
				/>
			)}

			{/* Gutter: fixed-width, right-aligned number. Its transparent resting
			    state lets row shading span the full width. Block affordances live
			    in one cluster (see BlockCluster) anchored at the gutter's right
			    edge, so hover/selection controls are in a single spot. */}
			<div
				className="sticky left-0 z-10 flex shrink-0 select-none items-start justify-end pr-3 text-right tabular-nums"
				style={{
					minWidth: gutterWidth,
					background: selected
						? EDITOR_COLORS.activeLineBg
						: "transparent",
				}}
			>
				<span
					style={{
						color: selected
							? EDITOR_COLORS.lineNumberActive
							: EDITOR_COLORS.lineNumber,
						visibility: clusterVisible
							? "hidden"
							: ("var(--prompt-editor-line-number-visibility, visible)" as React.CSSProperties["visibility"]),
						display:
							"var(--prompt-editor-line-numbers-display, block)",
					}}
				>
					{lineNumber}
				</span>
			</div>

			{/* ONE affordance, Notion-style, pinned at the block's first line just
			    inside the gutter: [⋮⋮] drag + block menu. Visible on block hover OR
			    while selected. */}
			{!isGap && isRangeStart && entry && (
				<BlockCluster
					node={line.node}
					gutterWidth={gutterWidth}
					visible={affordanceVisible}
					menuOpen={menuOpen}
					canInsertChild={canInsertChild}
					onToggleMenu={onToggleMenu}
					onCloseMenu={onCloseMenu}
					onDuplicate={onDuplicate}
					onRetag={onRetag}
					onRemove={onRemove}
					onInsertChild={onInsertChild}
					onDragHandleDown={onDragHandleDown}
				/>
			)}

			{/* Body column. Hanging-indent via padding-left + negative text-indent. */}
			<div
				className="relative z-0 min-w-0 flex-1 pr-4 pl-3"
				style={
					isGap
						? undefined
						: {
								paddingLeft: `calc(0.75rem + ${indentWidth})`,
								textIndent: `calc(0px - ${indentWidth})`,
							}
				}
				onClick={(event) => {
					// The column's own padding is "past the end of the line": clicking
					// it should still put the caret in this row rather than fall
					// through to the surface and clear the selection. Only bare hits
					// on the column itself count — text, editor and buttons handle
					// their own clicks.
					if (event.target !== event.currentTarget) return;
					if (isGap || editing) return;
					event.stopPropagation();
					if (line.editable) onStartEdit("end");
					else onSelect();
				}}
			>
				{isGap ? (
					<GapRow />
				) : isSectionTag && entry ? (
					<SectionTagRow
						line={line}
						entry={entry}
						editing={editing}
						editCaret={editCaret}
						editSeq={editSeq}
						prompt={prompt}
						onPromptChange={onPromptChange}
						onStartEdit={onStartEdit}
						onEndEdit={onEndEdit}
						onEditorKeyDown={onEditorKeyDown}
						onEditorChange={onEditorChange}
					/>
				) : isItem && entry ? (
					// List items always render their "1." / "-" marker as a fixed,
					// non-editable prefix; only the content area toggles between
					// display and inline editing, so the marker never disappears
					// during editing and the layout never shifts.
					<ItemRow
						line={line}
						entry={entry}
						editing={editing}
						editCaret={editCaret}
						editSeq={editSeq}
						prompt={prompt}
						onPromptChange={onPromptChange}
						onStartEdit={onStartEdit}
						onEndEdit={onEndEdit}
						onEditorKeyDown={onEditorKeyDown}
						onEditorChange={onEditorChange}
					/>
				) : editing && entry ? (
					<InlineEditor
						key={`edit:${editSeq}`}
						line={line}
						entry={entry}
						prompt={prompt}
						initialCaret={editCaret}
						onPromptChange={onPromptChange}
						onEndEdit={onEndEdit}
						onEditorKeyDown={onEditorKeyDown}
						onEditorChange={onEditorChange}
						editorAria={editorAria}
					/>
				) : (
					<RowText
						line={line}
						editable={line.editable}
						onSelect={onSelect}
						onStartEdit={onStartEdit}
					/>
				)}
			</div>

			{/* Per-item affordance: a minimal × at the item row's right margin,
			    shown only while hovering that item, removing exactly that item. */}
			{isItem && (itemHovered || (editing && isItem)) && (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onRemoveItem();
					}}
					title="Remove item"
					aria-label="Remove list item"
					className="absolute right-2 top-0 z-10 flex h-4 w-4 items-center justify-center rounded-[2px] text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
					style={{
						marginTop: `calc((${EDITOR_METRICS.lineHeight} - 1rem) / 2)`,
					}}
				>
					<X size={11} />
				</button>
			)}
		</div>
	);
}

/**
 * The blank separator row the renderer emits between sibling blocks. It carries
 * NO interactive UI: blocks are created by typing, and a hover pill plus a
 * hairline on every seam made the surface twitch. The row still exists and
 * still occupies exactly one line-height — it is real rendered text (Raw shows
 * the same blank line), it keeps the line-number grid honest, and drag reads
 * boundary positions from row rects that this row's height determines.
 */
function GapRow() {
	return <div style={{ height: EDITOR_METRICS.lineHeight }} />;
}

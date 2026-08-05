// Slice: one buffer row — gutter, hover/selection washes, affordance mounts,
// and the body column that dispatches to gap / item / inline-editor / text.
"use client";

import cn from "classnames";
import { GripVertical } from "lucide-react";
import type { PromptBlockNode, PromptDocument } from "../../../index";
import type {
	PromptBlockNodeType,
	PromptEditorTreeEntry,
} from "../../editors";

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
	promptEditorIndentForSpaces,
} from "../../surface/editor-surface";
import type { PromptFlowViewProps } from "../types";
import { lineRendersDecodedEntities, type XmlLine } from "../xml-line-model";
import { BlockCluster } from "./BlockCluster";
import { dragHandleRailWidth } from "./drag-handle";
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
	/**
	 * The row sits inside the active STRUCTURAL selection (marquee zone /
	 * Cmd+click unit / shift-click item run). The zone paints as ONE object —
	 * a single ring overlay drawn by the surface — so this row suppresses its
	 * own per-row washes (selection wash, accent bar, hover wash, gutter tint)
	 * and shows the grab cursor: the body of the zone is draggable.
	 */
	inStructuralSelection: boolean;
	inHighlight: boolean;
	isSelectionStart: boolean;
	isSelectionEnd: boolean;
	isLandmark: boolean;
	dragging: boolean;
	flashing: boolean;
	editing: boolean;
	/** Caret to place on the editor's mount when this row owns the edit. */
	editCaret?: number | "end" | readonly [number, number];
	/** Bumped on every edit-target move so the editor remounts and re-seats. */
	editSeq: number;
	menuOpen: boolean;
	/**
	 * The ONE drag handle, when THIS row anchors the currently resolved unit
	 * (see resolveDragHandleUnit in drag-handle.ts — at most one row in the
	 * whole surface receives this per render). Block-kind mounts the grip+menu
	 * cluster; item-kind mounts the drag-only item grip. `indentCh` is the
	 * anchor row's leading indent, driving the handle's x.
	 */
	handle?: { kind: "block" | "item"; indentCh: number };
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
	onDragHandleDown: (event: React.PointerEvent<HTMLElement>) => void;
	/** Item anchor rows: pointer-down on the item handle starts an item drag. */
	onItemHandleDown?: (event: React.PointerEvent<HTMLElement>) => void;
	/**
	 * Item rows: shift-click extends the item-range selection from the current
	 * anchor item (see index.tsx itemSelection). Captured BEFORE the text /
	 * marker click handlers so a shift-click never opens an editor.
	 */
	onItemShiftClick?: () => void;
}

export function XmlRow({
	line,
	lineNumber,
	gutterWidth,
	entry,
	selected,
	inStructuralSelection,
	inHighlight,
	isSelectionStart,
	isSelectionEnd,
	isLandmark,
	dragging,
	flashing,
	editing,
	editCaret,
	editSeq,
	menuOpen,
	handle,
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
	onDragHandleDown,
	onItemHandleDown,
	onItemShiftClick,
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

	// Role-aware ink, applied as CSS-variable overrides on the row container so
	// BOTH open-tag render paths (SectionTagRow trim and the shared highlighter)
	// pick it up without touching row text: top-level opens take the clearest
	// landmark purple, depth-1 opens a step down, and each closing tag mirrors
	// its opener's tier color so a section's start and end read as one pair.
	const roleInk = roleInkOverrides(line);
	// Landmark rows set their type a hair larger. The line-height variable is
	// pixel-valued, so row minHeight and every line box stay on the grid.
	const isTopLandmarkOpen = line.role === "open" && line.depth === 0;

	// Strict grid: every row is EXACTLY one line-height, except where content
	// genuinely wraps — then it grows in whole line-height steps via min-height
	// (VS Code word-wrap idiom) — gap rows, whose height grades with the tier
	// of the block they precede (see gapHeightForLine) — and top-level landmark
	// rows, whose band padding grows the row symmetrically. Overlays read
	// measured row offsets (useRowMetrics), so both exceptions stay aligned.
	const rowGridStyle = {
		minHeight: isGap ? gapHeightForLine(line) : EDITOR_METRICS.lineHeight,
		...(isTopLandmarkOpen
			? { paddingBlock: EDITOR_METRICS.landmarkPad }
			: null),
	};
	// A mounted handle covers the (hidden-by-default) line number's space.
	const handleHere = !isGap && handle !== undefined;

	return (
		<div
			data-row-index={lineNumber - 1}
			// Node/role stamps let overlay layers (annotation targeting) resolve a
			// row's owning node straight from the DOM. Gap rows carry no node id —
			// the blank separator belongs to no node visually. Item rows stamp the
			// ITEM's own id (bullets are targets in their own right); the parent
			// stamp names the enclosing block (the list for an item, the section
			// for a nested block) so Alt-hover can expand to it.
			data-prompt-node-id={isGap ? undefined : (line.itemId ?? line.nodeId)}
			data-prompt-parent-node-id={isGap ? undefined : line.parentNodeId}
			data-prompt-row-role={line.role}
			// Machine-readable selection stamp: the painted washes are style-only,
			// so tests (and any overlay) read membership from this attribute.
			data-prompt-row-selected={selected ? "" : undefined}
			className={cn(
				"group relative flex items-stretch transition-opacity",
				// The zone invites dragging: grab at rest, grabbing while its
				// run is lifted. The arbitrary variant outranks the content's
				// own cursor-text, so the affordance covers the text too.
				inStructuralSelection &&
					(dragging
						? "cursor-grabbing [&_.cursor-text]:cursor-grabbing"
						: "cursor-grab [&_.cursor-text]:cursor-grab"),
			)}
			style={{
				...rowGridStyle,
				...roleInk,
				opacity: dragging
					? "var(--prompt-editor-drag-opacity, 0.3)"
					: undefined,
			}}
			onMouseEnter={isGap ? onHoverGap : onHoverNode}
			// Capture-phase so a shift-click on an item row NEVER reaches the
			// text / marker click handlers (which would open an editor): range
			// selection and caret placement are mutually exclusive gestures.
			onClickCapture={
				isItem && onItemShiftClick
					? (event) => {
							if (!event.shiftKey) return;
							event.preventDefault();
							event.stopPropagation();
							onItemShiftClick();
						}
					: undefined
			}
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
			    configured accent wash. Inside the structural selection BOTH are
			    suppressed — the surface's single ring overlay is the paint, and
			    hovering the one object must not stack a second wash — while the
			    drop flash still reads (it is transient feedback, not state). */}
			{(flashing ||
				((inHighlight || selected) && !inStructuralSelection)) && (
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
			    background wash. The structural zone drops the per-row bar too —
			    its ring's border carries the accent. */}
			{selected && !inStructuralSelection && (
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

			{/* Gutter: by default just the strip the block affordances need — the
			    flow renders a structured document — line numbers retired with the
			    preset system (2026-08-04 audit). The gutter keeps its collapsed
			    affordance width; block affordances live in one cluster (see
			    BlockCluster) anchored at its right edge. */}
			<div
				className="sticky left-0 z-10 flex shrink-0 select-none items-start justify-end pr-3 text-right"
				style={{
					minWidth: gutterWidth,
					background:
						selected && !inStructuralSelection
							? EDITOR_COLORS.activeLineBg
							: "transparent",
				}}
			/>

			{/* THE drag handle (Notion model — see resolveDragHandleUnit): at most
			    one exists in the whole surface, mounted on the resolved unit's
			    first row, floating in the whitespace immediately LEFT of the
			    unit's content. Block-kind is the [⋮⋮] grip + block menu; item-kind
			    is the drag-only item grip with its smaller glyph (big grip =
			    block, small grip = item). */}
			{!isGap && handle?.kind === "block" && entry && (
				<BlockCluster
					node={line.node}
					indentCh={handle.indentCh}
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

			{/* The ITEM-kind handle: drag-only (no menu), right-aligned in the
			    same left rail the block grip uses, which for a nested item is the
			    indentation margin just left of its marker. The
			    `data-prompt-affordance` stamp lets annotate mode display:none it,
			    so item drags never fight Cmd+drag range selection. */}
			{!isGap && handle?.kind === "item" && isItem && (
				<div
					data-prompt-affordance="item-handle"
					data-prompt-handle-indent={handle.indentCh}
					className="absolute top-0 z-20 flex items-center justify-end"
					style={{
						left: 0,
						width: dragHandleRailWidth(handle.indentCh),
						height: EDITOR_METRICS.lineHeight,
					}}
					onClick={(event) => event.stopPropagation()}
				>
					<button
						type="button"
						title="Drag to reorder item"
						aria-label="Drag list item"
						className="prompt-editor-item-grip pointer-events-auto flex w-7 cursor-grab touch-none select-none items-center justify-center rounded-[3px] hover:bg-white/10 active:cursor-grabbing"
						style={{
							height: EDITOR_METRICS.lineHeight,
							color: EDITOR_COLORS.grip,
						}}
						onPointerDown={(event) => {
							// Pointer-down starts an ITEM drag — never an edit session
							// (the handle floats outside the text flow).
							event.stopPropagation();
							onItemHandleDown?.(event);
						}}
						onClick={(event) => event.stopPropagation()}
					>
						<GripVertical
							size={14}
							style={{
								width: EDITOR_METRICS.itemGripSize,
								height: EDITOR_METRICS.itemGripSize,
							}}
						/>
					</button>
				</div>
			)}

			{/* Body column. Hanging-indent via padding-left + negative text-indent. */}
			<div
				// The row's text region — everything outside (gutter, affordances) is
				// chrome. Range-to-offset mapping walks text nodes inside this only.
				data-prompt-row-text=""
				className="relative z-0 min-w-0 flex-1 pr-4 pl-3"
				style={
					isGap
						? undefined
						: {
								paddingLeft: `calc(0.75rem + ${indentWidth})`,
								textIndent: `calc(0px - ${indentWidth})`,
								// Landmark scale on the body only — the gutter number
								// keeps the buffer's size. Line boxes stay one
								// line-height because the metric is pixel-valued.
								...(isTopLandmarkOpen
									? {
											fontSize: `calc(${EDITOR_METRICS.fontSize} * ${EDITOR_METRICS.landmarkFontScale})`,
										}
									: null),
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
					<GapRow height={gapHeightForLine(line)} />
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
						// Prose the renderer escaped (paragraph / field content)
						// displays DECODED, matching what edit mode shows; verbatim
						// rows (code / raw / tags) keep the model text byte-for-byte.
						decodeEntities={lineRendersDecodedEntities(line)}
						onSelect={onSelect}
						onStartEdit={onStartEdit}
					/>
				)}
			</div>
		</div>
	);
}

/**
 * Role-scoped syntax-variable overrides for one row. Returned as CSS custom
 * properties so every colored descendant — the shared highlighter's spans AND
 * SectionTagRow's trim/editor, which all read `var(--prompt-editor-syntax-*)`
 * — resolves the row's ink without any text or markup change.
 */
function roleInkOverrides(line: XmlLine): React.CSSProperties | undefined {
	if (line.role === "close") {
		// A closing tag mirrors its opener's tier color EXACTLY — brackets
		// included — so where a section starts and where it ends carry the same
		// ink. Color only: the landmark font scale stays on the open tag.
		if (line.depth === 0) {
			return {
				"--prompt-editor-syntax-tag": EDITOR_COLORS.syntaxTagLandmark,
				"--prompt-editor-syntax-punctuation":
					EDITOR_COLORS.syntaxTagLandmark,
			} as React.CSSProperties;
		}
		if (line.depth === 1) {
			return {
				"--prompt-editor-syntax-tag": EDITOR_COLORS.syntaxTagSublandmark,
				"--prompt-editor-syntax-punctuation":
					EDITOR_COLORS.syntaxTagSublandmark,
			} as React.CSSProperties;
		}
		// Deeper closes match their openers by simply using the stock tag ink.
		return undefined;
	}
	if (line.role !== "open") return undefined;
	if (line.depth === 0) {
		return {
			"--prompt-editor-syntax-tag": EDITOR_COLORS.syntaxTagLandmark,
		} as React.CSSProperties;
	}
	if (line.depth === 1) {
		return {
			"--prompt-editor-syntax-tag": EDITOR_COLORS.syntaxTagSublandmark,
		} as React.CSSProperties;
	}
	return undefined;
}

/** Container kinds whose open tag starts a new section of the document. */
function isSectionLikeNode(node: PromptBlockNode): boolean {
	return (
		node.type === "section" ||
		node.type === "example" ||
		node.type === "contextUsage"
	);
}

/**
 * Height of a gap row. Big seams mark where a SECTION starts, nothing else: a
 * gap row's node is the block that follows it, so only gaps preceding a
 * section-like container take the tiered heights — the full chapter break
 * before a top-level section, roughly half of it before a depth-1 one.
 * Ordinary breaks (before paragraphs, lists, fields, deeper sections) keep the
 * plain one-line gap, exactly like a paragraph break inside prose.
 */
function gapHeightForLine(line: XmlLine): string {
	if (!isSectionLikeNode(line.node)) return EDITOR_METRICS.gapHeightBase;
	if (line.depth <= 0) return EDITOR_METRICS.gapHeightTop;
	if (line.depth === 1) return EDITOR_METRICS.gapHeightSub;
	return EDITOR_METRICS.gapHeightBase;
}

/**
 * The blank separator row the renderer emits between sibling blocks. It carries
 * NO interactive UI: blocks are created by typing, and a hover pill plus a
 * hairline on every seam made the surface twitch. The row still exists and
 * still occupies real height — it is real rendered text (Raw shows the same
 * blank line), it keeps the line-number grid honest, and drag reads boundary
 * positions from row rects that this row's height determines. Its height
 * grades with the following block's tier (see gapHeightForLine).
 */
function GapRow({ height }: { height: string }) {
	return <div style={{ height }} />;
}

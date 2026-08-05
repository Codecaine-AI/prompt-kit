// Slice: pointer-drag physics + overlays — ghost, insertion line, drop flash.
//
// Native HTML5 drag-and-drop cannot render a scaled, semi-transparent
// multi-line ghost that we control frame-by-frame (setDragImage only accepts a
// static snapshot taken at dragstart and cannot be restyled), and it gives no
// reliable pointer coordinates on all platforms. So the drag layer is built on
// pointer events: we own the ghost, the insertion line, and the drop flash.
// The actual reorder still routes through moveNear → movePromptBlockNodeByIdWithStep.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptEditorTreeEntry } from "../../editors";

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
	LINE_HEIGHT_PX,
	PROMPT_EDITOR_ROOT_CLASS,
	editorTypeStyle,
} from "../../surface/editor-surface";

/** Pointer travel (px) that turns an armed handle press into a live drag —
 * below it the release stays a click (the block menu's opener). */
const DRAG_LIFT_THRESHOLD_PX = 4;
import { highlightXmlLine } from "../../surface/xml-highlight";
import { samePath } from "../PromptFlowShared";
import type { XmlLine } from "../../../document/render/line-model";
import { promptFlowIndentForDepth } from "./node-geometry";

interface DragState {
	/**
	 * What the drag moves: a whole BLOCK (gutter grip) or one LIST ITEM (the
	 * inline handle at the item's marker). The two share the ghost, the
	 * insertion line, and the pointer loop; only targeting and commit differ.
	 */
	kind: "block" | "item";
	/** Node being dragged — the block's id, or the GRABBED item's own id. */
	nodeId: string;
	/** Item drags only: the containing list and the dragged run's START index. */
	listId?: string;
	itemIndex?: number;
	/**
	 * Item drags only: how many contiguous items the drag carries. 1 for a
	 * plain item drag; >1 when the grabbed item was part of the current
	 * multi-item selection, which then moves as ONE object.
	 */
	itemCount?: number;
	/** Item drags only: the ids of every carried item, in list order. */
	groupItemIds?: string[];
	/**
	 * Block drags only: set when the drag carries a structural BLOCK RUN — a
	 * contiguous run of siblings under one parent (null = top level), lifted
	 * as one object. Targeting excludes the run's interior boundaries and the
	 * commit routes through `moveBlocks` instead of `moveNear`.
	 */
	blockRun?: {
		parentId: string | null;
		fromIndex: number;
		count: number;
		blockIds: string[];
	};
	/**
	 * Rows (in `lines`) the dragged unit spans at lift-off — a group drag's
	 * union of item extents. Drives dimming, so every carried row reads as
	 * lifted out.
	 */
	rowRange: { start: number; end: number };
	/**
	 * Every rendered line of the block, so the floating ghost shows the WHOLE
	 * block ("you can see the overview"), react-beautiful-dnd style — not just
	 * the first few lines.
	 */
	ghostLines: string[];
	/** Total line count of the dragged block, for the "N lines" badge. */
	lineCount: number;
	/** Pixel width of the grabbed row, so the ghost matches the source width. */
	width: number;
	/** Computed runtime line height captured from the grabbed row. */
	lineHeight: number;
	/** Current pointer position (viewport coords). */
	x: number;
	y: number;
	/** Pointer offset within the grabbed row, so the ghost tracks naturally. */
	offsetX: number;
	offsetY: number;
}

interface DropTargetState {
	/** Row index (in `lines`) the insertion line snaps above. */
	rowIndex: number;
	/** y position (viewport) of the insertion line. */
	y: number;
	/** Indent depth of the drop target, so into-a-section vs between-sections differ. */
	depth: number;
	/** Horizontal content bounds, needed when content-width constrains the rows. */
	x: number;
	width: number;
	/**
	 * Item drags only: the insertion slot in the list's ORIGINAL indexing
	 * (`k` = before the item currently at index k; item count = after the
	 * last). Blocks re-derive their target from `rowIndex` instead.
	 */
	itemSlot?: number;
	/**
	 * Block drags: the insertion slot in the SIBLING indexing of the dragged
	 * block's parent (`k` = before sibling k; sibling count = after the last).
	 * Block-run commits speak this directly; single blocks keep the
	 * `rowIndex` → moveNear resolution.
	 */
	blockSlot?: number;
}

export interface XmlDragApi {
	draggingId: string | null;
	drag: DragState | null;
	dropTarget: DropTargetState | null;
	/**
	 * Ids to flash after a committed drop: the moved block, or every item of
	 * the moved run — the flash covers the whole object that landed.
	 */
	flashIds: readonly string[] | null;
	startDrag: (
		event: React.PointerEvent<HTMLElement>,
		nodeId: string,
		options?: DragStartOptions,
	) => void;
	startItemDrag: (
		event: React.PointerEvent<HTMLElement>,
		item: ItemDragSpec,
		options?: DragStartOptions,
	) => void;
	/** Lifts a structural block run (contiguous siblings) as one object. */
	startBlockRunDrag: (
		event: React.PointerEvent<HTMLElement>,
		run: BlockRunDragSpec,
		options?: DragStartOptions,
	) => void;
}

export interface DragStartOptions {
	/** The caller already thresholded the gesture (body-move): lift NOW instead
	 * of arming the controller's own travel threshold. */
	immediate?: boolean;
}

export interface BlockRunDragSpec {
	/** Parent of the run's siblings; null = the document's top level. */
	parentId: string | null;
	/** Start index of the run in the parent's children. */
	fromIndex: number;
	/** Contiguous run length. */
	count: number;
	/** Ids of every carried block, in sibling order. */
	blockIds: readonly string[];
	/** The block whose handle was grabbed (the pointer's anchor row). */
	grabbedId: string;
}

export interface ItemDragSpec {
	listId: string;
	/** The item whose handle was grabbed (the pointer's anchor row). */
	itemId: string;
	/** Start index of the dragged run — the grabbed item's for a single drag. */
	itemIndex: number;
	/** Contiguous run length; omitted / 1 = plain single-item drag. */
	count?: number;
	/** Ids of every carried item, in list order. Defaults to `[itemId]`. */
	itemIds?: readonly string[];
}

/** One legal insertion boundary for an item drag, in the list's own indexing. */
export interface ItemDropSlot {
	/** Insertion slot in the list's ORIGINAL indexing (see DropTargetState). */
	slot: number;
	/** Row whose rect names the boundary's y position. */
	rowIndex: number;
	depth: number;
	/** Which edge of that row the boundary sits on. */
	edge: "top" | "bottom";
}

/**
 * The insertion boundaries an item drag of `count` items starting at
 * `fromIndex` may target: before each item of `listId`, plus after the last
 * item's full extent (so a multi-line last item is not split) — MINUS every
 * slot strictly inside the dragged run. A group cannot be dropped into
 * itself, so those boundaries simply do not exist while it is lifted; the
 * run's own edges remain (they are the "put it back" no-op drops, same as a
 * single item's). Pure, so the exclusion rule is testable without pointer
 * geometry.
 */
export function itemDropSlots(
	lines: readonly XmlLine[],
	itemRanges: ReadonlyMap<string, { start: number; end: number }>,
	listId: string,
	fromIndex: number,
	count: number,
): ItemDropSlot[] {
	const slots: ItemDropSlot[] = [];
	let lastItemId: string | undefined;
	lines.forEach((line, rowIndex) => {
		if (line.role !== "item" || line.nodeId !== listId) return;
		if (line.itemIndex === undefined) return;
		slots.push({
			slot: line.itemIndex,
			rowIndex,
			depth: line.depth,
			edge: "top",
		});
		lastItemId = line.itemId;
	});
	if (slots.length === 0) return slots;
	const lastSlot = slots[slots.length - 1]!;
	const lastExtent = lastItemId ? itemRanges.get(lastItemId) : undefined;
	slots.push({
		slot: slots.length,
		rowIndex: lastExtent ? lastExtent.end : lastSlot.rowIndex,
		depth: lastSlot.depth,
		edge: "bottom",
	});
	return slots.filter(
		(candidate) =>
			candidate.slot <= fromIndex || candidate.slot >= fromIndex + count,
	);
}

export function useXmlDrag({
	lines,
	nodeRanges,
	itemRanges,
	entriesById,
	rowsRef,
	scrollRef,
	moveNear,
	moveItems,
	moveBlocks,
}: {
	lines: readonly XmlLine[];
	nodeRanges: Map<string, { start: number; end: number }>;
	/** Per-list-item row extents (marker row + nested child rows). */
	itemRanges: Map<string, { start: number; end: number }>;
	entriesById: Map<string, PromptEditorTreeEntry>;
	rowsRef: React.RefObject<HTMLDivElement | null>;
	scrollRef: React.RefObject<HTMLDivElement | null>;
	moveNear: (sourceId: string, targetId: string, side: "before" | "after") => void;
	/**
	 * Commits an item-run reorder: `count` contiguous items starting at
	 * `fromIndex`, `toSlot` in the list's original indexing. Single drags pass
	 * count 1.
	 */
	moveItems: (
		listId: string,
		fromIndex: number,
		count: number,
		toSlot: number,
	) => void;
	/**
	 * Commits a block-run reorder: `count` contiguous siblings of `parentId`
	 * (null = top level) starting at `fromIndex`, `toSlot` in the siblings'
	 * original indexing. Only run drags call it; single blocks keep moveNear.
	 */
	moveBlocks?: (
		parentId: string | null,
		fromIndex: number,
		count: number,
		toSlot: number,
	) => void;
}): XmlDragApi {
	const [drag, setDrag] = useState<DragState | null>(null);
	const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
	const [flashIds, setFlashIds] = useState<readonly string[] | null>(null);
	// A press on a handle ARMS a drag; it only lifts past the travel
	// threshold. Keeps a motionless click a click (the block menu's opener).
	// Imperative (not effect-driven): the window listeners must exist the
	// instant the press lands, or the very first move slips past them.
	const disarmRef = useRef<(() => void) | null>(null);

	// Live refs so the window-level pointer handlers always read current data
	// without re-subscribing on every render.
	const dragRef = useRef<DragState | null>(null);
	const dropRef = useRef<DropTargetState | null>(null);
	dragRef.current = drag;
	dropRef.current = dropTarget;

	const linesRef = useRef(lines);
	const rangesRef = useRef(nodeRanges);
	const itemRangesRef = useRef(itemRanges);
	const entriesRef = useRef(entriesById);
	linesRef.current = lines;
	rangesRef.current = nodeRanges;
	itemRangesRef.current = itemRanges;
	entriesRef.current = entriesById;

	/**
	 * Given a pointer y, find the valid insertion boundary: the row gap between
	 * two sibling blocks of the dragged node's parent. Only siblings are legal
	 * targets (moveNear enforces same parentPath), so the insertion line only
	 * appears over reorderable boundaries.
	 */
	const computeDrop = useCallback(
		(clientY: number): DropTargetState | null => {
			const source = dragRef.current;
			const rowsEl = rowsRef.current;
			if (!source || !rowsEl) return null;

			const rowRect = (rowIndex: number): DOMRect | null => {
				const el = rowsEl.querySelector<HTMLElement>(
					`[data-row-index="${rowIndex}"]`,
				);
				return el ? el.getBoundingClientRect() : null;
			};

			// ITEM drags target the gaps between items of the SAME list only.
			// Boundaries: before each item's marker row, plus after the last
			// item's full extent (so a multi-line last item is not split). The
			// pointer must stay near the list — outside its vertical band no slot
			// lights up and release cancels, which is how "dropping onto non-list
			// territory does nothing" is expressed. Cross-list moves are out of
			// scope for the pointer layer: an item cannot be dropped into a
			// different list, the same clamp the block layer applies to parents.
			if (source.kind === "item") {
				const listId = source.listId;
				if (listId === undefined) return null;
				const slots = itemDropSlots(
					linesRef.current,
					itemRangesRef.current,
					listId,
					source.itemIndex ?? 0,
					source.itemCount ?? 1,
				);
				if (slots.length === 0) return null;

				let best: DropTargetState | null = null;
				let bestDist = Number.POSITIVE_INFINITY;
				let listTop = Number.POSITIVE_INFINITY;
				let listBottom = Number.NEGATIVE_INFINITY;
				for (const candidate of slots) {
					const rect = rowRect(candidate.rowIndex);
					if (!rect) continue;
					const y = candidate.edge === "top" ? rect.top : rect.bottom;
					listTop = Math.min(listTop, rect.top);
					listBottom = Math.max(listBottom, rect.bottom);
					const dist = Math.abs(y - clientY);
					if (dist < bestDist) {
						bestDist = dist;
						best = {
							rowIndex:
								candidate.edge === "top"
									? candidate.rowIndex
									: candidate.rowIndex + 1,
							y,
							depth: candidate.depth,
							x: rect.left,
							width: rect.width,
							itemSlot: candidate.slot,
						};
					}
				}
				// Off-list vertical band (one line of grace): no valid slot.
				const grace = 24;
				if (clientY < listTop - grace || clientY > listBottom + grace) {
					return null;
				}
				return best;
			}

			const sourceEntry = entriesRef.current.get(source.nodeId);
			if (!sourceEntry) return null;

			// Siblings that share the dragged block's parent path, in order.
			const siblings = [...entriesRef.current.values()]
				.filter((entry) => samePath(entry.parentPath, sourceEntry.parentPath))
				.sort((a, b) => a.index - b.index);
			if (siblings.length === 0) return null;

			// Build candidate insertion points: before each sibling and after the
			// last one, each carrying its slot in the siblings' original indexing.
			// A single block maps its boundary to moveNear(target, side); a run
			// commit speaks the slot directly. y is read live from the boundary
			// row's rect so wrapped rows and scroll position never desync the
			// insertion line.
			type Candidate = {
				rowIndex: number;
				y: number;
				depth: number;
				x: number;
				width: number;
				slot: number;
			};

			const candidates: Candidate[] = [];
			for (const sib of siblings) {
				const range = rangesRef.current.get(sib.id);
				const rect = range ? rowRect(range.start) : null;
				if (!range || !rect) continue;
				candidates.push({
					rowIndex: range.start,
					y: rect.top,
					depth: sib.depth,
					x: rect.left,
					width: rect.width,
					slot: sib.index,
				});
			}
			const last = siblings[siblings.length - 1];
			const lastRange = last ? rangesRef.current.get(last.id) : undefined;
			const lastRect = lastRange ? rowRect(lastRange.end) : null;
			if (last && lastRange && lastRect) {
				candidates.push({
					rowIndex: lastRange.end + 1,
					y: lastRect.bottom,
					depth: last.depth,
					x: lastRect.left,
					width: lastRect.width,
					slot: last.index + 1,
				});
			}

			// A run cannot be dropped into itself: its interior boundaries do not
			// exist while it is lifted. The run's own edges remain — they are the
			// "put it back" no-op drops, same as a single block's.
			const run = source.blockRun;
			const legal = run
				? candidates.filter(
						(candidate) =>
							candidate.slot <= run.fromIndex ||
							candidate.slot >= run.fromIndex + run.count,
					)
				: candidates;

			// Snap to the nearest boundary the pointer is closest to.
			let best: DropTargetState | null = null;
			let bestDist = Number.POSITIVE_INFINITY;
			for (const candidate of legal) {
				const dist = Math.abs(candidate.y - clientY);
				if (dist < bestDist) {
					bestDist = dist;
					best = {
						rowIndex: candidate.rowIndex,
						y: candidate.y,
						depth: candidate.depth,
						x: candidate.x,
						width: candidate.width,
						blockSlot: candidate.slot,
					};
				}
			}
			return best;
		},
		[rowsRef],
	);

	/** Resolve a drop boundary to a moveNear(target, side) and execute it. */
	const commitDrop = useCallback(
		(target: DropTargetState, source: DragState) => {
			// Item drops carry their slot directly — moveListItemsStep speaks the
			// same "slot in original indexing" the targeting layer computed.
			if (source.kind === "item") {
				if (
					source.listId === undefined ||
					source.itemIndex === undefined ||
					target.itemSlot === undefined
				) {
					return;
				}
				moveItems(
					source.listId,
					source.itemIndex,
					source.itemCount ?? 1,
					target.itemSlot,
				);
				return;
			}
			// A block RUN commits through the run seam: one transaction moving the
			// contiguous siblings to the targeted slot, exactly like an item run.
			if (source.blockRun) {
				if (target.blockSlot === undefined || !moveBlocks) return;
				moveBlocks(
					source.blockRun.parentId,
					source.blockRun.fromIndex,
					source.blockRun.count,
					target.blockSlot,
				);
				return;
			}
			const sourceId = source.nodeId;
			const sourceEntry = entriesRef.current.get(sourceId);
			if (!sourceEntry) return;
			const siblings = [...entriesRef.current.values()]
				.filter((entry) => samePath(entry.parentPath, sourceEntry.parentPath))
				.sort((a, b) => a.index - b.index);

			// Which sibling starts at (or owns the boundary just before) this row?
			const before = siblings.find((sib) => {
				const range = rangesRef.current.get(sib.id);
				return range?.start === target.rowIndex;
			});
			if (before) {
				moveNear(sourceId, before.id, "before");
				return;
			}
			// Boundary after the last sibling.
			const last = siblings[siblings.length - 1];
			if (last) moveNear(sourceId, last.id, "after");
		},
		[moveNear, moveItems, moveBlocks],
	);

	// Read-at-call ref for the armed-press lift below: it computes a drop in
	// the same tick it creates the drag, before any re-render.
	const computeDropRef = useRef(computeDrop);
	computeDropRef.current = computeDrop;

	/**
	 * Shared drag lift-off: snapshot the source's rendered rows into the ghost
	 * and seat the pointer offset, for a whole block or one item's extent alike.
	 */
	const beginDrag = useCallback(
		(
			event: React.PointerEvent<HTMLElement>,
			range: { start: number; end: number },
			base: Pick<
				DragState,
				| "kind"
				| "nodeId"
				| "listId"
				| "itemIndex"
				| "itemCount"
				| "groupItemIds"
				| "blockRun"
			>,
			// Row the POINTER grabbed, for the ghost's seating offset. A group
			// drag may be grabbed on any of its items; the ghost still tracks the
			// hand naturally instead of jumping to the group's first row.
			anchorRow: number = range.start,
			// True when the CALLER already thresholded the gesture (the body-move
			// path): lift instantly instead of arming a second threshold.
			immediate = false,
		) => {
			event.preventDefault();
			const rowsEl = rowsRef.current;
			const rowEl = rowsEl?.querySelector<HTMLElement>(
				`[data-row-index="${anchorRow}"]`,
			);
			const rect = rowEl?.getBoundingClientRect();
			const computedLineHeight = rowEl
				? Number.parseFloat(getComputedStyle(rowEl).lineHeight)
				: LINE_HEIGHT_PX;
			// Snapshot what the user actually SEES: each row's rendered text
			// region. The model's `line.text` is the raw rendered-XML string, in
			// which content entities stay escaped (`&lt;diff&gt;`) — the DOM rows
			// display the decoded form, and the ghost must match them. Gap rows
			// (no text region) fall back to the model text.
			const ghostLines: string[] = [];
			for (let index = range.start; index <= range.end; index += 1) {
				const region = rowsEl?.querySelector<HTMLElement>(
					`[data-row-index="${index}"] [data-prompt-row-text]`,
				);
				const text = region?.textContent ?? linesRef.current[index]?.text ?? "";
				ghostLines.push(text.length === 0 ? " " : text);
			}

			// ARM, don't lift (2026-08-04 audit): creating the drag state right
			// on pointerdown unmounted the very handle being pressed (handleUnit
			// yields no handle while a drag is live), so the release click
			// retargeted to an ancestor and the block menu could NEVER open from
			// a real pointer. The drag now begins only once the pointer travels
			// past the threshold; a motionless press stays a click.
			disarmRef.current?.();
			const startX = event.clientX;
			const startY = event.clientY;
			if (immediate) {
				const lifted: DragState = {
					...base,
					rowRange: { start: range.start, end: range.end },
					ghostLines,
					lineCount: range.end - range.start + 1,
					width: rect ? rect.width : 320,
					lineHeight: Number.isFinite(computedLineHeight)
						? computedLineHeight
						: LINE_HEIGHT_PX,
					x: startX,
					y: startY,
					offsetX: rect ? startX - rect.left : 12,
					offsetY: rect ? startY - rect.top : 8,
				};
				setDrag(lifted);
				dragRef.current = lifted;
				setDropTarget(computeDropRef.current(startY));
				return;
			}
			const state: DragState = {
				...base,
				rowRange: { start: range.start, end: range.end },
				ghostLines,
				lineCount: range.end - range.start + 1,
				width: rect ? rect.width : 320,
				lineHeight: Number.isFinite(computedLineHeight)
					? computedLineHeight
					: LINE_HEIGHT_PX,
				x: startX,
				y: startY,
				offsetX: rect ? startX - rect.left : 12,
				offsetY: rect ? startY - rect.top : 8,
			};
			const disarm = () => {
				window.removeEventListener("pointermove", onArmedMove);
				window.removeEventListener("pointerup", onArmedUp);
				disarmRef.current = null;
			};
			const onArmedMove = (moveEvent: PointerEvent) => {
				const travel = Math.hypot(
					moveEvent.clientX - startX,
					moveEvent.clientY - startY,
				);
				if (travel < DRAG_LIFT_THRESHOLD_PX) return;
				disarm();
				const lifted = {
					...state,
					x: moveEvent.clientX,
					y: moveEvent.clientY,
				};
				setDrag(lifted);
				// Eager ref write: `computeDrop` reads dragRef, which the render
				// cycle has not refreshed yet in this same tick.
				dragRef.current = lifted;
				// The lifting move also SEATS the drop target — a one-move drag
				// (down, one big move, up) must land where that move pointed.
				setDropTarget(computeDropRef.current(moveEvent.clientY));
			};
			const onArmedUp = () => disarm();
			window.addEventListener("pointermove", onArmedMove);
			window.addEventListener("pointerup", onArmedUp);
			disarmRef.current = disarm;
		},
		[rowsRef],
	);

	// A component unmount mid-press must not leave armed listeners behind.
	useEffect(() => () => disarmRef.current?.(), []);

	const startDrag = useCallback(
		(
			event: React.PointerEvent<HTMLElement>,
			nodeId: string,
			options?: { immediate?: boolean },
		) => {
			if (event.button !== 0) return;
			const range = rangesRef.current.get(nodeId);
			if (!range) return;
			beginDrag(
				event,
				range,
				{ kind: "block", nodeId },
				range.start,
				options?.immediate ?? false,
			);
		},
		[beginDrag],
	);

	const startBlockRunDrag = useCallback(
		(
			event: React.PointerEvent<HTMLElement>,
			run: BlockRunDragSpec,
			options?: DragStartOptions,
		) => {
			if (event.button !== 0) return;
			// The carried extent: the union of every run block's row range.
			// Siblings render contiguously, so the union (gaps included) IS the
			// run's visual band — dimming it reads as the whole object lifted out.
			let start = Number.POSITIVE_INFINITY;
			let end = Number.NEGATIVE_INFINITY;
			for (const id of run.blockIds) {
				const range = rangesRef.current.get(id);
				if (!range) return;
				start = Math.min(start, range.start);
				end = Math.max(end, range.end);
			}
			const grabbed = rangesRef.current.get(run.grabbedId);
			if (!grabbed) return;
			beginDrag(
				event,
				{ start, end },
				{
					kind: "block",
					nodeId: run.grabbedId,
					blockRun: {
						parentId: run.parentId,
						fromIndex: run.fromIndex,
						count: run.count,
						blockIds: [...run.blockIds],
					},
				},
				grabbed.start,
				options?.immediate ?? false,
			);
		},
		[beginDrag],
	);

	const startItemDrag = useCallback(
		(
			event: React.PointerEvent<HTMLElement>,
			item: ItemDragSpec,
			options?: DragStartOptions,
		) => {
			if (event.button !== 0) return;
			// The carried extent — each item's marker row plus nested child rows,
			// unioned across the run — so a multi-line item (or a whole selected
			// group) lifts out (and later dims/flashes) as one unit. Items of a
			// list render contiguously, so the union of extents IS the group's
			// visual band.
			const itemIds = item.itemIds ?? [item.itemId];
			let start = Number.POSITIVE_INFINITY;
			let end = Number.NEGATIVE_INFINITY;
			for (const id of itemIds) {
				const range = itemRangesRef.current.get(id);
				if (!range) return;
				start = Math.min(start, range.start);
				end = Math.max(end, range.end);
			}
			const grabbed = itemRangesRef.current.get(item.itemId);
			if (!grabbed) return;
			beginDrag(
				event,
				{ start, end },
				{
					kind: "item",
					nodeId: item.itemId,
					listId: item.listId,
					itemIndex: item.itemIndex,
					itemCount: item.count ?? 1,
					groupItemIds: [...itemIds],
				},
				grabbed.start,
				options?.immediate ?? false,
			);
		},
		[beginDrag],
	);

	// Window-level pointer tracking while a drag is active. Registered only
	// while `drag` is set so it never runs at rest.
	useEffect(() => {
		if (!drag) return;

		function onMove(event: PointerEvent) {
			const current = dragRef.current;
			if (!current) return;
			setDrag({ ...current, x: event.clientX, y: event.clientY });
			setDropTarget(computeDrop(event.clientY));

			// Auto-scroll when the pointer nears the viewport edges of the list.
			const scroller = scrollRef.current;
			if (scroller) {
				const rect = scroller.getBoundingClientRect();
				const edge = 28;
				if (event.clientY < rect.top + edge) scroller.scrollTop -= 8;
				else if (event.clientY > rect.bottom - edge) scroller.scrollTop += 8;
			}
		}

		function onUp() {
			const source = dragRef.current;
			const target = dropRef.current;
			if (source && target) {
				commitDrop(target, source);
				// ~200ms background flash on the moved unit's new range — every
				// carried unit for a group/run drag, so the flash covers what landed.
				setFlashIds(
					source.groupItemIds ??
						source.blockRun?.blockIds ?? [source.nodeId],
				);
				window.setTimeout(() => setFlashIds(null), 220);
			}
			setDrag(null);
			setDropTarget(null);
		}

		function onKey(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setDrag(null);
				setDropTarget(null);
			}
		}

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("keydown", onKey);
		};
	}, [drag, computeDrop, commitDrop, scrollRef]);

	return {
		draggingId: drag?.nodeId ?? null,
		drag,
		dropTarget,
		flashIds,
		startDrag,
		startItemDrag,
		startBlockRunDrag,
	};
}

/**
 * Floating ghost of the dragged unit: a COMPACT snapshot — the unit's first
 * visible line (ellipsized) plus a muted "+N more" for multi-line units —
 * following the cursor at slight scale/transparency (Notion feel). The thin
 * DropIndicator line is the placement signal and the source rows dim in
 * place, so the ghost never needs to show the whole extent or cover the
 * list; it is a handle-sized token of what is being carried.
 */
export function DragGhost({ drag }: { drag: XmlDragApi }) {
	if (!drag.drag) return null;
	const state = drag.drag;
	const firstLine =
		state.ghostLines.find((text) => text.trim().length > 0) ??
		state.ghostLines[0] ??
		"";
	const moreCount = state.lineCount - 1;
	return (
		<div
			className={`${PROMPT_EDITOR_ROOT_CLASS} pointer-events-none fixed z-50 origin-top-left font-mono`}
			style={{
				...editorTypeStyle,
				lineHeight: `${state.lineHeight}px`,
				left: state.x - state.offsetX,
				top: state.y - state.offsetY,
				maxWidth: Math.min(state.width, 480),
				transform: "scale(0.9)",
				opacity: "var(--prompt-editor-drag-ghost-opacity, 0.8)",
			}}
		>
			<div
				className="flex items-baseline gap-2 overflow-hidden rounded-[4px] border py-1 pl-3 pr-3 shadow-xl"
				style={{
					background: EDITOR_COLORS.bg,
					color: EDITOR_COLORS.fg,
					borderColor: EDITOR_COLORS.guide,
				}}
			>
				<div className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
					{highlightXmlLine(firstLine.trim())}
				</div>
				{moreCount > 0 && (
					<span
						className="shrink-0 whitespace-nowrap text-[10px]"
						style={{ color: EDITOR_COLORS.lineNumber ?? EDITOR_COLORS.fg, opacity: 0.7 }}
					>
						+{moreCount} more
					</span>
				)}
			</div>
		</div>
	);
}

/**
 * Full-width 2px accent insertion line snapping to a valid boundary. Its left
 * edge is indented to the target nesting depth, so dropping into a section
 * reads differently from dropping between top-level sections.
 */
export function DropIndicator({
	drag,
	gutterWidth,
}: {
	drag: XmlDragApi;
	gutterWidth: string;
}) {
	const target = drag.dropTarget;
	if (!drag.drag || !target) return null;
	return (
		<div
			className="pointer-events-none fixed z-40 flex items-center"
			style={{
				left: target.x,
				width: target.width,
				top: `calc(${target.y}px - (${EDITOR_METRICS.dropLineWidth} / 2))`,
			}}
		>
			<div
				className="flex-1"
				style={{
					height: EDITOR_METRICS.dropLineWidth,
					// Same column math as the indent guides: gutter + body padding +
					// the target depth's text indent, so the line starts exactly at
					// the text column it would insert into.
					marginLeft: `calc(${gutterWidth} + 0.75rem + ${promptFlowIndentForDepth(
						target.depth,
					)})`,
					background: EDITOR_COLORS.dropLine,
					opacity: "var(--prompt-editor-drop-line-opacity, 0.95)",
				}}
			/>
		</div>
	);
}

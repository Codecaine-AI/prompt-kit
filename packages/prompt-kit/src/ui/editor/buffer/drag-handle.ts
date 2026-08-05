// Slice: canonical drag-handle resolution — which ONE unit owns the handle,
// and where that handle sits horizontally.
"use client";

import { EDITOR_METRICS, promptEditorIndentForSpaces } from "../../surface/editor-surface";
import type { XmlLine } from "../../../document/render/line-model";
import type { NodeRange } from "./node-geometry";

/**
 * The one draggable unit whose handle is currently shown.
 *
 * `row` is the unit's FIRST rendered row — the handle anchors there, aligned
 * with the unit's first visible line. `indentCh` is that row's leading indent
 * in spaces; it drives the handle's x so the grip floats in the whitespace
 * immediately left of the unit's content (see dragHandleRailWidth).
 */
export interface DragHandleUnit {
	kind: "block" | "item";
	/** Unit id: the block's id, or the list ITEM's own id. */
	id: string;
	/** Row index (in `lines`) of the unit's first rendered line. */
	row: number;
	/** Leading indent, in space characters, of that anchor row. */
	indentCh: number;
	/** Item units: the containing list and the item's index, for the drag seam. */
	listId?: string;
	itemIndex?: number;
}

/**
 * THE CANONICAL DRAG-HANDLE MODEL (Notion-style; docs-system will mirror it).
 *
 * At most ONE drag handle exists at any moment: the handle of the DEEPEST
 * draggable unit under the pointer, floating at that unit's left content
 * edge. Concretely:
 *
 * - Rows owned by a LIST ITEM (its marker row, or any row of a block nested
 *   in it — innermost item wins for nested lists) resolve to that ITEM. The
 *   handle sits in the indentation margin just left of the item's marker, on
 *   the item's first row.
 * - Every other row resolves to its owning BLOCK: open/close tags, paragraph
 *   lines, code fences all show the block's handle on the block's first row,
 *   at the block's left content edge (the gutter, for a top-level block —
 *   that IS its left edge).
 * - Dragging a unit carries its children: the unit's extent (nodeRanges /
 *   itemRanges) moves as one object.
 *
 * A list block has no rows of its own (its rendered rows are its items'), so
 * hover never yields a list-block handle — exactly the Notion reading where
 * each bullet is the draggable unit.
 */
export function resolveDragHandleUnit({
	lines,
	hoverRow,
	rowItemIds,
	itemRanges,
	nodeRanges,
	canDragBlock,
}: {
	lines: readonly XmlLine[];
	/** Row index currently under the pointer, or null when none. */
	hoverRow: number | null;
	/** Innermost owning list-item id per row (see index.tsx rowItemIds). */
	rowItemIds: readonly (string | undefined)[];
	itemRanges: Map<string, NodeRange>;
	nodeRanges: Map<string, NodeRange>;
	/** Whether a block id is a real drag target (has an editor-tree entry). */
	canDragBlock: (nodeId: string) => boolean;
}): DragHandleUnit | null {
	if (hoverRow === null) return null;
	const line = lines[hoverRow];
	if (!line || line.role === "gap") return null;

	// Deepest unit first: any row inside an item's extent belongs to the item.
	const itemId = rowItemIds[hoverRow];
	if (itemId !== undefined) {
		const range = itemRanges.get(itemId);
		const marker = range ? lines[range.start] : undefined;
		if (
			range &&
			marker &&
			marker.role === "item" &&
			marker.itemIndex !== undefined
		) {
			return {
				kind: "item",
				id: itemId,
				row: range.start,
				indentCh: leadingIndentCh(marker.text),
				listId: marker.nodeId,
				itemIndex: marker.itemIndex,
			};
		}
	}

	if (!canDragBlock(line.nodeId)) return null;
	return blockHandleUnit(lines, nodeRanges, line.nodeId);
}

/**
 * The block-kind handle unit for an explicitly named block — used for the
 * non-pointer visibility states (open block menu, selected block). Returns
 * null when the block's anchor row is an ITEM row (a list): under the
 * one-handle model that row belongs to the item, and mounting a block grip
 * there would flicker against the pointer resolution.
 */
export function blockHandleUnit(
	lines: readonly XmlLine[],
	nodeRanges: Map<string, NodeRange>,
	nodeId: string,
): DragHandleUnit | null {
	const range = nodeRanges.get(nodeId);
	const anchor = range ? lines[range.start] : undefined;
	if (!range || !anchor) return null;
	if (anchor.role === "item") return null;
	return {
		kind: "block",
		id: nodeId,
		row: range.start,
		indentCh: leadingIndentCh(anchor.text),
	};
}

/** Leading indent of a rendered line, in space characters. */
export function leadingIndentCh(text: string): number {
	return text.match(/^ */)?.[0]?.length ?? 0;
}

/**
 * Width of the handle rail: an absolutely positioned strip from the row's
 * left edge to just short of the unit's content start. The handle is
 * right-aligned inside it, so its grip floats in the whitespace immediately
 * LEFT of the unit's first visible character — the indentation margin for a
 * nested unit, the gutter for a top-level block — and can never displace or
 * overlap text. The terms mirror the body column's own left edge: gutter +
 * the body's 0.75rem padding + the row's rendered indent, minus a 0.25ch
 * breathing gap before the text.
 */
export function dragHandleRailWidth(indentCh: number): string {
	return `calc(${EDITOR_METRICS.gutterWidth} + 0.75rem + ${promptEditorIndentForSpaces(
		indentCh,
	)} - 0.25ch)`;
}

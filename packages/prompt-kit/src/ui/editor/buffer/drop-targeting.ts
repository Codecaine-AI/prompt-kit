// Slice: pure drop-targeting math for ITEM drags — candidate enumeration
// across every list in the buffer, ghost-anchor → slot selection (nearest
// boundary, depth disambiguation by horizontal travel), and overshoot
// clamping. No DOM in here: the drag controller measures every referenced row
// rect ONCE at lift-off and feeds plain geometry in, which keeps the rules
// testable with synthetic fixtures instead of happy-dom rects.

import type { XmlLine } from "../../../document/render/line-model";

/**
 * What an item drop commits, in the language the step layer speaks. A `slot`
 * lands the run at an insertion boundary of a (possibly different) list; a
 * `nest` creates depth — the run becomes the FIRST child list content of an
 * item that has no sub-list yet (move + nest, composed as one transaction).
 */
export type ItemDropCommand =
	| { type: "slot"; listId: string; slot: number }
	| { type: "nest"; listId: string; parentItemIndex: number };

/** The dragged run, plus the rows its whole subtree spans at lift-off. */
export interface ItemDragDescriptor {
	listId: string;
	fromIndex: number;
	count: number;
	/**
	 * Rows (in `lines`) the dragged unit spans — used to erase every candidate
	 * that lives INSIDE the lifted subtree (a run cannot be dropped into a list
	 * it is carrying).
	 */
	rowRange: { start: number; end: number };
}

/**
 * One candidate boundary an item drag may snap to. `dead` marks the source
 * run's OWN edges: they stay in the candidate set so the run's resting band
 * keeps winning nearest-boundary while the pointer is near home (no indicator,
 * release puts the run back), but they never become a drop — the indicator
 * must never promise a move that release would no-op.
 */
export interface ItemSlotCandidate {
	kind: "slot" | "nest";
	/** List the command addresses — the slot's list, or the nest parent's. */
	listId: string;
	/** `slot` kind: insertion slot in that list's ORIGINAL indexing. */
	slot: number;
	/** `nest` kind: index of the item the run nests UNDER. */
	parentItemIndex?: number;
	/** Row whose rect names the boundary's y position. */
	rowIndex: number;
	/** Which edge of that row the boundary sits on. */
	edge: "top" | "bottom";
	/** Indent depth the indicator renders at (nest = parent depth + 1). */
	depth: number;
	dead: boolean;
}

/** A candidate with its lift-off measurements attached (scroller-content y). */
export interface MeasuredItemSlot extends ItemSlotCandidate {
	y: number;
	x: number;
	width: number;
}

/**
 * Every boundary an item drag may target, across ALL lists in the buffer —
 * bullet ↔ ordered included (ListItemNode is shared). Per list: before each
 * item, plus after the last item's full extent (so a multi-line last item is
 * not split). On top of the slots, a `nest` candidate sits under every item
 * that has NO list child yet, one depth deeper — the "indent under the item
 * above" drop.
 *
 * Exclusions:
 * - slots strictly INSIDE the dragged run do not exist while it is lifted;
 * - the run's own edges (`fromIndex`, `fromIndex + count`) survive as `dead`
 *   candidates — the put-it-back band that never renders an indicator;
 * - every candidate whose boundary row lies inside the dragged subtree's row
 *   range is erased (a carried nested list offers no targets).
 */
export function enumerateItemSlotCandidates(
	lines: readonly XmlLine[],
	itemRanges: ReadonlyMap<string, { start: number; end: number }>,
	source: ItemDragDescriptor,
): ItemSlotCandidate[] {
	interface ItemLineRef {
		line: XmlLine;
		rowIndex: number;
	}
	const byList = new Map<string, ItemLineRef[]>();
	lines.forEach((line, rowIndex) => {
		if (line.role !== "item" || line.itemIndex === undefined) return;
		const bucket = byList.get(line.nodeId);
		if (bucket) bucket.push({ line, rowIndex });
		else byList.set(line.nodeId, [{ line, rowIndex }]);
	});

	const inDraggedRows = (rowIndex: number): boolean =>
		rowIndex >= source.rowRange.start && rowIndex <= source.rowRange.end;

	const out: ItemSlotCandidate[] = [];
	for (const [listId, entries] of byList) {
		const isSourceList = listId === source.listId;
		const push = (candidate: ItemSlotCandidate) => {
			if (isSourceList) {
				// Boundaries strictly inside the lifted run do not exist.
				if (
					candidate.slot > source.fromIndex &&
					candidate.slot < source.fromIndex + source.count
				) {
					return;
				}
				// The run's own edges are the put-it-back band: selectable, never
				// a drop.
				if (
					candidate.slot === source.fromIndex ||
					candidate.slot === source.fromIndex + source.count
				) {
					out.push({ ...candidate, dead: true });
					return;
				}
			}
			// A list carried INSIDE the dragged subtree offers no targets.
			if (inDraggedRows(candidate.rowIndex)) return;
			out.push(candidate);
		};

		for (const entry of entries) {
			push({
				kind: "slot",
				listId,
				slot: entry.line.itemIndex ?? 0,
				rowIndex: entry.rowIndex,
				edge: "top",
				depth: entry.line.depth,
				dead: false,
			});
		}
		// After the last item's FULL extent, so a multi-line tail is not split.
		const last = entries[entries.length - 1]!;
		const lastExtent = last.line.itemId
			? itemRanges.get(last.line.itemId)
			: undefined;
		push({
			kind: "slot",
			listId,
			slot: (last.line.itemIndex ?? entries.length - 1) + 1,
			rowIndex: lastExtent ? lastExtent.end : last.rowIndex,
			edge: "bottom",
			depth: last.line.depth,
			dead: false,
		});
	}

	// Nest candidates: one depth deeper, under every item WITHOUT a list child
	// (an existing sub-list already exposes its own slots at that depth). The
	// boundary sits under the parent item's full extent; parents inside the
	// dragged subtree — including every carried item — are excluded by row.
	for (const [listId, entries] of byList) {
		for (const entry of entries) {
			const list = entry.line.node;
			if (list.type !== "bulletList" && list.type !== "orderedList") continue;
			const itemIndex = entry.line.itemIndex ?? 0;
			const item = list.items[itemIndex];
			if (!item) continue;
			const hasListChild = (item.children ?? []).some(
				(child) =>
					child.type === "bulletList" || child.type === "orderedList",
			);
			if (hasListChild) continue;
			const extent = item.id ? itemRanges.get(item.id) : undefined;
			const rowIndex = extent ? extent.end : entry.rowIndex;
			if (inDraggedRows(rowIndex)) continue;
			out.push({
				kind: "nest",
				listId,
				slot: itemIndex + 1,
				parentItemIndex: itemIndex,
				rowIndex,
				edge: "bottom",
				depth: entry.line.depth + 1,
				dead: false,
			});
		}
	}
	return out;
}

/**
 * The drop point is the GHOST's anchor — the vertical center of the dragged
 * row as the user sees it carried (`pointerY - offsetY` is the ghost's top
 * edge), NOT the raw pointer. Comparing the raw pointer to boundary edges is
 * what made the old targeting need ~half a row of travel upward but ~1.5 rows
 * downward; the anchor restores one-row symmetry.
 */
export function ghostAnchorY(
	pointerY: number,
	offsetY: number,
	lineHeight: number,
): number {
	return pointerY - offsetY + lineHeight / 2;
}

/**
 * Depth the ghost's horizontal position asks for: the source item's depth
 * plus the ghost's x travel since lift, in whole indent-width units. A
 * non-positive indent width (unmeasurable) pins the request to the source
 * depth, disabling x disambiguation rather than dividing by zero.
 */
export function ghostDepth(
	pointerX: number,
	offsetX: number,
	liftLeft: number,
	sourceDepth: number,
	depthIndentPx: number,
): number {
	if (depthIndentPx <= 0) return sourceDepth;
	const travel = pointerX - offsetX - liftLeft;
	return Math.max(0, sourceDepth + Math.round(travel / depthIndentPx));
}

/**
 * Boundaries measured within this many px of the nearest one count as STACKED
 * (the end of a nested list is also a slot of its parent list — same y, off
 * by sub-pixel rounding at most) and fall through to depth disambiguation.
 */
const SLOT_TIE_EPS_PX = 1;

/**
 * Picks the boundary the drag is pointing at: nearest by anchor y across ALL
 * candidates — which is also the clamp, since overshooting the lists' band
 * simply leaves the first/last boundary nearest; a live drag never targets
 * nothing (only Escape cancels). Stacked boundaries resolve by depth: the
 * candidate closest to the ghost's requested depth wins; a remaining tie
 * prefers a real drop over a dead own-edge (crossing exactly one row reads
 * as intent to move), then first-enumerated (stable).
 *
 * Returns null only when the winner is the run's own edge — the put-it-back
 * band — or when there are no candidates at all.
 */
export function selectItemDropSlot(
	slots: readonly MeasuredItemSlot[],
	anchorY: number,
	desiredDepth: number,
): MeasuredItemSlot | null {
	let bestDist = Number.POSITIVE_INFINITY;
	for (const slot of slots) {
		bestDist = Math.min(bestDist, Math.abs(slot.y - anchorY));
	}
	if (!Number.isFinite(bestDist)) return null;

	let winner: MeasuredItemSlot | null = null;
	for (const slot of slots) {
		if (Math.abs(slot.y - anchorY) > bestDist + SLOT_TIE_EPS_PX) continue;
		if (!winner) {
			winner = slot;
			continue;
		}
		const winnerDepthDist = Math.abs(winner.depth - desiredDepth);
		const slotDepthDist = Math.abs(slot.depth - desiredDepth);
		if (slotDepthDist < winnerDepthDist) {
			winner = slot;
			continue;
		}
		if (slotDepthDist > winnerDepthDist) continue;
		if (winner.dead && !slot.dead) winner = slot;
	}
	return winner && !winner.dead ? winner : null;
}

/** The command a measured winner commits as (never called with a dead slot). */
export function dropCommandForSlot(slot: MeasuredItemSlot): ItemDropCommand {
	if (slot.kind === "nest") {
		return {
			type: "nest",
			listId: slot.listId,
			parentItemIndex: slot.parentItemIndex ?? Math.max(0, slot.slot - 1),
		};
	}
	return { type: "slot", listId: slot.listId, slot: slot.slot };
}

import { describe, expect, it } from "bun:test";

import type { PromptDocument } from "../../../../src/index";
import { createPromptEditorModel } from "../../../../src/ui/editor/model";
import { buildXmlLineModel } from "../../../../src/document/render/line-model";
import { computeItemRanges } from "../../../../src/ui/editor/buffer/node-geometry";
import {
	enumerateItemSlotCandidates,
	ghostAnchorY,
	ghostDepth,
	selectItemDropSlot,
	type MeasuredItemSlot,
} from "../../../../src/ui/editor/buffer/drop-targeting";

/** A measured slot fixture on a synthetic 22px line grid. */
function slot(
	y: number,
	over: Partial<MeasuredItemSlot> = {},
): MeasuredItemSlot {
	return {
		kind: "slot",
		listId: "list",
		slot: 0,
		rowIndex: 0,
		edge: "top",
		depth: 1,
		dead: false,
		y,
		x: 0,
		width: 400,
		...over,
	};
}

const ROW = 22;

describe("ghostAnchorY (the drop point is the ghost, not the pointer)", () => {
	it("is the vertical center of the dragged row as the ghost carries it", () => {
		// Ghost top = pointer − grab offset; anchor = that + half a line.
		expect(ghostAnchorY(100, 8, ROW)).toBe(103);
		expect(ghostAnchorY(100, 0, ROW)).toBe(111);
	});
});

describe("ghostDepth (horizontal travel in indent units)", () => {
	it("rounds x travel since lift to whole depth steps from the source depth", () => {
		// liftLeft 40, one indent unit = 30px.
		expect(ghostDepth(45, 5, 40, 1, 30)).toBe(1);
		expect(ghostDepth(45 + 30, 5, 40, 1, 30)).toBe(2);
		expect(ghostDepth(45 - 30, 5, 40, 1, 30)).toBe(0);
		expect(ghostDepth(45 + 16, 5, 40, 1, 30)).toBe(2);
	});

	it("clamps at depth 0 and pins to the source depth when indent width is unmeasurable", () => {
		expect(ghostDepth(45 - 300, 5, 40, 1, 30)).toBe(0);
		expect(ghostDepth(500, 5, 40, 1, 0)).toBe(1);
	});
});

describe("selectItemDropSlot (nearest boundary to the ghost anchor)", () => {
	/**
	 * The canonical single-row list [A, B, C] with B lifted: rows at 0/22/44,
	 * B's own edges dead, A's top and C's bottom the real boundaries.
	 */
	const dragB: MeasuredItemSlot[] = [
		slot(0, { slot: 0 }),
		slot(ROW, { slot: 1, dead: true }),
		slot(2 * ROW, { slot: 2, dead: true }),
		slot(3 * ROW, { slot: 3, edge: "bottom" }),
	];
	// Grabbed at B's center → the anchor tracks the pointer 1:1.
	const rest = ROW + ROW / 2;

	it("the asymmetry is gone: one row of travel moves the item, either way", () => {
		// At rest the nearest boundaries are B's own edges: no target.
		expect(selectItemDropSlot(dragB, rest, 1)).toBeNull();
		// One row UP: the anchor reaches A's center — before-A wins the tie
		// against the dead edge (crossing a full row reads as intent).
		expect(selectItemDropSlot(dragB, rest - ROW, 1)?.slot).toBe(0);
		// One row DOWN: symmetric — after-C wins. The old raw-pointer compare
		// needed ~1.5 rows here and ~0.5 rows upward.
		expect(selectItemDropSlot(dragB, rest + ROW, 1)?.slot).toBe(3);
	});

	it("the run's own edges are never returned: half-row jitter yields no target", () => {
		expect(selectItemDropSlot(dragB, rest - ROW / 2, 1)).toBeNull();
		expect(selectItemDropSlot(dragB, rest + ROW / 2 - 2, 1)).toBeNull();
	});

	it("overshoot clamps to the outermost boundary instead of cancelling", () => {
		expect(selectItemDropSlot(dragB, -5000, 1)?.slot).toBe(0);
		expect(selectItemDropSlot(dragB, 5000, 1)?.slot).toBe(3);
		expect(selectItemDropSlot([], 100, 1)).toBeNull();
	});

	it("stacked boundaries (same y, different depth) split by the ghost's requested depth", () => {
		// End of a nested list = also a slot of its parent list: two candidates
		// share one y — the nested list's after-last (depth 2) and the parent's
		// next slot (depth 1).
		const stacked: MeasuredItemSlot[] = [
			slot(3 * ROW, { listId: "inner", slot: 1, depth: 2, edge: "bottom" }),
			slot(3 * ROW, { listId: "outer", slot: 2, depth: 1 }),
		];
		expect(selectItemDropSlot(stacked, 3 * ROW, 2)?.listId).toBe("inner");
		expect(selectItemDropSlot(stacked, 3 * ROW, 1)?.listId).toBe("outer");
		// Requests beyond the stack resolve to the closest available depth.
		expect(selectItemDropSlot(stacked, 3 * ROW, 0)?.listId).toBe("outer");
		expect(selectItemDropSlot(stacked, 3 * ROW, 5)?.listId).toBe("inner");
	});

	it("a nest candidate under the item above unlocks by dragging right, at rest y", () => {
		// Dragging B: its dead top edge and the nest-under-A boundary share
		// y = 22. Parked, the dead edge wins (no target); one indent right, the
		// nest target takes it — drag-to-indent without vertical travel.
		const withNest: MeasuredItemSlot[] = [
			...dragB,
			slot(ROW, {
				kind: "nest",
				listId: "list",
				slot: 1,
				parentItemIndex: 0,
				depth: 2,
				edge: "bottom",
			}),
		];
		expect(selectItemDropSlot(withNest, rest - ROW / 2, 1)).toBeNull();
		const nest = selectItemDropSlot(withNest, rest - ROW / 2, 2);
		expect(nest?.kind).toBe("nest");
		expect(nest?.parentItemIndex).toBe(0);
	});
});

describe("enumerateItemSlotCandidates (cross-list, subtree exclusion)", () => {
	/** Outer list of three, the middle item carrying a lone nested bullet. */
	const doc: PromptDocument = {
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "targeting-doc",
		nodes: [
			{
				type: "bulletList",
				id: "outer",
				items: [
					{ type: "listItem", id: "o1", content: ["First"] },
					{
						type: "listItem",
						id: "o2",
						content: ["Second"],
						children: [
							{
								type: "bulletList",
								id: "inner",
								items: [
									{ type: "listItem", id: "i1", content: ["Lone nested"] },
								],
							},
						],
					},
					{ type: "listItem", id: "o3", content: ["Third"] },
				],
			},
		],
	};
	const lines = buildXmlLineModel(createPromptEditorModel(doc, {}).prompt).lines;
	const itemRanges = computeItemRanges(lines);

	it("a lone nested bullet has ONLY dead slots at home but real targets everywhere else", () => {
		const range = itemRanges.get("i1")!;
		const candidates = enumerateItemSlotCandidates(lines, itemRanges, {
			listId: "inner",
			fromIndex: 0,
			count: 1,
			rowRange: range,
		});
		// Its own two edges: present, dead — the indicator never lights there.
		const home = candidates.filter((c) => c.listId === "inner" && c.kind === "slot");
		expect(home.map((c) => c.slot)).toEqual([0, 1]);
		expect(home.every((c) => c.dead)).toBe(true);
		// The outer list contributes live slots — the bullet can leave its list
		// (which is also how it un-nests).
		const outer = candidates.filter(
			(c) => c.listId === "outer" && c.kind === "slot" && !c.dead,
		);
		expect(outer.map((c) => c.slot)).toEqual([0, 1, 2, 3]);
		// And items without sub-lists (o1, o3) offer nest targets one deeper.
		const nests = candidates.filter((c) => c.kind === "nest");
		expect(nests.map((c) => c.parentItemIndex)).toEqual([0, 2]);
		const outerDepth = lines[itemRanges.get("o1")!.start]!.depth;
		expect(nests.every((c) => c.depth === outerDepth + 1)).toBe(true);
	});

	it("a carried nested list offers no targets: its slots ride inside the drag", () => {
		// Dragging o2 carries `inner`; every inner boundary (and the nest slot
		// under i1) lies inside the lifted subtree and is erased.
		const range = itemRanges.get("o2")!;
		const candidates = enumerateItemSlotCandidates(lines, itemRanges, {
			listId: "outer",
			fromIndex: 1,
			count: 1,
			rowRange: range,
		});
		expect(candidates.some((c) => c.listId === "inner")).toBe(false);
		expect(
			candidates.some((c) => c.kind === "nest" && c.parentItemIndex === 1),
		).toBe(false);
		const home = candidates.filter((c) => c.kind === "slot");
		expect(home.map((c) => [c.slot, c.dead])).toEqual([
			[0, false],
			[1, true],
			[2, true],
			[3, false],
		]);
	});
});

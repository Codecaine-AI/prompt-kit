import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { BulletListNode, PromptDocument } from "../../../index";
import { canonicalizePrompt } from "../../../index";
import {
	applyStep,
	createPromptEditorModel,
	invertStep,
	type PromptStep,
} from "../../editors";
import { PromptFlowXml } from ".";
import { itemDropSlots } from "./drag-controller";
import { computeItemRanges } from "./node-geometry";
import { buildXmlLineModel } from "../xml-line-model";

afterEach(() => {
	cleanup();
});

/**
 * A section-nested list with a MULTI-LINE item (nested child paragraph) inside
 * the group range, so group extents cover more rows than items, plus a second
 * list (cross-list selections must not group) and a trailing paragraph.
 */
const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "group-drag-doc",
	nodes: [
		{
			type: "section",
			tag: "steps",
			id: "sec-1",
			children: [
				{
					type: "orderedList",
					id: "list-1",
					items: [
						{ type: "listItem", id: "item-a", content: ["Alpha"] },
						{ type: "listItem", id: "item-b", content: ["Bravo"] },
						{
							type: "listItem",
							id: "item-c",
							content: ["Charlie"],
							children: [
								{
									type: "paragraph",
									id: "para-c",
									content: ["Charlie detail"],
								},
							],
						},
						{ type: "listItem", id: "item-d", content: ["Delta"] },
						{ type: "listItem", id: "item-e", content: ["Echo"] },
					],
				},
				{
					type: "bulletList",
					id: "list-2",
					items: [
						{ type: "listItem", id: "other-1", content: ["Other one"] },
						{ type: "listItem", id: "other-2", content: ["Other two"] },
					],
				},
				{ type: "paragraph", id: "para-tail", content: ["Not a list"] },
			],
		},
	],
};

function renderFlow(
	onPromptChange: (
		next: PromptDocument,
		focusId?: string,
		steps?: PromptStep[],
	) => void = () => {},
) {
	const model = createPromptEditorModel(prompt, {});
	return render(
		<PromptFlowXml
			prompt={model.prompt}
			model={model}
			onSelectNode={() => {}}
			onPromptChange={(next, focusId, steps) =>
				onPromptChange(next, focusId, steps as PromptStep[] | undefined)
			}
		/>,
	);
}

function itemRow(itemId: string): HTMLElement {
	return document.querySelector<HTMLElement>(
		`[data-prompt-node-id="${itemId}"][data-prompt-row-role="item"]`,
	)!;
}

function gripOf(row: HTMLElement): HTMLElement {
	return row.querySelector<HTMLElement>(
		'[data-prompt-affordance="item-handle"] button',
	)!;
}

/** Anchors the item selection by clicking the item's marker (starts an edit). */
function anchorOn(itemId: string): void {
	const marker = itemRow(itemId).querySelector<HTMLElement>(
		"[data-prompt-row-text] span",
	)!;
	fireEvent.click(marker);
}

function selectedIds(): string[] {
	return Array.from(
		document.querySelectorAll<HTMLElement>("[data-prompt-row-selected]"),
	).map((row) => row.getAttribute("data-prompt-node-id") ?? "");
}

/** Selects the item run anchor→head via click + shift-click. */
function selectRange(anchorId: string, headId: string): void {
	anchorOn(anchorId);
	fireEvent.click(itemRow(headId), { shiftKey: true });
}

describe("PromptFlowXml multi-item selection (shift-click)", () => {
	it("shift-click extends from the anchor item and paints every row of the range's extents", () => {
		renderFlow();

		selectRange("item-b", "item-d");
		// Items b..d plus the multi-line item's nested child row — the group's
		// full visual extent takes the selection treatment.
		expect(selectedIds()).toEqual(["item-b", "item-c", "para-c", "item-d"]);
		// The shift-click never opened an editor.
		expect(document.querySelector("textarea")).toBeNull();
	});

	it("extends in either direction (head above the anchor)", () => {
		renderFlow();

		selectRange("item-d", "item-b");
		expect(selectedIds()).toEqual(["item-b", "item-c", "para-c", "item-d"]);
	});

	it("without an anchor in the same list, shift-click starts a fresh single-item range", () => {
		renderFlow();

		fireEvent.click(itemRow("item-d"), { shiftKey: true });
		expect(selectedIds()).toEqual(["item-d"]);
	});

	it("never groups across lists: a cross-list shift-click restarts in the clicked list", () => {
		renderFlow();

		anchorOn("item-b");
		fireEvent.click(itemRow("other-2"), { shiftKey: true });
		expect(selectedIds()).toEqual(["other-2"]);
	});

	it("clicking empty surface clears the range", () => {
		renderFlow();

		selectRange("item-b", "item-d");
		expect(selectedIds().length).toBeGreaterThan(0);
		fireEvent.click(document.querySelector("section")!);
		expect(selectedIds()).toEqual([]);
	});
});

describe("PromptFlowXml group drag (selected run moves as one object)", () => {
	it("ghost carries the whole group: first selected line plus '+N more' across the extents", () => {
		renderFlow();

		selectRange("item-b", "item-d");
		fireEvent.mouseEnter(itemRow("item-c"));
		fireEvent.pointerDown(gripOf(itemRow("item-c")), {
			button: 0,
			clientX: 5,
			clientY: 5,
		});

		// Group extents: item-b, item-c, para-c, item-d = 4 rows → "+3 more".
		const more = Array.from(document.querySelectorAll("span")).find(
			(el) => el.textContent === "+3 more",
		);
		expect(more).toBeTruthy();
		// The ghost's visible line is the FIRST selected item's.
		const ghost = more!.closest("div")!;
		expect(ghost.textContent).toContain("Bravo");

		// Every group row dims as lifted out; rows outside the group do not.
		for (const id of ["item-b", "item-c", "para-c", "item-d"]) {
			expect(
				document
					.querySelector<HTMLElement>(`[data-prompt-node-id="${id}"]`)!
					.style.opacity,
			).toContain("var(--prompt-editor-drag-opacity");
		}
		expect(itemRow("item-a").style.opacity).toBe("");
		expect(itemRow("item-e").style.opacity).toBe("");

		fireEvent.pointerUp(window);
	});

	it("commits the group in order as ONE invertible step, and undo restores the original", () => {
		let committed: {
			prompt: PromptDocument;
			steps: PromptStep[] | undefined;
		} | null = null;
		renderFlow((next, _focusId, steps) => {
			committed = { prompt: next, steps };
		});

		selectRange("item-b", "item-d");
		fireEvent.mouseEnter(itemRow("item-c"));
		fireEvent.pointerDown(gripOf(itemRow("item-c")), {
			button: 0,
			clientX: 5,
			clientY: 5,
		});
		// Every rect is zero in happy-dom, so the nearest boundary is the first
		// offered slot — slot 0, before "Alpha".
		fireEvent.pointerMove(window, { clientY: 0 });
		fireEvent.pointerUp(window);

		expect(committed).not.toBeNull();
		const { prompt: next, steps } = committed!;
		const section = next.nodes[0] as Extract<
			PromptDocument["nodes"][number],
			{ type: "section" }
		>;
		const list = section.children[0] as BulletListNode;
		// The run lands at the front IN ORDER.
		expect(list.items.map((item) => item.id)).toEqual([
			"item-b",
			"item-c",
			"item-d",
			"item-a",
			"item-e",
		]);
		// The multi-line member kept its nested child through the move.
		expect(list.items[1]!.children).toHaveLength(1);

		// One invertible update step; inverting restores the original document.
		expect(steps).toHaveLength(1);
		expect(steps![0]!.op).toBe("update");
		expect(canonicalizePrompt(applyStep(next, invertStep(steps![0]!)))).toBe(
			canonicalizePrompt(prompt),
		);
	});

	it("grabbing an UNSELECTED item's handle drags just that item and retires the group", () => {
		let committed: {
			prompt: PromptDocument;
			steps: PromptStep[] | undefined;
		} | null = null;
		renderFlow((next, _focusId, steps) => {
			committed = { prompt: next, steps };
		});

		selectRange("item-b", "item-c");
		fireEvent.mouseEnter(itemRow("item-e"));
		fireEvent.pointerDown(gripOf(itemRow("item-e")), {
			button: 0,
			clientX: 5,
			clientY: 5,
		});
		// The group selection retired the moment the outside handle was grabbed.
		expect(selectedIds()).toEqual([]);
		fireEvent.pointerMove(window, { clientY: 0 });
		fireEvent.pointerUp(window);

		const section = committed!.prompt.nodes[0] as Extract<
			PromptDocument["nodes"][number],
			{ type: "section" }
		>;
		const list = section.children[0] as BulletListNode;
		// Only the grabbed item moved; the formerly selected run stayed put.
		expect(list.items.map((item) => item.id)).toEqual([
			"item-e",
			"item-a",
			"item-b",
			"item-c",
			"item-d",
		]);
		expect(committed!.steps).toHaveLength(1);
	});
});

describe("PromptFlowXml item-run body drag + one-object paint", () => {
	it("a shift-click run paints the single ring; member rows drop their washes and invite dragging", () => {
		renderFlow();

		selectRange("item-b", "item-d");
		// ONE contiguous overlay for the whole run — shift-click item runs are
		// the same structural-selection state the marquee produces.
		const rings = document.querySelectorAll<HTMLElement>(
			"[data-prompt-selection-ring]",
		);
		expect(rings.length).toBe(1);
		for (const id of ["item-b", "item-c", "para-c", "item-d"]) {
			const row = document.querySelector<HTMLElement>(
				`[data-prompt-node-id="${id}"]`,
			)!;
			// The machine stamp stays; the per-row wash and accent bar are gone
			// (the ring is the paint), and the body shows the grab cursor.
			expect(row.hasAttribute("data-prompt-row-selected")).toBe(true);
			expect(row.querySelector(".absolute.inset-0")).toBeNull();
			expect(row.querySelector('[class*="w-[2px]"]')).toBeNull();
			expect(row.className).toContain("cursor-grab");
		}
		expect(itemRow("item-a").className).not.toContain("cursor-grab");
	});

	it("a PLAIN drag on the run's body lifts the group and commits it as ONE step", () => {
		let committed: {
			prompt: PromptDocument;
			steps: PromptStep[] | undefined;
		} | null = null;
		renderFlow((next, _focusId, steps) => {
			committed = { prompt: next, steps };
		});

		selectRange("item-b", "item-d");
		// Plain press on a member row's body (no handle, no modifier)…
		fireEvent.pointerDown(itemRow("item-c"), {
			button: 0,
			clientX: 5,
			clientY: 5,
		});
		// …crossing the threshold lifts the group exactly like a handle grab:
		// 4 carried rows → "+3 more", first visible line from item-b.
		fireEvent.pointerMove(window, { clientX: 5, clientY: 40 });
		const more = Array.from(document.querySelectorAll("span")).find(
			(el) => el.textContent === "+3 more",
		);
		expect(more).toBeTruthy();
		expect(more!.closest("div")!.textContent).toContain("Bravo");

		// Zero rects: nearest boundary = slot 0, before "Alpha".
		fireEvent.pointerMove(window, { clientY: 0 });
		fireEvent.pointerUp(window);

		expect(committed).not.toBeNull();
		const { prompt: next, steps } = committed!;
		const section = next.nodes[0] as Extract<
			PromptDocument["nodes"][number],
			{ type: "section" }
		>;
		const list = section.children[0] as BulletListNode;
		expect(list.items.map((item) => item.id)).toEqual([
			"item-b",
			"item-c",
			"item-d",
			"item-a",
			"item-e",
		]);
		expect(steps).toHaveLength(1);
		expect(steps![0]!.op).toBe("update");
	});
});

describe("itemDropSlots (group-aware boundaries)", () => {
	const lines = buildXmlLineModel(
		createPromptEditorModel(prompt, {}).prompt,
	).lines;
	const itemRanges = computeItemRanges(lines);

	it("a single-item drag offers every boundary: one per item plus after-last", () => {
		const slots = itemDropSlots(lines, itemRanges, "list-1", 1, 1);
		expect(slots.map((slot) => slot.slot)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("a group drag excludes the slots strictly inside the run, keeping its edges", () => {
		// Run = items 1..3 → interior boundaries 2 and 3 vanish; the run's own
		// edges (1 and 4) remain as the "put it back" no-op drops.
		const slots = itemDropSlots(lines, itemRanges, "list-1", 1, 3);
		expect(slots.map((slot) => slot.slot)).toEqual([0, 1, 4, 5]);
	});

	it("the after-last boundary sits under the last item's full extent", () => {
		const slots = itemDropSlots(lines, itemRanges, "list-1", 0, 1);
		const last = slots[slots.length - 1]!;
		expect(last.edge).toBe("bottom");
		const lastItemRange = itemRanges.get("item-e")!;
		expect(last.rowIndex).toBe(lastItemRange.end);
	});
});

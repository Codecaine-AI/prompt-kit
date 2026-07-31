import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import type { BulletListNode, PromptDocument } from "../../../index";
import { canonicalizePrompt } from "../../../index";
import {
	applyStep,
	createPromptEditorModel,
	invertStep,
	type PromptStep,
} from "../../editors";
import { PromptFlowXml } from ".";
import { dragHandleRailWidth } from "./drag-handle";
import { EDITOR_METRICS } from "../../surface/editor-surface";

afterEach(() => {
	cleanup();
});

/**
 * A section-nested list (the common shape). The MULTI-LINE item — one with a
 * nested child paragraph — sits at index 1, NOT index 0: the list's first item
 * row is the block's anchor row, whose gutter slot belongs to the block grip
 * (collision rule), so the item-handle behaviors are exercised on rows that
 * actually mount one. A trailing paragraph provides "non-list territory".
 */
const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "item-drag-doc",
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
						{ type: "listItem", id: "item-1", content: ["First"] },
						{
							type: "listItem",
							id: "item-2",
							content: ["Second"],
							children: [
								{
									type: "paragraph",
									id: "para-1",
									content: ["Second detail"],
								},
							],
						},
						{ type: "listItem", id: "item-3", content: ["Third"] },
					],
				},
				{ type: "paragraph", id: "para-2", content: ["Not a list"] },
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

function handleOf(row: HTMLElement): HTMLElement {
	return row.querySelector<HTMLElement>(
		'[data-prompt-affordance="item-handle"]',
	)!;
}

function gripOf(row: HTMLElement): HTMLElement {
	return row.querySelector<HTMLElement>(
		'[data-prompt-affordance="item-handle"] button',
	)!;
}

describe("PromptFlowXml item drag handle (Notion model)", () => {
	it("mounts exactly ONE handle — on the hovered item's row, floating left of its content", () => {
		renderFlow();

		// Nothing hovered: no handle anywhere (and no block cluster either —
		// the ONE handle only exists for the unit under the pointer).
		expect(
			document.querySelectorAll('[data-prompt-affordance="item-handle"]'),
		).toHaveLength(0);

		fireEvent.mouseEnter(itemRow("item-2"));
		const handles = document.querySelectorAll<HTMLElement>(
			'[data-prompt-affordance="item-handle"]',
		);
		expect(handles).toHaveLength(1);
		const handle = handles[0]!;
		// Mounted on the hovered item's own row, OUTSIDE the text flow.
		expect(itemRow("item-2").contains(handle)).toBe(true);
		expect(handle.closest("[data-prompt-row-text]")).toBeNull();
		// The rail spans from the row's left edge to just short of the item's
		// content start (gutter + body padding + indent), so the grip floats in
		// the indentation margin left of the marker. happy-dom drops calc()
		// widths from serialized style, so assert the indent stamp plus the
		// width formula it feeds.
		const indent = handle.getAttribute("data-prompt-handle-indent");
		expect(indent).not.toBeNull();
		expect(dragHandleRailWidth(Number(indent))).toContain(
			"var(--prompt-editor-gutter-width, 36px)",
		);
		// Padded hit box with grab cursors around the smaller item glyph.
		const button = handle.querySelector("button")!;
		expect(button.className).toContain("w-7");
		expect(button.className).toContain("cursor-grab");
		expect(button.className).toContain("active:cursor-grabbing");
		// Smaller glyph than the block grip's 20px (happy-dom drops var()
		// width/height styles, so assert the metric the style feeds).
		expect(button.querySelector("svg")).toBeTruthy();
		expect(EDITOR_METRICS.itemGripSize).toContain(
			"var(--prompt-editor-item-grip-size, 14px)",
		);
		// No floating hint overlays: a plain title attribute is the ceiling.
		expect(button.getAttribute("title")).toBe("Drag to reorder item");
	});

	it("the deepest unit wins: every item row resolves to the ITEM — including the list's first row", () => {
		renderFlow();

		// Under the one-handle model the list block never owns a hover handle
		// (all its rendered rows belong to its items), so even the FIRST item
		// row mounts the item handle, not the block cluster.
		fireEvent.mouseEnter(itemRow("item-1"));
		const handle = document.querySelector<HTMLElement>(
			'[data-prompt-affordance="item-handle"]',
		)!;
		expect(handle).toBeTruthy();
		expect(itemRow("item-1").contains(handle)).toBe(true);
		expect(
			document.querySelector('[data-prompt-affordance="block-cluster"]'),
		).toBeNull();
	});

	it("nested child rows resolve to their ITEM (handle on its first row); block rows get the block grip", () => {
		renderFlow();

		// Hovering the multi-line item's nested child row mounts the handle on
		// the ITEM's marker row: the whole extent is one hover target.
		const childRow = document.querySelector<HTMLElement>(
			'[data-prompt-node-id="para-1"]',
		)!;
		fireEvent.mouseEnter(childRow);
		let handle = document.querySelector<HTMLElement>(
			'[data-prompt-affordance="item-handle"]',
		)!;
		expect(itemRow("item-2").contains(handle)).toBe(true);

		// Hovering a plain block row swaps to the BLOCK grip — still exactly
		// one handle in the surface.
		const proseRow = document.querySelector<HTMLElement>(
			'[data-prompt-node-id="para-2"]',
		)!;
		fireEvent.mouseEnter(proseRow);
		expect(
			document.querySelector('[data-prompt-affordance="item-handle"]'),
		).toBeNull();
		const cluster = document.querySelector<HTMLElement>(
			'[data-prompt-affordance="block-cluster"]',
		)!;
		expect(cluster).toBeTruthy();
		expect(proseRow.contains(cluster)).toBe(true);
	});

	it("ghost is a compact token: rendered first line plus '+N more' — no line badge", () => {
		renderFlow();

		fireEvent.mouseEnter(itemRow("item-2"));
		fireEvent.pointerDown(gripOf(itemRow("item-2")), {
			button: 0,
			clientX: 5,
			clientY: 5,
		});

		// Multi-line item (marker row + child row): first line + "+1 more".
		const more = Array.from(document.querySelectorAll("span")).find(
			(el) => el.textContent === "+1 more",
		);
		expect(more).toBeTruthy();
		// The old "N lines" badge is gone.
		expect(
			Array.from(document.querySelectorAll("span")).some((el) =>
				/^\d+ lines?$/.test(el.textContent ?? ""),
			),
		).toBe(false);

		fireEvent.pointerUp(window);
	});

	it("commits a reorder as ONE invertible update step, and inverting it restores the original order", () => {
		let committed: {
			prompt: PromptDocument;
			steps: PromptStep[] | undefined;
		} | null = null;
		renderFlow((next, _focusId, steps) => {
			committed = { prompt: next, steps };
		});

		// Drag "Second" (index 1). Every row rect is zero in happy-dom, so the
		// nearest boundary is the FIRST candidate — slot 0, before "First".
		fireEvent.mouseEnter(itemRow("item-2"));
		fireEvent.pointerDown(gripOf(itemRow("item-2")), {
			button: 0,
			clientX: 5,
			clientY: 5,
		});
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
			"item-2",
			"item-1",
			"item-3",
		]);
		// The multi-line item kept its nested child through the reorder.
		expect(list.items[0]!.children).toHaveLength(1);

		// Undo seam: exactly one update step, and its inverse restores the
		// original document — a drag-drop undoes as one action.
		expect(steps).toHaveLength(1);
		expect(steps![0]!.op).toBe("update");
		expect(canonicalizePrompt(applyStep(next, invertStep(steps![0]!)))).toBe(
			canonicalizePrompt(prompt),
		);
	});

	it("cancels when released over non-list territory: no slot, no commit", () => {
		let calls = 0;
		renderFlow(() => {
			calls += 1;
		});

		fireEvent.mouseEnter(itemRow("item-3"));
		fireEvent.pointerDown(gripOf(itemRow("item-3")), {
			button: 0,
			clientX: 5,
			clientY: 5,
		});
		// Far below the list's vertical band (rects are all zero): the drop
		// indicator names no slot, so release changes nothing.
		fireEvent.pointerMove(window, { clientY: 5000 });
		fireEvent.pointerUp(window);

		expect(calls).toBe(0);
	});

	it("never starts an edit session from the handle: pointer-down mounts no textarea", () => {
		renderFlow();

		fireEvent.mouseEnter(itemRow("item-3"));
		fireEvent.pointerDown(gripOf(itemRow("item-3")), {
			button: 0,
			clientX: 5,
			clientY: 5,
		});
		expect(document.querySelector("textarea")).toBeNull();
		fireEvent.pointerUp(window);
	});
});

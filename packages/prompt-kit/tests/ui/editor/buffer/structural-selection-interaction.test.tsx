// Structural-selection interaction on the buffer surface — the Notion
// plain-drag model (2026-08-07). A plain drag WITHIN one unit's text is the
// browser's own selection (its single-row release maps into the inline
// editor with the range pre-selected); a plain drag CROSSING unit boundaries
// becomes a live OBJECT selection (the structural ring), kept on release.
// Cmd+click is a plain click — the modifier special case is retired.
// Shift-click item ranges are unchanged (see item-group-drag.test.tsx for
// range + multi-unit coverage).
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { PromptDocument, SectionNode } from "../../../../src/index";
import { canonicalizePrompt } from "../../../../src/index";
import { createPromptEditorModel } from "../../../../src/ui/editor/model";
import {
	applySteps,
	revertSteps,
	type PromptStep,
} from "../../../../src/ui/editor/transactions";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";

const realGetSelection = window.getSelection;

afterEach(() => {
	window.getSelection = realGetSelection;
	cleanup();
});

/** Four top-level paragraphs: the flat block-run playground. */
const flatPrompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "structsel-flat-doc",
	nodes: [
		{ type: "paragraph", id: "para-x", content: ["Xray"] },
		{ type: "paragraph", id: "para-y", content: ["Yankee"] },
		{ type: "paragraph", id: "para-z", content: ["Zulu"] },
		{ type: "paragraph", id: "para-w", content: ["Whiskey"] },
	],
};

/** A section-nested list plus siblings: the item-run playground. */
const listPrompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "structsel-list-doc",
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
						{ type: "listItem", id: "item-c", content: ["Charlie"] },
						{ type: "listItem", id: "item-d", content: ["Delta"] },
						{ type: "listItem", id: "item-e", content: ["Echo"] },
					],
				},
				{ type: "paragraph", id: "para-tail", content: ["Not a list"] },
			],
		},
	],
};

type Commit = { prompt: PromptDocument; focusId?: string; steps?: PromptStep[] };

function renderFlow(source: PromptDocument) {
	const commits: Commit[] = [];
	const model = createPromptEditorModel(source, {});
	const view = render(
		<PromptFlowXml
			prompt={model.prompt}
			model={model}
			onSelectNode={() => {}}
			onPromptChange={(next, focusId, steps) =>
				commits.push({
					prompt: next,
					focusId,
					steps: steps as PromptStep[] | undefined,
				})
			}
		/>,
	);
	return { view, commits, prompt: model.prompt };
}

function rowsEl(): HTMLElement {
	return document.querySelector<HTMLElement>("[data-prompt-flow-rows]")!;
}

function selectedIds(): string[] {
	return Array.from(
		document.querySelectorAll<HTMLElement>("[data-prompt-row-selected]"),
	)
		.map((row) => row.getAttribute("data-prompt-node-id") ?? "")
		.filter((id) => id.length > 0);
}

function nodeRow(id: string): HTMLElement {
	return document.querySelector<HTMLElement>(`[data-prompt-node-id="${id}"]`)!;
}

const PITCH = 20;

/**
 * Gives every row a real vertical geometry (happy-dom's defaults are all
 * zero): row i occupies [i * 20, i * 20 + 20). Flat-doc rows: para-x=0,
 * gap=1, para-y=2, gap=3, para-z=4, gap=5, para-w=6.
 */
function layoutRows(pitch = PITCH) {
	document.querySelectorAll<HTMLElement>("[data-row-index]").forEach((row) => {
		const index = Number(row.dataset.rowIndex);
		Object.defineProperty(row, "offsetTop", {
			value: index * pitch,
			configurable: true,
		});
		Object.defineProperty(row, "offsetHeight", {
			value: pitch,
			configurable: true,
		});
	});
}

/** Vertical mid-point of the row rendering `id` (synthetic geometry). */
function rowMidY(id: string): number {
	return Number(nodeRow(id).getAttribute("data-row-index")) * PITCH + PITCH / 2;
}

/**
 * A plain press on the surface at container y (viewport coords — happy-dom
 * rects are all zero, so container coords equal viewport coords), dragged
 * through `path` and optionally released at the last point.
 */
function dragThrough(
	fromY: number,
	path: number[],
	{ release = true, modifiers = {} as { metaKey?: boolean } } = {},
) {
	fireEvent.pointerDown(rowsEl(), {
		button: 0,
		clientX: 2,
		clientY: fromY,
		...modifiers,
	});
	for (const y of path) {
		fireEvent.pointerMove(window, { clientX: 2, clientY: y });
	}
	const endY = path[path.length - 1] ?? fromY;
	if (release) fireEvent.pointerUp(window, { clientX: 2, clientY: endY });
}

/** Cross-boundary drag from one unit's row to another's, released. */
function dragSelect(fromId: string, toId: string) {
	dragThrough(rowMidY(fromId), [rowMidY(toId)]);
}

/**
 * Rings EXACTLY one unit through the drag gesture: cross into a neighbor
 * row and come back — the completed gesture's band is the anchor row alone,
 * so the run is just the anchor unit (the anchor-return rule).
 */
function ringSingle(id: string, viaY: number) {
	dragThrough(rowMidY(id), [viaY, rowMidY(id)]);
}

describe("PromptFlowXml plain-drag object selection", () => {
	it("a drag CROSSING unit boundaries selects the covered run LIVE and keeps it on release", () => {
		renderFlow(flatPrompt);
		layoutRows();
		// Press in para-x, drag into para-y: the band resolves ON THE MOVE…
		dragThrough(5, [45], { release: false });
		expect(selectedIds()).toEqual(["para-x", "para-y"]);
		// …no rectangle overlay exists (the marquee stays retired)…
		expect(document.querySelector("[data-prompt-marquee]")).toBeNull();
		// …and keeps resolving as the pointer travels…
		fireEvent.pointerMove(window, { clientX: 2, clientY: 85 });
		expect(selectedIds()).toEqual(["para-x", "para-y", "para-z"]);
		// …then the release KEEPS the run.
		fireEvent.pointerUp(window, { clientX: 2, clientY: 85 });
		expect(selectedIds()).toEqual(["para-x", "para-y", "para-z"]);
		expect(
			document
				.querySelector("[data-prompt-selection-ring]")
				?.getAttribute("data-prompt-selection-ring"),
		).toBe("0-4");
	});

	it("a drag WITHIN one unit never creates a run and never suppresses native selection", () => {
		renderFlow(flatPrompt);
		layoutRows();
		// At rest: no user-select suppression on the container.
		expect(rowsEl().style.userSelect).toBe("");
		// Travel inside para-x's own row (and into the adjacent gap): the
		// browser's own text selection is the gesture — the surface stays out.
		dragThrough(5, [15, 25], { release: false });
		expect(selectedIds()).toEqual([]);
		expect(rowsEl().style.userSelect).toBe("");
		expect(document.querySelector("[data-prompt-selection-ring]")).toBeNull();
		fireEvent.pointerUp(window, { clientX: 2, clientY: 25 });
		expect(selectedIds()).toEqual([]);
	});

	it("crossing a boundary clears native selection and suppresses user-select ONLY while the gesture lives", () => {
		renderFlow(flatPrompt);
		layoutRows();
		let cleared = 0;
		const fakeSelection = {
			isCollapsed: true,
			rangeCount: 0,
			getRangeAt: () => {
				throw new Error("no ranges");
			},
			removeAllRanges: () => {
				cleared += 1;
			},
		} as unknown as Selection;
		window.getSelection = () => fakeSelection;

		dragThrough(5, [15], { release: false });
		// Within-unit phase: the surface never touches the selection.
		expect(cleared).toBe(0);
		fireEvent.pointerMove(window, { clientX: 2, clientY: 45 });
		// Structural phase: native selection cleared, user-select off…
		expect(cleared).toBeGreaterThan(0);
		expect(rowsEl().style.userSelect).toBe("none");
		fireEvent.pointerUp(window, { clientX: 2, clientY: 45 });
		// …and released with the gesture (the kept run needs no suppression).
		expect(rowsEl().style.userSelect).toBe("");
		expect(selectedIds()).toEqual(["para-x", "para-y"]);
	});

	it("a gesture that ends back on the anchor unit rings JUST the anchor unit", () => {
		renderFlow(flatPrompt);
		layoutRows();
		// para-y → para-z → back to para-y: the completed band is row 2 alone.
		ringSingle("para-y", 85);
		expect(selectedIds()).toEqual(["para-y"]);
		expect(
			document
				.querySelector("[data-prompt-selection-ring]")
				?.getAttribute("data-prompt-selection-ring"),
		).toBe("2-2");
	});

	it("the release click is swallowed once; the NEXT plain click clears", () => {
		renderFlow(flatPrompt);
		layoutRows();
		dragSelect("para-x", "para-y");
		expect(selectedIds()).toEqual(["para-x", "para-y"]);

		const section = document.querySelector("section")!;
		// The click the release itself produced must not clear the selection…
		fireEvent.click(section);
		expect(selectedIds()).toEqual(["para-x", "para-y"]);
		// …but a genuine follow-up click does.
		fireEvent.click(section);
		expect(selectedIds()).toEqual([]);
	});

	it("Escape MID-GESTURE abandons the band; further travel selects nothing", () => {
		renderFlow(flatPrompt);
		layoutRows();
		dragThrough(5, [45], { release: false });
		expect(selectedIds()).toEqual(["para-x", "para-y"]);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(selectedIds()).toEqual([]);
		expect(rowsEl().style.userSelect).toBe("");
		fireEvent.pointerMove(window, { clientX: 2, clientY: 85 });
		expect(selectedIds()).toEqual([]);
		fireEvent.pointerUp(window, { clientX: 2, clientY: 85 });
		expect(selectedIds()).toEqual([]);
	});

	it("Escape clears the kept selection after release", () => {
		renderFlow(flatPrompt);
		layoutRows();
		dragSelect("para-x", "para-y");
		expect(selectedIds()).toEqual(["para-x", "para-y"]);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(selectedIds()).toEqual([]);
	});

	it("Cmd+click behaves as a PLAIN click (no ring), and Cmd+drag as a plain drag", () => {
		renderFlow(flatPrompt);
		layoutRows();
		// Cmd+click: no structural selection, no editor from the press itself…
		fireEvent.pointerDown(rowsEl(), {
			button: 0,
			metaKey: true,
			clientX: 2,
			clientY: 5,
		});
		fireEvent.pointerUp(window, { clientX: 2, clientY: 5 });
		expect(selectedIds()).toEqual([]);
		// …and the follow-up Cmd+click on text enters edit exactly like plain.
		const text = nodeRow("para-x").querySelector<HTMLElement>(
			"[data-prompt-row-text] span",
		)!;
		fireEvent.click(text, { metaKey: true });
		expect(document.querySelector("textarea")).not.toBeNull();
		fireEvent.keyDown(window, { key: "Escape" });

		// Cmd+drag across a boundary selects the run — same as modifier-free.
		layoutRows();
		dragThrough(rowMidY("para-z"), [rowMidY("para-w")], {
			modifiers: { metaKey: true },
		});
		expect(selectedIds()).toEqual(["para-z", "para-w"]);
	});

	it("a sub-threshold plain release stays a plain click: no selection, click-to-edit intact", () => {
		renderFlow(flatPrompt);
		layoutRows();
		fireEvent.pointerDown(rowsEl(), { button: 0, clientX: 0, clientY: 0 });
		fireEvent.pointerMove(window, { clientX: 1, clientY: 1 });
		fireEvent.pointerUp(window, { clientX: 1, clientY: 1 });

		expect(selectedIds()).toEqual([]);

		// The follow-up click still enters edit mode exactly as before.
		const text = nodeRow("para-x").querySelector<HTMLElement>(
			"[data-prompt-row-text] span",
		)!;
		fireEvent.click(text);
		expect(document.querySelector("textarea")).not.toBeNull();
	});

	it("a drag within one LIST selects the covered item run", () => {
		renderFlow(listPrompt);
		layoutRows();
		dragSelect("item-b", "item-d");
		expect(selectedIds()).toEqual(["item-b", "item-c", "item-d"]);
	});

	it("crossing a list boundary PROMOTES to the block run at the common parent", () => {
		renderFlow(listPrompt);
		layoutRows();
		// item-e → para-tail: the partial list promotes to the WHOLE list
		// plus the sibling paragraph — one blocks-run at the section level.
		dragSelect("item-e", "para-tail");
		expect(selectedIds()).toEqual([
			"item-a",
			"item-b",
			"item-c",
			"item-d",
			"item-e",
			"para-tail",
		]);
	});

	it("selection SURVIVES a host re-render with same content, clears on genuine invalidation", () => {
		const { view } = renderFlow(flatPrompt);
		layoutRows();
		ringSingle("para-w", 85);
		expect(selectedIds()).toEqual(["para-w"]);

		// Hosts rebuild the prompt's IDENTITY every render — same content.
		const clone = createPromptEditorModel(
			JSON.parse(JSON.stringify(flatPrompt)) as PromptDocument,
			{},
		);
		view.rerender(
			<PromptFlowXml
				prompt={clone.prompt}
				model={clone}
				onSelectNode={() => {}}
				onPromptChange={() => {}}
			/>,
		);
		expect(selectedIds()).toEqual(["para-w"]);

		// A document that can no longer hold the run retires it.
		const shrunk = createPromptEditorModel(
			{ ...flatPrompt, nodes: flatPrompt.nodes.slice(0, 2) },
			{},
		);
		view.rerender(
			<PromptFlowXml
				prompt={shrunk.prompt}
				model={shrunk}
				onSelectNode={() => {}}
				onPromptChange={() => {}}
			/>,
		);
		expect(selectedIds()).toEqual([]);
	});
});

describe("PromptFlowXml structural delete (Backspace / Delete as one object)", () => {
	it("Backspace removes the drag-selected BLOCK RUN as one transaction; undo restores", () => {
		const { commits, prompt } = renderFlow(flatPrompt);
		layoutRows();
		dragSelect("para-x", "para-y");
		expect(selectedIds()).toEqual(["para-x", "para-y"]);
		fireEvent.keyDown(window, { key: "Backspace" });

		expect(commits).toHaveLength(1);
		const { prompt: next, steps } = commits[0]!;
		expect(next.nodes.map((node) => node.id)).toEqual(["para-z", "para-w"]);
		expect(steps!.every((step) => step.op === "remove")).toBe(true);
		// One transaction: replay reproduces, revert restores everything.
		expect(canonicalizePrompt(applySteps(prompt, steps!))).toBe(
			canonicalizePrompt(next),
		);
		expect(canonicalizePrompt(revertSteps(next, steps!))).toBe(
			canonicalizePrompt(prompt),
		);
		// The selection is spent.
		expect(selectedIds()).toEqual([]);
	});

	it("Delete removes a single drag-ringed block", () => {
		const { commits, prompt } = renderFlow(flatPrompt);
		layoutRows();
		ringSingle("para-y", 85);
		expect(selectedIds()).toEqual(["para-y"]);
		fireEvent.keyDown(window, { key: "Delete" });

		expect(commits).toHaveLength(1);
		const { prompt: next, steps } = commits[0]!;
		expect(next.nodes.map((node) => node.id)).toEqual([
			"para-x",
			"para-z",
			"para-w",
		]);
		expect(canonicalizePrompt(revertSteps(next, steps!))).toBe(
			canonicalizePrompt(prompt),
		);
	});

	it("Backspace removes a drag-selected ITEM run as ONE invertible update step", () => {
		const { commits, prompt } = renderFlow(listPrompt);
		layoutRows();
		dragSelect("item-b", "item-d");
		expect(selectedIds()).toEqual(["item-b", "item-c", "item-d"]);

		fireEvent.keyDown(window, { key: "Backspace" });
		const commit = commits[commits.length - 1]!;
		const section = commit.prompt.nodes[0] as SectionNode;
		const list = section.children[0] as Extract<
			SectionNode["children"][number],
			{ type: "orderedList" }
		>;
		expect(list.items.map((item) => item.id)).toEqual(["item-a", "item-e"]);
		expect(commit.steps).toHaveLength(1);
		expect(commit.steps![0]!.op).toBe("update");
		expect(canonicalizePrompt(revertSteps(commit.prompt, commit.steps!))).toBe(
			canonicalizePrompt(prompt),
		);
	});

	it("Backspace removes a SHIFT-CLICK item range exactly as before (ranges unchanged)", () => {
		const { commits, prompt } = renderFlow(listPrompt);
		// Anchor on item-b (click its text), then shift-click item-d.
		fireEvent.click(
			nodeRow("item-b").querySelector<HTMLElement>(
				"[data-prompt-row-text] span",
			)!,
		);
		fireEvent.click(nodeRow("item-d"), { shiftKey: true });
		expect(selectedIds()).toEqual(["item-b", "item-c", "item-d"]);

		fireEvent.keyDown(window, { key: "Backspace" });
		const commit = commits[commits.length - 1]!;
		const section = commit.prompt.nodes[0] as SectionNode;
		const list = section.children[0] as Extract<
			SectionNode["children"][number],
			{ type: "orderedList" }
		>;
		expect(list.items.map((item) => item.id)).toEqual(["item-a", "item-e"]);
		expect(commit.steps).toHaveLength(1);
		expect(commit.steps![0]!.op).toBe("update");
		expect(canonicalizePrompt(revertSteps(commit.prompt, commit.steps!))).toBe(
			canonicalizePrompt(prompt),
		);
	});

	it("removing ALL items removes the list itself (the keymap's empty-list rule)", () => {
		const { commits, prompt } = renderFlow(listPrompt);
		fireEvent.click(
			nodeRow("item-a").querySelector<HTMLElement>(
				"[data-prompt-row-text] span",
			)!,
		);
		fireEvent.click(nodeRow("item-e"), { shiftKey: true });
		fireEvent.keyDown(window, { key: "Backspace" });

		const commit = commits[commits.length - 1]!;
		const section = commit.prompt.nodes[0] as SectionNode;
		expect(section.children.map((child) => child.id)).toEqual(["para-tail"]);
		expect(commit.steps).toHaveLength(1);
		expect(commit.steps![0]!.op).toBe("remove");
		expect(canonicalizePrompt(revertSteps(commit.prompt, commit.steps!))).toBe(
			canonicalizePrompt(prompt),
		);
	});

	it("Backspace with an inline editor open is untouched (no structural delete fires)", () => {
		const { commits } = renderFlow(flatPrompt);
		fireEvent.click(
			nodeRow("para-x").querySelector<HTMLElement>(
				"[data-prompt-row-text] span",
			)!,
		);
		expect(document.querySelector("textarea")).not.toBeNull();
		fireEvent.keyDown(window, { key: "Backspace" });
		expect(commits).toHaveLength(0);
	});
});

describe("PromptFlowXml selected-run drag (body-move + handle interplay)", () => {
	it("a plain drag from ANY row inside the ring lifts the WHOLE run and commits ONE transaction", () => {
		const { commits, prompt } = renderFlow(flatPrompt);
		layoutRows();
		dragSelect("para-y", "para-z");
		expect(selectedIds()).toEqual(["para-y", "para-z"]);

		// Plain press INSIDE the ring — on the run's SECOND unit — arms the
		// body-move, not a new drag-selection…
		fireEvent.pointerDown(nodeRow("para-z"), {
			button: 0,
			clientX: 5,
			clientY: 85,
		});
		// …sub-threshold travel keeps everything at rest…
		fireEvent.pointerMove(window, { clientX: 6, clientY: 86 });
		expect(nodeRow("para-y").style.opacity).toBe("");
		// …and crossing the threshold lifts the ENTIRE run (both rows dim;
		// the ring band is untouched — no re-selection happened).
		fireEvent.pointerMove(window, { clientX: 5, clientY: 200 });
		expect(nodeRow("para-y").style.opacity).toContain(
			"var(--prompt-editor-drag-opacity",
		);
		expect(nodeRow("para-z").style.opacity).toContain(
			"var(--prompt-editor-drag-opacity",
		);
		expect(nodeRow("para-x").style.opacity).toBe("");

		// Zero rects: the nearest legal boundary is slot 0 (before para-x).
		fireEvent.pointerMove(window, { clientY: 0 });
		fireEvent.pointerUp(window);

		expect(commits).toHaveLength(1);
		const { prompt: next, steps } = commits[0]!;
		expect(next.nodes.map((node) => node.id)).toEqual([
			"para-y",
			"para-z",
			"para-x",
			"para-w",
		]);
		// One replayable, invertible transaction; undo restores the original.
		expect(canonicalizePrompt(applySteps(prompt, steps!))).toBe(
			canonicalizePrompt(next),
		);
		expect(canonicalizePrompt(revertSteps(next, steps!))).toBe(
			canonicalizePrompt(prompt),
		);
	});

	it("a sub-threshold press on the ring stays a plain click: click-to-edit clears the zone", () => {
		renderFlow(flatPrompt);
		layoutRows();
		ringSingle("para-y", 85);
		expect(selectedIds()).toEqual(["para-y"]);

		const text = nodeRow("para-y").querySelector<HTMLElement>(
			"[data-prompt-row-text] span",
		)!;
		fireEvent.pointerDown(text, { button: 0, clientX: 5, clientY: 50 });
		fireEvent.pointerMove(window, { clientX: 6, clientY: 51 });
		fireEvent.pointerUp(window, { clientX: 6, clientY: 51 });
		// The release stayed a click: it opens the editor and retires the
		// selection, exactly as before the body-move gesture existed.
		fireEvent.click(text);
		expect(document.querySelector("textarea")).not.toBeNull();
		expect(selectedIds()).toEqual([]);
	});

	it("a within-unit drag OUTSIDE the ring keeps the zone; a cross-boundary drag REPLACES it", () => {
		const { commits } = renderFlow(flatPrompt);
		layoutRows();
		dragSelect("para-y", "para-z");
		expect(selectedIds()).toEqual(["para-y", "para-z"]);

		// Within para-w's own row: native-selection territory, zone untouched.
		dragThrough(125, [130]);
		expect(commits).toHaveLength(0);
		expect(selectedIds()).toEqual(["para-y", "para-z"]);

		// Crossing from para-w up into para-z: a NEW band replaces the old.
		dragSelect("para-w", "para-z");
		expect(selectedIds()).toEqual(["para-z", "para-w"]);
		expect(commits).toHaveLength(0);
	});

	it("grabbing a handle OUTSIDE the run retires the selection and drags just that block", () => {
		const { commits } = renderFlow(flatPrompt);
		layoutRows();
		ringSingle("para-y", 85);
		expect(selectedIds()).toEqual(["para-y"]);

		fireEvent.mouseEnter(nodeRow("para-w"));
		const grip = document.querySelector<HTMLElement>(".prompt-editor-grip")!;
		fireEvent.pointerDown(grip, { button: 0, clientX: 5, clientY: 125 });
		expect(selectedIds()).toEqual([]);
		fireEvent.pointerMove(window, { clientY: 0 });
		fireEvent.pointerUp(window);

		expect(commits).toHaveLength(1);
		expect(commits[0]!.prompt.nodes.map((node) => node.id)).toEqual([
			"para-w",
			"para-x",
			"para-y",
			"para-z",
		]);
	});
});

describe("PromptFlowXml structural selection paints as ONE object", () => {
	it("a single ring overlay spans the selected unit; per-row washes and bars are gone", () => {
		renderFlow(flatPrompt);
		layoutRows();
		ringSingle("para-y", 85);
		expect(selectedIds()).toEqual(["para-y"]);

		// Exactly ONE overlay, stamped with the unit's row extent (row 2).
		const rings = document.querySelectorAll<HTMLElement>(
			"[data-prompt-selection-ring]",
		);
		expect(rings.length).toBe(1);
		expect(rings[0]!.getAttribute("data-prompt-selection-ring")).toBe("2-2");

		// The member row keeps the machine stamp but paints NO per-row wash
		// and no accent bar — the ring is the paint — and invites dragging.
		const row = nodeRow("para-y");
		expect(row.hasAttribute("data-prompt-row-selected")).toBe(true);
		expect(row.querySelector(".absolute.inset-0")).toBeNull();
		expect(row.querySelector('[class*="w-[2px]"]')).toBeNull();
		expect(row.className).toContain("cursor-grab");
		// Rows outside the zone carry no grab affordance.
		expect(nodeRow("para-w").className).not.toContain("cursor-grab");

		// Hovering INSIDE the zone stacks no second wash on the object…
		fireEvent.mouseEnter(nodeRow("para-y"));
		expect(nodeRow("para-y").querySelector(".absolute.inset-0")).toBeNull();
		// …while hover outside still washes as usual.
		fireEvent.mouseEnter(nodeRow("para-w"));
		expect(
			nodeRow("para-w").querySelector(".absolute.inset-0"),
		).not.toBeNull();
	});

	it("the ring retires with the selection", () => {
		renderFlow(flatPrompt);
		layoutRows();
		ringSingle("para-y", 85);
		expect(
			document.querySelector("[data-prompt-selection-ring]"),
		).not.toBeNull();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(document.querySelector("[data-prompt-selection-ring]")).toBeNull();
	});
});

describe("PromptFlowXml within-unit drag release opens the editor over the range", () => {
	/** The first text node under `el` whose content includes `needle`. */
	function textNodeWith(el: HTMLElement, needle: string): Text {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (
			let current = walker.nextNode();
			current;
			current = walker.nextNode()
		) {
			if (current.textContent?.includes(needle)) return current as Text;
		}
		throw new Error(`no text node containing ${JSON.stringify(needle)}`);
	}

	function stubSelection(range: {
		startContainer: Node;
		startOffset: number;
		endContainer: Node;
		endOffset: number;
	}) {
		let cleared = 0;
		const fake = {
			isCollapsed: false,
			rangeCount: 1,
			getRangeAt: () => range,
			removeAllRanges: () => {
				cleared += 1;
			},
		} as unknown as Selection;
		window.getSelection = () => fake;
		return { clearedCount: () => cleared };
	}

	it("a single-row highlight maps into the inline editor with the range selected", () => {
		renderFlow(flatPrompt);
		layoutRows();
		const content = nodeRow("para-x").querySelector<HTMLElement>(
			"[data-prompt-row-content]",
		)!;
		const textNode = textNodeWith(content, "Xray");
		// The drag highlighted "ray" (display offsets 1..4 of "Xray").
		const selection = stubSelection({
			startContainer: textNode,
			startOffset: 1,
			endContainer: textNode,
			endOffset: 4,
		});

		// A within-unit drag: press on the row, travel inside it, release.
		fireEvent.pointerDown(nodeRow("para-x"), {
			button: 0,
			clientX: 5,
			clientY: 5,
		});
		fireEvent.pointerMove(window, { clientX: 30, clientY: 10 });
		fireEvent.pointerUp(window, { clientX: 30, clientY: 10 });

		// The editor opened over the row with the DRAGGED range selected —
		// highlight a word, type to replace it.
		const textarea = document.querySelector("textarea")!;
		expect(textarea).not.toBeNull();
		expect(textarea.value).toBe("Xray");
		expect(textarea.selectionStart).toBe(1);
		expect(textarea.selectionEnd).toBe(4);
		// The dead DOM highlight was retired in favor of the textarea's own.
		expect(selection.clearedCount()).toBeGreaterThan(0);
		// No structural run came out of the within-unit gesture.
		expect(selectedIds()).toEqual([]);
	});

	it("an unmappable highlight (element-boundary endpoints) stays native: no editor opens", () => {
		renderFlow(flatPrompt);
		layoutRows();
		const content = nodeRow("para-x").querySelector<HTMLElement>(
			"[data-prompt-row-content]",
		)!;
		// Element-node endpoints (triple-click artifact shape).
		const selection = stubSelection({
			startContainer: content,
			startOffset: 0,
			endContainer: content,
			endOffset: 1,
		});

		fireEvent.pointerDown(nodeRow("para-x"), {
			button: 0,
			clientX: 5,
			clientY: 5,
		});
		fireEvent.pointerMove(window, { clientX: 30, clientY: 10 });
		fireEvent.pointerUp(window, { clientX: 30, clientY: 10 });

		// No editor, no clearing: the native highlight stays alive…
		expect(document.querySelector("textarea")).toBeNull();
		expect(selection.clearedCount()).toBe(0);
		// …and the release click's RowText guard keeps it that way.
		const span = nodeRow("para-x").querySelector<HTMLElement>(
			"[data-prompt-row-text] span",
		)!;
		fireEvent.click(span);
		expect(document.querySelector("textarea")).toBeNull();
	});
});

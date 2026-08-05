import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { PromptDocument, SectionNode } from "../../../../src/index";
import { canonicalizePrompt } from "../../../../src/index";
import {
	createPromptEditorModel,
} from "../../../../src/ui/editor/model";
import {
	applySteps,
	revertSteps,
	type PromptStep,
} from "../../../../src/ui/editor/transactions";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";

afterEach(() => {
	cleanup();
});

/** Four top-level paragraphs: the flat block-run playground. */
const flatPrompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "marquee-flat-doc",
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
	id: "marquee-list-doc",
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

/**
 * Drags a marquee from `from` to `to` (viewport coords — happy-dom rects are
 * all zero, so container coords equal viewport coords). Release optional so
 * live-drag states can be asserted.
 */
function dragMarquee(
	from: { x: number; y: number },
	to: { x: number; y: number },
	{ release = true }: { release?: boolean } = {},
) {
	// Command is the structural modifier: the zone only arms with it held.
	fireEvent.pointerDown(rowsEl(), {
		button: 0,
		metaKey: true,
		clientX: from.x,
		clientY: from.y,
	});
	fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y });
	if (release) fireEvent.pointerUp(window);
}

/**
 * Gives every row a real vertical geometry (happy-dom's defaults are all
 * zero): row i occupies [i * 20, i * 20 + 20).
 */
function layoutRows(pitch = 20) {
	document
		.querySelectorAll<HTMLElement>("[data-row-index]")
		.forEach((row) => {
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

describe("PromptFlowXml marquee gesture", () => {
	it("a sub-threshold release stays a plain click: no selection, click-to-edit intact", () => {
		renderFlow(flatPrompt);
		fireEvent.pointerDown(rowsEl(), { button: 0, clientX: 0, clientY: 0 });
		fireEvent.pointerMove(window, { clientX: 1, clientY: 1 });
		fireEvent.pointerUp(window);

		expect(document.querySelector("[data-prompt-marquee]")).toBeNull();
		expect(selectedIds()).toEqual([]);

		// The follow-up click still enters edit mode exactly as before.
		const text = nodeRow("para-x").querySelector<HTMLElement>(
			"[data-prompt-row-text] span",
		)!;
		fireEvent.click(text);
		expect(document.querySelector("textarea")).not.toBeNull();
	});

	it("dragging past the threshold draws the rectangle and paints the resolved run LIVE", () => {
		renderFlow(flatPrompt);
		dragMarquee({ x: 0, y: 0 }, { x: 24, y: 24 }, { release: false });

		// The visible marquee rect is up while the pointer is down…
		expect(document.querySelector("[data-prompt-marquee]")).not.toBeNull();
		// …and the covered band (all rows — zero-rect geometry) has already
		// resolved to the top-level run, painted through the selection stamps.
		for (const id of ["para-x", "para-y", "para-z", "para-w"]) {
			expect(nodeRow(id).hasAttribute("data-prompt-row-selected")).toBe(true);
		}
		// No editor opened; the gesture is selection, not caret placement.
		expect(document.querySelector("textarea")).toBeNull();

		fireEvent.pointerUp(window);
		// Release keeps the selection and retires the rectangle.
		expect(document.querySelector("[data-prompt-marquee]")).toBeNull();
		expect(selectedIds().length).toBeGreaterThan(0);
	});

	it("the zone requires Command: a PLAIN drag never starts a marquee", () => {
		renderFlow(flatPrompt);
		fireEvent.pointerDown(rowsEl(), { button: 0, clientX: 0, clientY: 0 });
		fireEvent.pointerMove(window, { clientX: 30, clientY: 30 });
		fireEvent.pointerUp(window);
		expect(document.querySelector("[data-prompt-marquee]")).toBeNull();
		expect(selectedIds()).toEqual([]);
	});

	it("Cmd+CLICK (sub-threshold) selects the unit under the cursor as one object", () => {
		renderFlow(flatPrompt);
		layoutRows();
		// Press with Cmd on row 0's band and release without crossing the
		// threshold: the unit under the press becomes the selection.
		fireEvent.pointerDown(rowsEl(), {
			button: 0,
			metaKey: true,
			clientX: 2,
			clientY: 5,
		});
		fireEvent.pointerMove(window, { clientX: 3, clientY: 6 });
		fireEvent.pointerUp(window);
		expect(selectedIds().length).toBeGreaterThan(0);
		// No caret/editor: Cmd+click is selection, not editing.
		expect(document.querySelector("textarea")).toBeNull();
	});

	it("the release click is swallowed once; the NEXT plain click clears", () => {
		renderFlow(flatPrompt);
		dragMarquee({ x: 0, y: 0 }, { x: 24, y: 24 });
		expect(selectedIds().length).toBeGreaterThan(0);

		const section = document.querySelector("section")!;
		// The click the release itself produced must not clear the selection…
		fireEvent.click(section);
		expect(selectedIds().length).toBeGreaterThan(0);
		// …but a genuine follow-up click does.
		fireEvent.click(section);
		expect(selectedIds()).toEqual([]);
	});

	it("Escape clears the structural selection", () => {
		renderFlow(flatPrompt);
		dragMarquee({ x: 0, y: 0 }, { x: 24, y: 24 });
		expect(selectedIds().length).toBeGreaterThan(0);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(selectedIds()).toEqual([]);
	});

	it("a partial band selects exactly the covered blocks (real row geometry)", () => {
		renderFlow(flatPrompt);
		layoutRows();
		// Rows: para-x=0, gap=1, para-y=2, gap=3, para-z=4, gap=5, para-w=6.
		// Band [45, 85] covers rows 2..4 → the para-y..para-z run.
		dragMarquee({ x: 0, y: 45 }, { x: 10, y: 85 });
		expect(selectedIds()).toEqual(["para-y", "para-z"]);
	});

	it("selection SURVIVES a host re-render with same content, clears on genuine invalidation", () => {
		const { view } = renderFlow(flatPrompt);
		dragMarquee({ x: 0, y: 0 }, { x: 24, y: 24 });
		expect(selectedIds().length).toBeGreaterThan(0);

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
		expect(selectedIds().length).toBeGreaterThan(0);

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
	it("Backspace removes the selected BLOCK run as one transaction; undo restores", () => {
		const { commits, prompt } = renderFlow(flatPrompt);
		dragMarquee({ x: 0, y: 0 }, { x: 24, y: 24 });
		fireEvent.keyDown(window, { key: "Backspace" });

		expect(commits).toHaveLength(1);
		const { prompt: next, steps } = commits[0]!;
		expect(next.nodes).toHaveLength(0);
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

	it("Delete removes a PARTIAL block run selected by geometry", () => {
		const { commits, prompt } = renderFlow(flatPrompt);
		layoutRows();
		dragMarquee({ x: 0, y: 45 }, { x: 10, y: 85 });
		expect(selectedIds()).toEqual(["para-y", "para-z"]);
		fireEvent.keyDown(window, { key: "Delete" });

		expect(commits).toHaveLength(1);
		const { prompt: next, steps } = commits[0]!;
		expect(next.nodes.map((node) => node.id)).toEqual(["para-x", "para-w"]);
		expect(canonicalizePrompt(revertSteps(next, steps!))).toBe(
			canonicalizePrompt(prompt),
		);
	});

	it("Backspace removes a shift-click ITEM run as ONE invertible update step", () => {
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

describe("PromptFlowXml block-run drag (selected run moves as one object)", () => {
	it("grabbing any handle inside the run lifts the whole run and commits ONE transaction", () => {
		const { commits, prompt } = renderFlow(flatPrompt);
		layoutRows();
		// Select the para-y..para-z run (rows 2..4).
		dragMarquee({ x: 0, y: 45 }, { x: 10, y: 85 });
		expect(selectedIds()).toEqual(["para-y", "para-z"]);

		// Hover a run member so its block handle mounts, then grab it.
		fireEvent.mouseEnter(nodeRow("para-y"));
		const grip = document.querySelector<HTMLElement>(".prompt-editor-grip")!;
		fireEvent.pointerDown(grip, { button: 0, clientX: 5, clientY: 45 });
		// The press only ARMS the drag; the first past-threshold move lifts it.
		fireEvent.pointerMove(window, { clientX: 5, clientY: 65 });

		// Ghost: run rows 2..4 → 3 carried lines → "+2 more" over the extent.
		const more = Array.from(document.querySelectorAll("span")).find(
			(el) => el.textContent === "+2 more",
		);
		expect(more).toBeTruthy();
		expect(more!.closest("div")!.textContent).toContain("Yankee");

		// Every run row dims as lifted out; rows outside the run do not.
		for (const id of ["para-y", "para-z"]) {
			expect(nodeRow(id).style.opacity).toContain(
				"var(--prompt-editor-drag-opacity",
			);
		}
		expect(nodeRow("para-x").style.opacity).toBe("");
		expect(nodeRow("para-w").style.opacity).toBe("");

		// Zero rects: the nearest legal boundary is the first offered slot —
		// slot 0, before para-x (interior run slots are never offered).
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

	it("a PLAIN drag on a selected row lifts the run — same ghost/dimming — and commits ONE transaction", () => {
		const { commits, prompt } = renderFlow(flatPrompt);
		layoutRows();
		dragMarquee({ x: 0, y: 45 }, { x: 10, y: 85 });
		expect(selectedIds()).toEqual(["para-y", "para-z"]);

		// Plain press (no modifier) on the selection's own body…
		fireEvent.pointerDown(nodeRow("para-y"), {
			button: 0,
			clientX: 5,
			clientY: 50,
		});
		// …sub-threshold travel keeps everything at rest…
		fireEvent.pointerMove(window, { clientX: 6, clientY: 51 });
		expect(nodeRow("para-y").style.opacity).toBe("");
		// …and crossing the threshold starts the SAME group drag a handle grab
		// inside the zone starts: compact ghost with "+N more", run dims.
		fireEvent.pointerMove(window, { clientX: 5, clientY: 80 });
		const more = Array.from(document.querySelectorAll("span")).find(
			(el) => el.textContent === "+2 more",
		);
		expect(more).toBeTruthy();
		expect(more!.closest("div")!.textContent).toContain("Yankee");
		for (const id of ["para-y", "para-z"]) {
			expect(nodeRow(id).style.opacity).toContain(
				"var(--prompt-editor-drag-opacity",
			);
		}

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
		expect(canonicalizePrompt(revertSteps(next, steps!))).toBe(
			canonicalizePrompt(prompt),
		);
	});

	it("a sub-threshold press on the selection stays a plain click: click-to-edit clears the zone", () => {
		renderFlow(flatPrompt);
		layoutRows();
		dragMarquee({ x: 0, y: 45 }, { x: 10, y: 85 });
		expect(selectedIds()).toEqual(["para-y", "para-z"]);

		const text = nodeRow("para-y").querySelector<HTMLElement>(
			"[data-prompt-row-text] span",
		)!;
		fireEvent.pointerDown(text, { button: 0, clientX: 5, clientY: 50 });
		fireEvent.pointerMove(window, { clientX: 6, clientY: 51 });
		fireEvent.pointerUp(window);
		// The release stayed a click: it opens the editor and retires the
		// selection, exactly as before the body-move gesture existed.
		fireEvent.click(text);
		expect(document.querySelector("textarea")).not.toBeNull();
		expect(selectedIds()).toEqual([]);
	});

	it("a plain drag OUTSIDE the selection stays a no-op and keeps the zone", () => {
		const { commits } = renderFlow(flatPrompt);
		layoutRows();
		dragMarquee({ x: 0, y: 45 }, { x: 10, y: 85 });

		fireEvent.pointerDown(nodeRow("para-w"), {
			button: 0,
			clientX: 5,
			clientY: 125,
		});
		fireEvent.pointerMove(window, { clientX: 5, clientY: 200 });
		// No marquee, no lift: nothing dims and no ghost badge appears.
		expect(document.querySelector("[data-prompt-marquee]")).toBeNull();
		expect(nodeRow("para-y").style.opacity).toBe("");
		expect(
			Array.from(document.querySelectorAll("span")).find((el) =>
				el.textContent?.startsWith("+"),
			),
		).toBeUndefined();
		fireEvent.pointerUp(window);
		expect(commits).toHaveLength(0);
		expect(selectedIds()).toEqual(["para-y", "para-z"]);
	});

	it("grabbing a handle OUTSIDE the run retires the selection and drags just that block", () => {
		const { commits } = renderFlow(flatPrompt);
		layoutRows();
		dragMarquee({ x: 0, y: 45 }, { x: 10, y: 85 });
		expect(selectedIds()).toEqual(["para-y", "para-z"]);

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
	it("a single ring overlay spans the run; per-row washes, bars, and gutter tints are gone", () => {
		renderFlow(flatPrompt);
		layoutRows();
		dragMarquee({ x: 0, y: 45 }, { x: 10, y: 85 });
		expect(selectedIds()).toEqual(["para-y", "para-z"]);

		// Exactly ONE overlay, stamped with the run's trimmed row extent
		// (rows 2..4: para-y, gap, para-z).
		const rings = document.querySelectorAll<HTMLElement>(
			"[data-prompt-selection-ring]",
		);
		expect(rings.length).toBe(1);
		expect(rings[0]!.getAttribute("data-prompt-selection-ring")).toBe("2-4");

		// Member rows keep the machine stamp but paint NO per-row wash and no
		// accent bar — the ring is the paint — and they invite dragging.
		for (const id of ["para-y", "para-z"]) {
			const row = nodeRow(id);
			expect(row.hasAttribute("data-prompt-row-selected")).toBe(true);
			expect(row.querySelector(".absolute.inset-0")).toBeNull();
			expect(row.querySelector('[class*="w-[2px]"]')).toBeNull();
			expect(row.className).toContain("cursor-grab");
		}
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
		dragMarquee({ x: 0, y: 0 }, { x: 24, y: 24 });
		expect(
			document.querySelector("[data-prompt-selection-ring]"),
		).not.toBeNull();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(document.querySelector("[data-prompt-selection-ring]")).toBeNull();
	});
});

// Structural-selection interaction on the buffer surface. The marquee
// RECTANGLE gesture is retired: Cmd+CLICK selects the unit under the cursor,
// shift-click extends item ranges (see item-group-drag.test.tsx for the
// range + multi-unit coverage), and any DRAG on the surface selects nothing
// structurally — a plain drag falls through to native browser text
// selection (read-only for now).
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

afterEach(() => {
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

/**
 * Gives every row a real vertical geometry (happy-dom's defaults are all
 * zero): row i occupies [i * 20, i * 20 + 20). Flat-doc rows: para-x=0,
 * gap=1, para-y=2, gap=3, para-z=4, gap=5, para-w=6.
 */
function layoutRows(pitch = 20) {
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

/**
 * Cmd+CLICK on the surface at container y (viewport coords — happy-dom rects
 * are all zero, so container coords equal viewport coords). Release happens
 * at the press point: sub-threshold, so the press reads as a click.
 */
function cmdClickAt(y: number, x = 2) {
	fireEvent.pointerDown(rowsEl(), {
		button: 0,
		metaKey: true,
		clientX: x,
		clientY: y,
	});
	fireEvent.pointerUp(window, { clientX: x, clientY: y });
}

describe("PromptFlowXml structural unit selection (Cmd+click)", () => {
	it("Cmd+CLICK selects the unit under the cursor as one object", () => {
		renderFlow(flatPrompt);
		layoutRows();
		cmdClickAt(5);
		expect(selectedIds()).toEqual(["para-x"]);
		// No caret/editor: Cmd+click is selection, not editing.
		expect(document.querySelector("textarea")).toBeNull();
	});

	it("Cmd+DRAG past the threshold selects NOTHING (the marquee rectangle is retired)", () => {
		renderFlow(flatPrompt);
		layoutRows();
		fireEvent.pointerDown(rowsEl(), {
			button: 0,
			metaKey: true,
			clientX: 0,
			clientY: 0,
		});
		fireEvent.pointerMove(window, { clientX: 24, clientY: 24 });
		// No rectangle overlay exists at any point of the drag…
		expect(document.querySelector("[data-prompt-marquee]")).toBeNull();
		fireEvent.pointerUp(window, { clientX: 24, clientY: 24 });
		// …and the release resolves no structural selection.
		expect(document.querySelector("[data-prompt-marquee]")).toBeNull();
		expect(selectedIds()).toEqual([]);
	});

	it("a PLAIN drag creates no structural selection and draws no rectangle", () => {
		renderFlow(flatPrompt);
		layoutRows();
		fireEvent.pointerDown(rowsEl(), { button: 0, clientX: 0, clientY: 0 });
		fireEvent.pointerMove(window, { clientX: 30, clientY: 30 });
		expect(document.querySelector("[data-prompt-marquee]")).toBeNull();
		fireEvent.pointerUp(window, { clientX: 30, clientY: 30 });
		expect(document.querySelector("[data-prompt-marquee]")).toBeNull();
		expect(selectedIds()).toEqual([]);
		expect(
			document.querySelector("[data-prompt-selection-ring]"),
		).toBeNull();
	});

	it("the rows container does not suppress native text selection", () => {
		renderFlow(flatPrompt);
		layoutRows();
		// At rest: no user-select suppression on the container…
		expect(rowsEl().style.userSelect).toBe("");
		expect(rowsEl().className).not.toContain("select-none");
		// …and none appears while a plain drag travels over the text (the
		// drag is the browser's own selection gesture now).
		fireEvent.pointerDown(rowsEl(), { button: 0, clientX: 0, clientY: 0 });
		fireEvent.pointerMove(window, { clientX: 30, clientY: 30 });
		expect(rowsEl().style.userSelect).toBe("");
		expect(rowsEl().className).not.toContain("select-none");
		fireEvent.pointerUp(window, { clientX: 30, clientY: 30 });
	});

	it("a sub-threshold plain release stays a plain click: no selection, click-to-edit intact", () => {
		renderFlow(flatPrompt);
		layoutRows();
		fireEvent.pointerDown(rowsEl(), { button: 0, clientX: 0, clientY: 0 });
		fireEvent.pointerMove(window, { clientX: 1, clientY: 1 });
		fireEvent.pointerUp(window, { clientX: 1, clientY: 1 });

		expect(document.querySelector("[data-prompt-marquee]")).toBeNull();
		expect(selectedIds()).toEqual([]);

		// The follow-up click still enters edit mode exactly as before.
		const text = nodeRow("para-x").querySelector<HTMLElement>(
			"[data-prompt-row-text] span",
		)!;
		fireEvent.click(text);
		expect(document.querySelector("textarea")).not.toBeNull();
	});

	it("the release click is swallowed once; the NEXT plain click clears", () => {
		renderFlow(flatPrompt);
		layoutRows();
		cmdClickAt(45);
		expect(selectedIds()).toEqual(["para-y"]);

		const section = document.querySelector("section")!;
		// The click the release itself produced must not clear the selection…
		fireEvent.click(section);
		expect(selectedIds()).toEqual(["para-y"]);
		// …but a genuine follow-up click does.
		fireEvent.click(section);
		expect(selectedIds()).toEqual([]);
	});

	it("Escape clears the structural selection", () => {
		renderFlow(flatPrompt);
		layoutRows();
		cmdClickAt(45);
		expect(selectedIds()).toEqual(["para-y"]);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(selectedIds()).toEqual([]);
	});

	it("selection SURVIVES a host re-render with same content, clears on genuine invalidation", () => {
		const { view } = renderFlow(flatPrompt);
		layoutRows();
		cmdClickAt(125);
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
	it("Backspace removes the Cmd+click-selected BLOCK as one transaction; undo restores", () => {
		const { commits, prompt } = renderFlow(flatPrompt);
		layoutRows();
		cmdClickAt(5);
		expect(selectedIds()).toEqual(["para-x"]);
		fireEvent.keyDown(window, { key: "Backspace" });

		expect(commits).toHaveLength(1);
		const { prompt: next, steps } = commits[0]!;
		expect(next.nodes.map((node) => node.id)).toEqual([
			"para-y",
			"para-z",
			"para-w",
		]);
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

	it("Delete removes the Cmd+click-selected block", () => {
		const { commits, prompt } = renderFlow(flatPrompt);
		layoutRows();
		cmdClickAt(45);
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

describe("PromptFlowXml selected-unit drag (body-move + handle interplay)", () => {
	it("a PLAIN drag on the selected unit's body lifts it and commits ONE transaction", () => {
		const { commits, prompt } = renderFlow(flatPrompt);
		layoutRows();
		cmdClickAt(45);
		expect(selectedIds()).toEqual(["para-y"]);

		// Plain press (no modifier) on the selection's own body…
		fireEvent.pointerDown(nodeRow("para-y"), {
			button: 0,
			clientX: 5,
			clientY: 50,
		});
		// …sub-threshold travel keeps everything at rest…
		fireEvent.pointerMove(window, { clientX: 6, clientY: 51 });
		expect(nodeRow("para-y").style.opacity).toBe("");
		// …and crossing the threshold starts the SAME drag a handle grab
		// inside the zone starts: the lifted row dims, others do not.
		fireEvent.pointerMove(window, { clientX: 5, clientY: 80 });
		expect(nodeRow("para-y").style.opacity).toContain(
			"var(--prompt-editor-drag-opacity",
		);
		expect(nodeRow("para-x").style.opacity).toBe("");
		expect(nodeRow("para-w").style.opacity).toBe("");

		// Zero rects: the nearest legal boundary is slot 0 (before para-x).
		fireEvent.pointerMove(window, { clientY: 0 });
		fireEvent.pointerUp(window);

		expect(commits).toHaveLength(1);
		const { prompt: next, steps } = commits[0]!;
		expect(next.nodes.map((node) => node.id)).toEqual([
			"para-y",
			"para-x",
			"para-z",
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

	it("a sub-threshold press on the selection stays a plain click: click-to-edit clears the zone", () => {
		renderFlow(flatPrompt);
		layoutRows();
		cmdClickAt(45);
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

	it("a plain drag OUTSIDE the selection stays a no-op and keeps the zone", () => {
		const { commits } = renderFlow(flatPrompt);
		layoutRows();
		cmdClickAt(45);
		expect(selectedIds()).toEqual(["para-y"]);

		fireEvent.pointerDown(nodeRow("para-w"), {
			button: 0,
			clientX: 5,
			clientY: 125,
		});
		fireEvent.pointerMove(window, { clientX: 5, clientY: 200 });
		// No lift: nothing dims and no ghost badge appears.
		expect(nodeRow("para-y").style.opacity).toBe("");
		expect(
			Array.from(document.querySelectorAll("span")).find((el) =>
				el.textContent?.startsWith("+"),
			),
		).toBeUndefined();
		fireEvent.pointerUp(window, { clientX: 5, clientY: 200 });
		expect(commits).toHaveLength(0);
		expect(selectedIds()).toEqual(["para-y"]);
	});

	it("grabbing a handle OUTSIDE the run retires the selection and drags just that block", () => {
		const { commits } = renderFlow(flatPrompt);
		layoutRows();
		cmdClickAt(45);
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
		cmdClickAt(45);
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
		cmdClickAt(45);
		expect(
			document.querySelector("[data-prompt-selection-ring]"),
		).not.toBeNull();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(document.querySelector("[data-prompt-selection-ring]")).toBeNull();
	});
});

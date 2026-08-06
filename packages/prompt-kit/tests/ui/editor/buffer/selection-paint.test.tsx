import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { PromptDocument } from "../../../../src/index";
import {
	createPromptEditorModel,
} from "../../../../src/ui/editor/model";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";

afterEach(() => {
	cleanup();
});

/**
 * Selection paint doctrine (2026-08-05): "flood never, rail for extent."
 * Extended CARET-FIRST (2026-08-06): clicking text places a caret and paints
 * NO selection chrome at all, and a selected LIST paints rail-only — its item
 * rows carry the list's node id, so unit fill would stripe every bullet.
 *
 * The selection FILL (selectionBg wash + gutter tint) is UNIT-scoped exactly
 * like the hover wash — only rows the selected node itself owns. Selecting a
 * section must never flood the body rows its children own. The node's full
 * start..end interval keeps a thin LEFT ACCENT RAIL instead
 * (`data-prompt-selection-rail`, one bar per row of the interval), so the
 * extent stays legible without the flood.
 */
const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "selection-paint-doc",
	nodes: [
		{
			type: "section",
			tag: "context",
			id: "sec-1",
			children: [
				{ type: "paragraph", id: "para-1", content: ["Hello world"] },
				{
					type: "bulletList",
					id: "list-1",
					items: [
						{
							type: "listItem",
							id: "item-1",
							content: ["First"],
							children: [
								{
									type: "paragraph",
									id: "para-nested",
									content: ["First detail"],
								},
							],
						},
						{ type: "listItem", id: "item-2", content: ["Second"] },
					],
				},
			],
		},
	],
};

function renderFlow(
	selectedNodeId?: string,
	onSelectNode: (id: string | undefined) => void = () => {},
) {
	const model = createPromptEditorModel(prompt, {});
	return render(
		<PromptFlowXml
			prompt={model.prompt}
			model={model}
			selectedNodeId={selectedNodeId}
			onSelectNode={onSelectNode}
			onPromptChange={() => {}}
		/>,
	);
}

function rows(): HTMLElement[] {
	return Array.from(
		document.querySelectorAll<HTMLElement>("[data-row-index]"),
	);
}

/**
 * Rows carrying the selection/hover WASH div — the fill. Same structural query
 * as hover-wash.test.tsx: the one full-row overlay with `transition-colors`.
 */
function filledRows(): { nodeId: string | null; role: string | null }[] {
	return rows()
		.filter((row) =>
			row.querySelector(
				".pointer-events-none.absolute.inset-0.transition-colors",
			),
		)
		.map((row) => ({
			nodeId: row.getAttribute("data-prompt-node-id"),
			role: row.getAttribute("data-prompt-row-role"),
		}));
}

/** Row indices carrying the left accent rail. */
function railIndices(): number[] {
	return rows()
		.filter((row) => row.querySelector("[data-prompt-selection-rail]"))
		.map((row) => Number(row.getAttribute("data-row-index")));
}

/** Row indices stamped `data-prompt-row-selected` (the machine-readable extent). */
function stampedIndices(): number[] {
	return rows()
		.filter((row) => row.hasAttribute("data-prompt-row-selected"))
		.map((row) => Number(row.getAttribute("data-row-index")));
}

function rowAt(index: number): HTMLElement {
	return document.querySelector<HTMLElement>(
		`[data-row-index="${index}"]`,
	)!;
}

describe("PromptFlowXml selection paint — flood never, rail for extent", () => {
	it("selecting a section fills its open/close tag rows only — never the body", () => {
		renderFlow("sec-1");

		expect(filledRows()).toEqual([
			{ nodeId: "sec-1", role: "open" },
			{ nodeId: "sec-1", role: "close" },
		]);
	});

	it("the accent rail spans the section's FULL interval, open tag through close tag", () => {
		renderFlow("sec-1");

		const rail = railIndices();
		expect(rail.length).toBeGreaterThan(2);

		// Contiguous: every row of the interval carries the rail — body rows and
		// separators included — so the extent reads as one object.
		const first = rail[0]!;
		const last = rail[rail.length - 1]!;
		expect(rail).toEqual(
			Array.from({ length: last - first + 1 }, (_, i) => first + i),
		);

		// The interval's endpoints are the section's own tag rows …
		expect(rowAt(first).getAttribute("data-prompt-node-id")).toBe("sec-1");
		expect(rowAt(first).getAttribute("data-prompt-row-role")).toBe("open");
		expect(rowAt(last).getAttribute("data-prompt-node-id")).toBe("sec-1");
		expect(rowAt(last).getAttribute("data-prompt-row-role")).toBe("close");

		// … and the body rows in between carry the rail WITHOUT the fill.
		const bodyRow = rows().find(
			(row) => row.getAttribute("data-prompt-node-id") === "para-1",
		)!;
		const bodyIndex = Number(bodyRow.getAttribute("data-row-index"));
		expect(rail).toContain(bodyIndex);
		expect(
			bodyRow.querySelector(
				".pointer-events-none.absolute.inset-0.transition-colors",
			),
		).toBeNull();

		// The machine-readable stamp names the same extent as the rail.
		expect(stampedIndices()).toEqual(rail);
	});

	it("selecting a paragraph fills and rails exactly its own row", () => {
		renderFlow("para-1");

		expect(filledRows()).toEqual([{ nodeId: "para-1", role: "content" }]);
		const rail = railIndices();
		expect(rail).toHaveLength(1);
		expect(rowAt(rail[0]!).getAttribute("data-prompt-node-id")).toBe(
			"para-1",
		);
	});

	it("selecting a list paints rail only — zero filled rows (containers never stripe)", () => {
		renderFlow("list-1");

		// Item rows carry the LIST's nodeId in the line model, so unit fill
		// would stripe EVERY bullet's marker row — N selected-looking objects
		// instead of one list. The list paints no per-row fill at all (the
		// gutter tint follows the fill flag, so it is off with it) …
		expect(filledRows()).toEqual([]);

		// … and the full-extent rail alone marks the selection, item marker
		// rows and the nested child row included.
		const rail = railIndices();
		expect(rail.length).toBeGreaterThan(2);
		const first = rail[0]!;
		const last = rail[rail.length - 1]!;
		expect(rail).toEqual(
			Array.from({ length: last - first + 1 }, (_, i) => first + i),
		);
		for (const id of ["item-1", "item-2", "para-nested"]) {
			const row = rows().find(
				(candidate) => candidate.getAttribute("data-prompt-node-id") === id,
			)!;
			expect(rail).toContain(Number(row.getAttribute("data-row-index")));
		}
		expect(stampedIndices()).toEqual(rail);
	});
});

describe("PromptFlowXml caret-first clicks — caret and edit wash only, no selection", () => {
	it("clicking a bullet's text paints no selection fill and no rail", () => {
		const selections: Array<string | undefined> = [];
		renderFlow(undefined, (id) => selections.push(id));

		fireEvent.click(
			document.querySelector<HTMLElement>(
				'[data-prompt-node-id="item-1"] [data-prompt-row-text]',
			)!,
		);

		// The caret landed: the bullet's inline editor is open.
		expect(
			document.querySelector("[data-prompt-row-text] textarea"),
		).toBeTruthy();

		// No selection was made — the host callback never fired (there was no
		// stale selection to clear), and no selection chrome painted: no rail,
		// no machine-readable selected stamps.
		expect(selections).toEqual([]);
		expect(railIndices()).toEqual([]);
		expect(stampedIndices()).toEqual([]);

		// The unit-scoped EDIT wash is the one treatment: the edited item's
		// extent (marker row + nested child row) carries the wash div, and no
		// sibling row does. With nothing selected this wash can only be the
		// hover-strength edit wash, never a selection fill.
		expect(filledRows()).toEqual([
			{ nodeId: "item-1", role: "item" },
			{ nodeId: "para-nested", role: "content" },
		]);
	});

	it("clicking a paragraph's text opens its editor without selecting it", () => {
		const selections: Array<string | undefined> = [];
		renderFlow(undefined, (id) => selections.push(id));

		fireEvent.click(
			document.querySelector<HTMLElement>(
				'[data-prompt-node-id="para-1"] [data-prompt-row-text]',
			)!,
		);

		expect(
			document.querySelector("[data-prompt-row-text] textarea"),
		).toBeTruthy();
		expect(selections).toEqual([]);
		expect(railIndices()).toEqual([]);
	});

	it("placing the caret while a block is selected clears the selection instead of retargeting it", () => {
		const selections: Array<string | undefined> = [];
		renderFlow("para-1", (id) => selections.push(id));

		fireEvent.click(
			document.querySelector<HTMLElement>(
				'[data-prompt-node-id="item-1"] [data-prompt-row-text]',
			)!,
		);

		// Caret-first: the stale selection is CLEARED, never moved to the
		// clicked node.
		expect(selections).toEqual([undefined]);
	});
});

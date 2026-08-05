import { describe, expect, it } from "bun:test";

import type { PromptDocument } from "../../../src/index";
import {
	createPromptEditorModel,
} from "../../../src/ui/editor/model";
import {
	resolveMarqueeSelection,
	structuralSelectionRun,
	type StructuralSelection,
} from "../../../src/ui/editor/structural-selection";
import { buildXmlLineModel, type XmlLine } from "../../../src/document/render/line-model";

/**
 * Section A holds a paragraph, a list (with a multi-line item: nested child
 * paragraph), and a trailing paragraph; section B and a top-level code block
 * follow. Every resolution tier is reachable: item runs inside list-1, block
 * runs at sec-a, and the top-level run.
 */
const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "structural-selection-doc",
	nodes: [
		{
			type: "section",
			tag: "steps",
			id: "sec-a",
			children: [
				{ type: "paragraph", id: "para-1", content: ["Intro"] },
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
					],
				},
				{ type: "paragraph", id: "para-2", content: ["Outro"] },
			],
		},
		{
			type: "section",
			tag: "notes",
			id: "sec-b",
			children: [{ type: "paragraph", id: "para-3", content: ["Note"] }],
		},
		{ type: "codeBlock", id: "code-1", language: "ts", code: "const a = 1;" },
	],
};

const doc = createPromptEditorModel(prompt, {}).prompt;
const lines = buildXmlLineModel(doc).lines;

function rowOf(predicate: (line: XmlLine) => boolean): number {
	const index = lines.findIndex(predicate);
	if (index < 0) throw new Error("row not found");
	return index;
}

const itemRow = (itemId: string) =>
	rowOf((line) => line.role === "item" && line.itemId === itemId);
const contentRow = (nodeId: string) =>
	rowOf((line) => line.role === "content" && line.nodeId === nodeId);

describe("resolveMarqueeSelection (canonical structural resolution)", () => {
	it("rows within ONE list resolve to that run of list items", () => {
		const selection = resolveMarqueeSelection(
			doc,
			lines,
			itemRow("item-b"),
			itemRow("item-c"),
		);
		expect(selection).toEqual({
			parentId: "list-1",
			kind: "items",
			start: 1,
			end: 2,
		});
	});

	it("a band entering an item through its NESTED child rows covers that item", () => {
		// para-c renders inside item-c; sweeping from it into item-d names the
		// item run 2..3, the nested row promoting to its whole item.
		const selection = resolveMarqueeSelection(
			doc,
			lines,
			contentRow("para-c"),
			itemRow("item-d"),
		);
		expect(selection).toEqual({
			parentId: "list-1",
			kind: "items",
			start: 2,
			end: 3,
		});
	});

	it("rows crossing a list boundary into a sibling paragraph resolve to the block run at the common parent", () => {
		// item-d → para-2 crosses out of list-1: the run forms at sec-a and the
		// PARTIALLY covered list promotes to the whole list.
		const selection = resolveMarqueeSelection(
			doc,
			lines,
			itemRow("item-d"),
			contentRow("para-2"),
		);
		expect(selection).toEqual({
			parentId: "sec-a",
			kind: "blocks",
			start: 1,
			end: 2,
		});
	});

	it("rows sweeping across top-level sections resolve to the top-level run", () => {
		// para-2 (inside sec-a) → para-3 (inside sec-b) covers sec-a's close
		// tag on the way: both sections become the object, at their own level.
		const selection = resolveMarqueeSelection(
			doc,
			lines,
			contentRow("para-2"),
			contentRow("para-3"),
		);
		expect(selection).toEqual({
			parentId: null,
			kind: "blocks",
			start: 0,
			end: 1,
		});
	});

	it("sweeping the whole document selects the full top-level run", () => {
		const selection = resolveMarqueeSelection(doc, lines, 0, lines.length - 1);
		expect(selection).toEqual({
			parentId: null,
			kind: "blocks",
			start: 0,
			end: 2,
		});
	});

	it("a band inside ONE leaf block resolves to that single block at its parent", () => {
		const selection = resolveMarqueeSelection(
			doc,
			lines,
			contentRow("para-1"),
			contentRow("para-1"),
		);
		expect(selection).toEqual({
			parentId: "sec-a",
			kind: "blocks",
			start: 0,
			end: 0,
		});
	});

	it("a band inside one item's nested child promotes to that single ITEM", () => {
		const selection = resolveMarqueeSelection(
			doc,
			lines,
			contentRow("para-c"),
			contentRow("para-c"),
		);
		expect(selection).toEqual({
			parentId: "list-1",
			kind: "items",
			start: 2,
			end: 2,
		});
	});

	it("a gap-only band selects nothing", () => {
		const gapRow = rowOf((line) => line.role === "gap");
		expect(resolveMarqueeSelection(doc, lines, gapRow, gapRow)).toBeNull();
	});

	it("normalizes band order and clamps out-of-range rows", () => {
		const forward = resolveMarqueeSelection(
			doc,
			lines,
			itemRow("item-c"),
			itemRow("item-b"),
		);
		expect(forward).toEqual({
			parentId: "list-1",
			kind: "items",
			start: 1,
			end: 2,
		});
		const clamped = resolveMarqueeSelection(doc, lines, -10, lines.length + 10);
		expect(clamped).toEqual({ parentId: null, kind: "blocks", start: 0, end: 2 });
	});

	it("EXACT COVER: the resolved run names precisely the covered sibling span", () => {
		const selection = resolveMarqueeSelection(
			doc,
			lines,
			itemRow("item-b"),
			itemRow("item-c"),
		)!;
		const run = structuralSelectionRun(doc, selection)!;
		expect(run.unitIds).toEqual(["item-b", "item-c"]);
		// Contiguity invariant: the run is one [start, end] span, no holes.
		expect(run.count).toBe(selection.end - selection.start + 1);
	});
});

describe("structuralSelectionRun (materialization = validity check)", () => {
	it("materializes an item run with ids, position, and the parent's total", () => {
		const selection: StructuralSelection = {
			parentId: "list-1",
			kind: "items",
			start: 1,
			end: 3,
		};
		expect(structuralSelectionRun(doc, selection)).toEqual({
			parentId: "list-1",
			kind: "items",
			fromIndex: 1,
			count: 3,
			unitIds: ["item-b", "item-c", "item-d"],
			unitTotal: 4,
		});
	});

	it("materializes the top-level block run", () => {
		const selection: StructuralSelection = {
			parentId: null,
			kind: "blocks",
			start: 1,
			end: 2,
		};
		expect(structuralSelectionRun(doc, selection)).toEqual({
			parentId: null,
			kind: "blocks",
			fromIndex: 1,
			count: 2,
			unitIds: ["sec-b", "code-1"],
			unitTotal: 3,
		});
	});

	it("returns null when the document no longer supports the selection", () => {
		// Unknown parent.
		expect(
			structuralSelectionRun(doc, {
				parentId: "gone",
				kind: "blocks",
				start: 0,
				end: 0,
			}),
		).toBeNull();
		// Endpoint out of range.
		expect(
			structuralSelectionRun(doc, {
				parentId: "list-1",
				kind: "items",
				start: 0,
				end: 9,
			}),
		).toBeNull();
		// Kind contradicting the parent's shape.
		expect(
			structuralSelectionRun(doc, {
				parentId: "list-1",
				kind: "blocks",
				start: 0,
				end: 0,
			}),
		).toBeNull();
		expect(
			structuralSelectionRun(doc, {
				parentId: "sec-a",
				kind: "items",
				start: 0,
				end: 0,
			}),
		).toBeNull();
	});
});

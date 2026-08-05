import { describe, expect, test } from "bun:test";
import type { PromptBlockNode, PromptDocument } from "../../../index";
import {
	createPromptEditorModel,
	type PromptEditorTreeEntry,
} from "../model";

import { buildXmlLineModel } from "../../../document/render/line-model";
import {
	collectEditPoints,
	findEditPointIndex,
	resolveBackspace,
	resolveDeleteForward,
} from "./edit-navigation";

function doc(...nodes: PromptBlockNode[]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "edit-navigation-test",
		nodes,
	};
}

function paragraph(text: string): PromptBlockNode {
	return { type: "paragraph", content: [text] };
}

function bullets(...texts: string[]): PromptBlockNode {
	return {
		type: "bulletList",
		items: texts.map((text) => ({ type: "listItem" as const, content: [text] })),
	};
}

function section(tag: string, ...children: PromptBlockNode[]): PromptBlockNode {
	return { type: "section", tag, children };
}

/** Builds the exact inputs the surface hands the keyboard model. */
function build(input: PromptDocument) {
	const model = createPromptEditorModel(input);
	const lines = buildXmlLineModel(model.prompt, { variables: undefined }).lines;
	const entriesById = new Map<string, PromptEditorTreeEntry>(
		model.tree.map((entry) => [entry.id, entry]),
	);
	return { prompt: model.prompt, lines, entriesById, points: collectEditPoints(lines) };
}

/** Backspace resolution for the Nth editable caret target. */
function backspaceAt(
	input: PromptDocument,
	pointIndex: number,
	valueIsEmpty = false,
) {
	const { lines, entriesById, points } = build(input);
	return resolveBackspace(lines, points, pointIndex, {
		valueIsEmpty,
		entriesById,
	});
}

describe("collectEditPoints", () => {
	test("yields one ordered caret target per editable line", () => {
		const { lines, points } = build(doc(paragraph("one"), bullets("a", "b")));
		expect(points).toHaveLength(3);
		expect(points.map((point) => lines[point.row]!.text.trim())).toEqual([
			"one",
			"- a",
			"- b",
		]);
		expect(points.map((point) => point.itemIndex)).toEqual([
			undefined,
			0,
			1,
		]);
	});

	test("multi-line leaves collapse to a single point on their first line", () => {
		const { points } = build(
			doc({ type: "raw", value: "line one\nline two\nline three" }),
		);
		expect(points).toHaveLength(1);
		expect(points[0]!.itemIndex).toBeUndefined();
	});

	test("findEditPointIndex matches on node id and item index together", () => {
		const { points } = build(doc(bullets("a", "b", "c")));
		const target = points[2]!;
		expect(
			findEditPointIndex(points, {
				nodeId: target.nodeId,
				itemIndex: target.itemIndex,
			}),
		).toBe(2);
		expect(
			findEditPointIndex(points, { nodeId: target.nodeId, itemIndex: 99 }),
		).toBe(-1);
	});
});

describe("resolveBackspace decision table", () => {
	test("nothing precedes the first caret target", () => {
		expect(backspaceAt(doc(paragraph("one"), paragraph("two")), 0)).toEqual({
			kind: "none",
		});
	});

	test("a non-first item merges into the previous item of the same list", () => {
		const result = backspaceAt(doc(bullets("a", "b")), 1);
		expect(result.kind).toBe("merge-items");
		if (result.kind !== "merge-items") throw new Error("unreachable");
		expect(result.itemIndex).toBe(1);
		expect(result.previous.itemIndex).toBe(0);
	});

	test("the FIRST item never merges into whatever sits above the list", () => {
		// A paragraph above a list is not a like-kind sibling: the caret must
		// still travel back, but the structure stays untouched.
		const result = backspaceAt(doc(paragraph("intro"), bullets("a", "b")), 1);
		expect(result.kind).toBe("focus-previous");
		if (result.kind !== "focus-previous") throw new Error("unreachable");
		expect(result.previous.itemIndex).toBeUndefined();
	});

	test("an empty item is removed, keeping the list when others remain", () => {
		const result = backspaceAt(doc(bullets("a", "")), 1, true);
		expect(result.kind).toBe("remove-empty-item");
		if (result.kind !== "remove-empty-item") throw new Error("unreachable");
		expect(result.itemIndex).toBe(1);
		expect(result.removesWholeList).toBe(false);
		expect(result.previous?.itemIndex).toBe(0);
	});

	test("emptying the only item removes the whole list", () => {
		const result = backspaceAt(doc(paragraph("intro"), bullets("")), 1, true);
		expect(result.kind).toBe("remove-empty-item");
		if (result.kind !== "remove-empty-item") throw new Error("unreachable");
		expect(result.removesWholeList).toBe(true);
	});

	test("sibling paragraphs merge", () => {
		const result = backspaceAt(doc(paragraph("one"), paragraph("two")), 1);
		expect(result.kind).toBe("merge-paragraphs");
	});

	test("paragraphs in different containers never merge", () => {
		// The section's first paragraph sits below a top-level paragraph, but
		// merging would pull text across the tag boundary.
		const result = backspaceAt(
			doc(paragraph("outside"), section("notes", paragraph("inside"))),
			1,
		);
		expect(result.kind).toBe("focus-previous");
	});

	test("an empty paragraph is removed and focus goes back", () => {
		const result = backspaceAt(doc(paragraph("one"), paragraph("")), 1, true);
		expect(result.kind).toBe("remove-empty-paragraph");
		if (result.kind !== "remove-empty-paragraph") throw new Error("unreachable");
		expect(result.previous).toBeDefined();
	});

	test("a raw block only moves the caret — it never merges", () => {
		const result = backspaceAt(
			doc(paragraph("one"), { type: "raw", value: "literal" }),
			1,
		);
		expect(result.kind).toBe("focus-previous");
	});
});

describe("resolveDeleteForward", () => {
	test("mirrors the item merge from the row above", () => {
		const { lines, entriesById, points } = build(doc(bullets("a", "b")));
		const result = resolveDeleteForward(lines, points, 0, entriesById);
		expect(result.kind).toBe("merge-items");
		if (result.kind !== "merge-items") throw new Error("unreachable");
		expect(result.nextItemIndex).toBe(1);
	});

	test("mirrors the paragraph merge", () => {
		const { lines, entriesById, points } = build(
			doc(paragraph("one"), paragraph("two")),
		);
		const result = resolveDeleteForward(lines, points, 0, entriesById);
		expect(result.kind).toBe("merge-paragraphs");
	});

	test("does nothing at the last caret target", () => {
		const { lines, entriesById, points } = build(doc(paragraph("only")));
		expect(resolveDeleteForward(lines, points, 0, entriesById).kind).toBe(
			"none",
		);
	});

	test("does not pull a paragraph across a container boundary", () => {
		const { lines, entriesById, points } = build(
			doc(paragraph("outside"), section("notes", paragraph("inside"))),
		);
		expect(resolveDeleteForward(lines, points, 0, entriesById).kind).toBe(
			"none",
		);
	});
});

import { describe, expect, test } from "bun:test";
import {
	canonicalizePrompt,
	type BulletListNode,
	type ListItemNode,
	type PromptDocument,
} from "../../index";
import {
	applyStep,
	ensurePromptNodeIds,
	invertStep,
	type PromptStep,
} from "../editors";

import {
	insertListItemStep,
	mergeListItemsStep,
	nestListItemStep,
	removeListItemStep,
	setListItemContentStep,
	splitListItemStep,
	unnestListItemStep,
} from "./list-item-steps";

function item(text: string, children?: ListItemNode["children"]): ListItemNode {
	return { type: "listItem", content: [text], ...(children ? { children } : {}) };
}

function docWith(list: BulletListNode): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "list-item-steps-test",
		nodes: [list],
	};
}

function bulletDoc(...texts: string[]): PromptDocument {
	return docWith({
		type: "bulletList",
		id: "list1",
		items: texts.map((text) => item(text)),
	});
}

function firstList(prompt: PromptDocument): BulletListNode {
	return prompt.nodes[0] as BulletListNode;
}

/** An update step must round-trip: apply then invert returns the original. */
function expectRoundTrip(before: PromptDocument, step: PromptStep, after: PromptDocument) {
	expect(step.op).toBe("update");
	// Applying the step to `before` reproduces `after`.
	expect(canonicalizePrompt(applyStep(before, step))).toBe(canonicalizePrompt(after));
	// Inverting and applying returns to `before`.
	expect(canonicalizePrompt(applyStep(after, invertStep(step)))).toBe(
		canonicalizePrompt(before),
	);
}

describe("list-item step composition", () => {
	test("insert adds an empty item and reports its index", () => {
		const before = bulletDoc("a", "b");
		const result = insertListItemStep(before, "list1", 1);
		expect(result.step).toBeDefined();
		expect(result.focusItemIndex).toBe(1);
		const list = firstList(result.prompt);
		expect(list.items.map((i) => i.content)).toEqual([["a"], [""], ["b"]]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("insert clamps beyond the end (append)", () => {
		const before = bulletDoc("a");
		const result = insertListItemStep(before, "list1", 99);
		expect(result.focusItemIndex).toBe(1);
		expect(firstList(result.prompt).items).toHaveLength(2);
	});

	test("remove deletes the item and focuses the previous", () => {
		const before = bulletDoc("a", "b", "c");
		const result = removeListItemStep(before, "list1", 1);
		expect(result.step).toBeDefined();
		expect(result.focusItemIndex).toBe(0);
		expect(firstList(result.prompt).items.map((i) => i.content)).toEqual([
			["a"],
			["c"],
		]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("setContent parses inline and round-trips", () => {
		const before = bulletDoc("a", "b");
		const result = setListItemContentStep(before, "list1", 0, "hello {{name}}");
		expect(result.step).toBeDefined();
		const content = firstList(result.prompt).items[0]!.content;
		expect(content).toEqual(["hello ", { type: "variable", name: "name" }]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("nest moves an item into a child list of the previous item", () => {
		const before = bulletDoc("parent", "child");
		const result = nestListItemStep(before, "list1", 1);
		expect(result.step).toBeDefined();
		const list = firstList(result.prompt);
		expect(list.items).toHaveLength(1);
		const nested = list.items[0]!.children?.[0] as BulletListNode;
		expect(nested.type).toBe("bulletList");
		expect(nested.items.map((i) => i.content)).toEqual([["child"]]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("nest appends to an existing trailing child list", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				item("parent", [
					{ type: "bulletList", items: [item("existing")] } as BulletListNode,
				]),
				item("second"),
			],
		});
		const result = nestListItemStep(before, "list1", 1);
		const list = firstList(result.prompt);
		expect(list.items).toHaveLength(1);
		const nested = list.items[0]!.children?.[0] as BulletListNode;
		expect(nested.items.map((i) => i.content)).toEqual([["existing"], ["second"]]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("nest is a no-op for the first item", () => {
		const before = bulletDoc("only", "second");
		const result = nestListItemStep(before, "list1", 0);
		expect(result.step).toBeUndefined();
		expect(result.focusListId).toBeUndefined();
	});

	/**
	 * Tab has to keep typing. The item lands in a list node the caller never
	 * named — sometimes one that did not exist a moment ago — so the result has
	 * to say which list, and with which id the surface is about to render it.
	 */
	test("nest names the list the item landed in", () => {
		const before = bulletDoc("parent", "child");
		const result = nestListItemStep(before, "list1", 1);
		const created = firstList(result.prompt).items[0]!
			.children?.[0] as BulletListNode;
		expect(result.focusListId).toBe(
			(ensurePromptNodeIds(result.prompt).nodes[0] as BulletListNode).items[0]!
				.children![0]!.id,
		);
		expect(result.focusItemIndex).toBe(0);
		// The id is minted, not carried: the pure update left the new list bare.
		expect(created.id).toBeUndefined();
	});

	test("nest into an existing child list lands on its new last item", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				item("parent", [
					{
						type: "bulletList",
						id: "nested1",
						items: [item("existing")],
					} as BulletListNode,
				]),
				item("second"),
			],
		});
		const result = nestListItemStep(before, "list1", 1);
		expect(result.focusListId).toBe("nested1");
		expect(result.focusItemIndex).toBe(1);
	});

	test("un-nest names the outer list and the hoisted slot", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				item("parent", [
					{ type: "bulletList", items: [item("child")] } as BulletListNode,
				]),
			],
		});
		const result = unnestListItemStep(before, "list1", 0, 0);
		expect(result.focusListId).toBe("list1");
		expect(result.focusItemIndex).toBe(1);
	});

	test("unnest hoists a nested item back after its parent", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				item("parent", [
					{
						type: "bulletList",
						items: [item("nestedA"), item("nestedB")],
					} as BulletListNode,
				]),
			],
		});
		const result = unnestListItemStep(before, "list1", 0, 0);
		expect(result.step).toBeDefined();
		const list = firstList(result.prompt);
		expect(list.items.map((i) => i.content)).toEqual([["parent"], ["nestedA"]]);
		// The remaining nested item stays under the parent.
		const nested = list.items[0]!.children?.[0] as BulletListNode;
		expect(nested.items.map((i) => i.content)).toEqual([["nestedB"]]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("unnest drops the child list when it empties", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				item("parent", [
					{ type: "bulletList", items: [item("solo")] } as BulletListNode,
				]),
			],
		});
		const result = unnestListItemStep(before, "list1", 0, 0);
		const list = firstList(result.prompt);
		expect(list.items.map((i) => i.content)).toEqual([["parent"], ["solo"]]);
		expect(list.items[0]!.children).toBeUndefined();
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("nest then unnest returns to the original document", () => {
		const before = bulletDoc("parent", "child");
		const nested = nestListItemStep(before, "list1", 1);
		const restored = unnestListItemStep(nested.prompt, "list1", 0, 0);
		expect(canonicalizePrompt(restored.prompt)).toBe(canonicalizePrompt(before));
	});
});

describe("split / merge — the Enter and Backspace pair", () => {
	test("split cuts the item at the caret and focuses the new one at 0", () => {
		const before = bulletDoc("hello world", "next");
		const result = splitListItemStep(before, "list1", 0, "hello ", "world");
		expect(result.step).toBeDefined();
		expect(result.focusItemIndex).toBe(1);
		expect(result.caretOffset).toBe(0);
		expect(firstList(result.prompt).items.map((i) => i.content)).toEqual([
			["hello "],
			["world"],
			["next"],
		]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("split at end-of-text is a clean add-next", () => {
		const before = bulletDoc("a");
		const result = splitListItemStep(before, "list1", 0, "a", "");
		expect(firstList(result.prompt).items.map((i) => i.content)).toEqual([
			["a"],
			[""],
		]);
		expect(result.focusItemIndex).toBe(1);
	});

	test("split keeps the original item's nested children on the first half", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				item("parent", [
					{ type: "bulletList", items: [item("nested")] } as BulletListNode,
				]),
			],
		});
		const result = splitListItemStep(before, "list1", 0, "par", "ent");
		const list = firstList(result.prompt);
		expect(list.items[0]!.children).toBeDefined();
		expect(list.items[1]!.children).toBeUndefined();
	});

	test("merge joins an item into the previous one, caret at the join", () => {
		const before = bulletDoc("hello ", "world", "tail");
		const result = mergeListItemsStep(before, "list1", 1);
		expect(result.step).toBeDefined();
		expect(result.focusItemIndex).toBe(0);
		expect(result.caretOffset).toBe("hello ".length);
		// Text on either side of the seam coalesces, so the merged item is
		// indistinguishable from the same characters typed by hand.
		expect(firstList(result.prompt).items.map((i) => i.content)).toEqual([
			["hello world"],
			["tail"],
		]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("merge preserves nested children of BOTH items, in order", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				item("first", [
					{ type: "bulletList", items: [item("underFirst")] } as BulletListNode,
				]),
				item("second", [
					{ type: "bulletList", items: [item("underSecond")] } as BulletListNode,
				]),
			],
		});
		const result = mergeListItemsStep(before, "list1", 1);
		const merged = firstList(result.prompt).items[0]!;
		expect(merged.children).toHaveLength(2);
		expect((merged.children![0] as BulletListNode).items[0]!.content).toEqual([
			"underFirst",
		]);
		expect((merged.children![1] as BulletListNode).items[0]!.content).toEqual([
			"underSecond",
		]);
	});

	test("merge is a no-op for the first item", () => {
		const before = bulletDoc("a", "b");
		expect(mergeListItemsStep(before, "list1", 0).step).toBeUndefined();
	});

	test("split then merge returns to the original document", () => {
		const before = bulletDoc("hello world");
		const split = splitListItemStep(before, "list1", 0, "hello ", "world");
		const merged = mergeListItemsStep(split.prompt, "list1", 1);
		expect(canonicalizePrompt(merged.prompt)).toBe(canonicalizePrompt(before));
	});
});

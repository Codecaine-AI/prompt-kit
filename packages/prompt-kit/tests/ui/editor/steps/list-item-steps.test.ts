import { describe, expect, test } from "bun:test";
import {
	canonicalizePrompt,
	type BulletListNode,
	type ListItemNode,
	type PromptDocument,
} from "../../../../src/index";
import {
	ensurePromptNodeIds,
} from "../../../../src/ui/editor/model";
import {
	applyStep,
	invertStep,
	type PromptStep,
} from "../../../../src/ui/editor/transactions";

import {
	duplicateListItemStep,
	insertListItemStep,
	mergeListItemsStep,
	moveListItemStep,
	moveListItemsStep,
	nestListItemStep,
	removeListItemStep,
	removeListItemsStep,
	setListItemContentStep,
	splitListItemStep,
	unnestListItemStep,
} from "../../../../src/ui/editor/steps/list-item-steps";

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

describe("moveListItemStep (drag-drop reorder)", () => {
	test("moves an item down: slot named in ORIGINAL indexing", () => {
		const before = bulletDoc("a", "b", "c");
		// Slot 2 = "before the item currently at index 2" — a lands between b, c.
		const result = moveListItemStep(before, "list1", 0, 2);
		expect(result.step).toBeDefined();
		expect(result.focusItemIndex).toBe(1);
		expect(firstList(result.prompt).items.map((i) => i.content)).toEqual([
			["b"],
			["a"],
			["c"],
		]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("moves an item up and to the end", () => {
		const before = bulletDoc("a", "b", "c");
		const up = moveListItemStep(before, "list1", 2, 0);
		expect(firstList(up.prompt).items.map((i) => i.content)).toEqual([
			["c"],
			["a"],
			["b"],
		]);
		expectRoundTrip(before, up.step!, up.prompt);
		// Slot items.length = after the last item.
		const toEnd = moveListItemStep(before, "list1", 0, 3);
		expect(firstList(toEnd.prompt).items.map((i) => i.content)).toEqual([
			["b"],
			["c"],
			["a"],
		]);
		expectRoundTrip(before, toEnd.step!, toEnd.prompt);
	});

	test("dropping into either boundary around the item itself is a no-op", () => {
		const before = bulletDoc("a", "b", "c");
		// Before itself and immediately after itself both leave order unchanged,
		// so no step is emitted and nothing enters the undo log.
		expect(moveListItemStep(before, "list1", 1, 1).step).toBeUndefined();
		expect(moveListItemStep(before, "list1", 1, 2).step).toBeUndefined();
	});

	test("out-of-range source is a no-op; out-of-range slot clamps", () => {
		const before = bulletDoc("a", "b");
		expect(moveListItemStep(before, "list1", 5, 0).step).toBeUndefined();
		const clamped = moveListItemStep(before, "list1", 0, 99);
		expect(firstList(clamped.prompt).items.map((i) => i.content)).toEqual([
			["b"],
			["a"],
		]);
	});

	test("a multi-line item moves as a unit: nested children ride along", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				item("first", [
					{
						type: "bulletList",
						id: "nested1",
						items: [item("child")],
					} as BulletListNode,
				]),
				item("second"),
			],
		});
		const result = moveListItemStep(before, "list1", 0, 2);
		const items = firstList(result.prompt).items;
		expect(items.map((i) => i.content)).toEqual([["second"], ["first"]]);
		const nested = items[1]!.children?.[0] as BulletListNode;
		expect(nested.items.map((i) => i.content)).toEqual([["child"]]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("reorders a NESTED list through its addressable ancestor", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				item("parent", [
					{
						type: "bulletList",
						id: "nested1",
						items: [item("x"), item("y")],
					} as BulletListNode,
				]),
			],
		});
		const result = moveListItemStep(before, "nested1", 0, 2);
		expect(result.step).toBeDefined();
		// The step is one invertible update on the tree-addressable outer list.
		expect(result.step!.op).toBe("update");
		expect((result.step! as { id: string }).id).toBe("list1");
		const nested = firstList(result.prompt).items[0]!
			.children![0] as BulletListNode;
		expect(nested.items.map((i) => i.content)).toEqual([["y"], ["x"]]);
		expectRoundTrip(before, result.step!, result.prompt);
	});
});

describe("moveListItemsStep (group drag-drop reorder)", () => {
	test("moves a contiguous run forward in order as one invertible step", () => {
		const before = bulletDoc("a", "b", "c", "d", "e");
		// Items 1..2 ("b","c") to the slot before "e" (original index 4).
		const result = moveListItemsStep(before, "list1", 1, 2, 4);
		expect(result.step).toBeDefined();
		expect(firstList(result.prompt).items.map((i) => i.content)).toEqual([
			["a"],
			["d"],
			["b"],
			["c"],
			["e"],
		]);
		expect(result.focusItemIndex).toBe(2);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("moves a run backward keeping order", () => {
		const before = bulletDoc("a", "b", "c", "d");
		// Items 2..3 ("c","d") to the front.
		const result = moveListItemsStep(before, "list1", 2, 2, 0);
		expect(firstList(result.prompt).items.map((i) => i.content)).toEqual([
			["c"],
			["d"],
			["a"],
			["b"],
		]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("count 1 behaves exactly like moveListItemStep", () => {
		const before = bulletDoc("a", "b", "c");
		const single = moveListItemStep(before, "list1", 0, 2);
		const run = moveListItemsStep(before, "list1", 0, 1, 2);
		expect(canonicalizePrompt(run.prompt)).toBe(
			canonicalizePrompt(single.prompt),
		);
	});

	test("no-ops on the run's own edges and on slots inside the run", () => {
		const before = bulletDoc("a", "b", "c", "d", "e");
		// Leading edge, trailing edge: putting the run back where it is.
		expect(moveListItemsStep(before, "list1", 1, 2, 1).step).toBeUndefined();
		expect(moveListItemsStep(before, "list1", 1, 2, 3).step).toBeUndefined();
		// A slot strictly inside the lifted run has no meaning.
		expect(moveListItemsStep(before, "list1", 1, 2, 2).step).toBeUndefined();
	});

	test("no-ops when the run is out of range or empty", () => {
		const before = bulletDoc("a", "b", "c");
		expect(moveListItemsStep(before, "list1", 2, 2, 0).step).toBeUndefined();
		expect(moveListItemsStep(before, "list1", -1, 2, 0).step).toBeUndefined();
		expect(moveListItemsStep(before, "list1", 0, 0, 2).step).toBeUndefined();
	});

	test("clamps a beyond-the-end slot to append", () => {
		const before = bulletDoc("a", "b", "c", "d");
		const result = moveListItemsStep(before, "list1", 0, 2, 99);
		expect(firstList(result.prompt).items.map((i) => i.content)).toEqual([
			["c"],
			["d"],
			["a"],
			["b"],
		]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("each item's nested children ride along with the run", () => {
		const before = bulletDoc("a", "b", "c");
		const withChildren = docWith({
			...firstList(before),
			items: [
				item("a"),
				item("b", [
					{
						type: "bulletList",
						id: "nested-in-b",
						items: [item("b1")],
					} as BulletListNode,
				]),
				item("c"),
			],
		});
		const result = moveListItemsStep(withChildren, "list1", 1, 2, 0);
		const list = firstList(result.prompt);
		expect(list.items.map((i) => i.content)).toEqual([["b"], ["c"], ["a"]]);
		expect(list.items[0]!.children).toHaveLength(1);
		expectRoundTrip(withChildren, result.step!, result.prompt);
	});
});

describe("removeListItemsStep (structural-selection run delete)", () => {
	test("removes a contiguous run as ONE invertible update step", () => {
		const before = bulletDoc("a", "b", "c", "d", "e");
		const result = removeListItemsStep(before, "list1", 1, 3);
		const list = firstList(result.prompt);
		expect(list.items.map((i) => i.content)).toEqual([["a"], ["e"]]);
		expect(result.focusItemIndex).toBe(0);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("nested children of removed items come back on undo", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				item("a"),
				item("b", [
					{
						type: "bulletList",
						id: "nested-in-b",
						items: [item("b1")],
					} as BulletListNode,
				]),
				item("c"),
			],
		});
		const result = removeListItemsStep(before, "list1", 1, 2);
		expect(firstList(result.prompt).items.map((i) => i.content)).toEqual([
			["a"],
		]);
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("out-of-range runs are no-ops", () => {
		const before = bulletDoc("a", "b");
		expect(removeListItemsStep(before, "list1", 1, 2).step).toBeUndefined();
		expect(removeListItemsStep(before, "list1", -1, 1).step).toBeUndefined();
		expect(removeListItemsStep(before, "list1", 0, 0).step).toBeUndefined();
	});
});

describe("duplicateListItemStep", () => {
	/** Every id in the document, blocks and list items alike. */
	function allIds(prompt: PromptDocument): string[] {
		const ids: string[] = [];
		const visitBlock = (node: PromptDocument["nodes"][number]): void => {
			if (node.id) ids.push(node.id);
			if (node.type === "bulletList" || node.type === "orderedList") {
				for (const entry of node.items) {
					if (entry.id) ids.push(entry.id);
					entry.children?.forEach(visitBlock);
				}
			} else if (node.type === "section" || node.type === "example") {
				node.children.forEach(visitBlock);
			} else if (node.type === "field") {
				node.children?.forEach(visitBlock);
			} else if (node.type === "contextUsage") {
				node.instructions.forEach(visitBlock);
			}
		};
		prompt.nodes.forEach(visitBlock);
		return ids;
	}

	test("inserts the copy directly after the source and round-trips (invert removes it)", () => {
		const before = bulletDoc("a", "b", "c");
		const result = duplicateListItemStep(before, "list1", 1);
		expect(result.step).toBeDefined();
		expect(result.focusItemIndex).toBe(2);
		expect(firstList(result.prompt).items.map((i) => i.content)).toEqual([
			["a"],
			["b"],
			["b"],
			["c"],
		]);
		// One invertible update step: applying reproduces the duplicate,
		// inverting removes the inserted copy and restores the original.
		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("the copy carries FRESH ids for itself and every nested child", () => {
		const before = docWith({
			type: "bulletList",
			id: "list1",
			items: [
				{ type: "listItem", id: "item-a", content: ["alpha"] },
				{
					type: "listItem",
					id: "item-b",
					content: ["bravo"],
					children: [
						{ type: "paragraph", id: "para-b", content: ["bravo detail"] },
						{
							type: "bulletList",
							id: "list-b",
							items: [
								{ type: "listItem", id: "item-b-1", content: ["nested"] },
							],
						} as BulletListNode,
					],
				},
			],
		});
		const result = duplicateListItemStep(before, "list1", 1);
		expect(result.step).toBeDefined();

		const list = firstList(result.prompt);
		expect(list.items).toHaveLength(3);
		const source = list.items[1]!;
		const copy = list.items[2]!;
		// The subtree duplicated in full: content, nested paragraph, nested list.
		expect(copy.content).toEqual(["bravo"]);
		expect(copy.children).toHaveLength(2);
		const copiedList = copy.children![1] as BulletListNode;
		expect(copiedList.items.map((i) => i.content)).toEqual([["nested"]]);
		// Source untouched.
		expect(source.id).toBe("item-b");
		expect(source.children![0]!.id).toBe("para-b");

		// Fresh ids at EVERY level: assigned, and colliding with nothing.
		const beforeIds = new Set(allIds(before));
		const copyIds = [
			copy.id,
			copy.children![0]!.id,
			copiedList.id,
			copiedList.items[0]!.id,
		];
		for (const id of copyIds) {
			expect(id).toBeDefined();
			expect(beforeIds.has(id!)).toBe(false);
		}
		// And the whole document's ids stay unique.
		const afterIds = allIds(result.prompt);
		expect(new Set(afterIds).size).toBe(afterIds.length);

		expectRoundTrip(before, result.step!, result.prompt);
	});

	test("out-of-range index is a no-op", () => {
		const before = bulletDoc("a", "b");
		expect(duplicateListItemStep(before, "list1", 5).step).toBeUndefined();
		expect(duplicateListItemStep(before, "list1", -1).step).toBeUndefined();
	});
});

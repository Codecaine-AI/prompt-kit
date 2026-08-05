// Integration tests for the keymap as the surface wires it: a real document, a
// real line model, real tree entries, and the real step producers behind every
// key. Only the DOM event and the two surface callbacks are stood in for.

import { describe, expect, test } from "bun:test";
import type { PromptBlockNode, PromptDocument } from "../../../../src/index";
import {
	createPromptEditorModel,
	type PromptEditorTreeEntry,
} from "../../../../src/ui/editor/model";
import {
	applySteps,
	type PromptStep,
} from "../../../../src/ui/editor/transactions";

import { buildXmlLineModel, type XmlLine } from "../../../../src/document/render/line-model";
import { handleEditorKey, type EditTarget } from "../../../../src/ui/editor/buffer/editor-keymap";
import { registerNestedLists } from "../../../../src/ui/editor/steps/node-mutations";

/* --------------------------------------------------------------- *
 * Harness
 * --------------------------------------------------------------- */

function doc(...nodes: PromptBlockNode[]): PromptDocument {
	return createPromptEditorModel({
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "editor-keymap-test",
		nodes,
	}).prompt;
}

interface Pressed {
	/** Document after the keystroke (unchanged when it produced no steps). */
	prompt: PromptDocument;
	steps: PromptStep[];
	/** Where the caret was told to go, if anywhere. */
	moved?: EditTarget;
	edited: boolean;
	prevented: boolean;
	/** Rendered document, for readable assertions. */
	text: string;
}

/**
 * Presses one key on the row that renders `nodeId` (and `itemIndex`, for a
 * list), with the editor holding `value` and the caret at `caret`.
 */
function press(
	prompt: PromptDocument,
	target: { nodeId: string; itemIndex?: number; role?: XmlLine["role"] },
	key: string,
	options: { value?: string; caret?: number; shiftKey?: boolean } = {},
): Pressed {
	const model = createPromptEditorModel(prompt);
	const lines = buildXmlLineModel(prompt).lines;
	const entriesById = new Map<string, PromptEditorTreeEntry>();
	for (const entry of model.tree) entriesById.set(entry.id, entry);
	for (const entry of model.tree) registerNestedLists(entry, entriesById);

	const line = lines.find(
		(candidate) =>
			candidate.nodeId === target.nodeId &&
			candidate.itemIndex === target.itemIndex &&
			(target.role ? candidate.role === target.role : candidate.editable),
	);
	if (!line) throw new Error(`no row for ${JSON.stringify(target)}`);

	const value = options.value ?? "";
	const caret = options.caret ?? value.length;
	let prevented = false;
	let next = prompt;
	const steps: PromptStep[] = [];
	let moved: EditTarget | undefined;
	let edited = true;

	handleEditorKey(
		{
			key,
			shiftKey: options.shiftKey ?? false,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
			currentTarget: {
				value,
				selectionStart: caret,
				selectionEnd: caret,
			} as HTMLTextAreaElement,
			preventDefault() {
				prevented = true;
			},
		} as unknown as React.KeyboardEvent<HTMLTextAreaElement>,
		line,
		{
			lines,
			entriesById,
			prompt,
			onPromptChange: (result, _id, committed) => {
				next = result;
				steps.push(...(committed ?? []));
			},
			moveEdit: (edit) => {
				moved = edit;
			},
			endEdit: () => {
				edited = false;
			},
		},
	);

	return {
		prompt: next,
		steps,
		moved,
		edited,
		prevented,
		text: buildXmlLineModel(next)
			.lines.map((l) => l.text)
			.join("\n"),
	};
}

/** Ids the editor assigns, so tests can name the nodes they built. */
const id = {
	purpose: "node-section-1",
	nested: "node-section-2",
	para(n: number) {
		return `node-paragraph-${n}`;
	},
	bullets(n: number) {
		return `node-bullet-list-${n}`;
	},
};

function bullets(...items: string[]): PromptBlockNode {
	return {
		type: "bulletList",
		items: items.map((content) => ({ type: "listItem", content: [content] })),
	};
}

/* --------------------------------------------------------------- *
 * Every structural key is ONE transaction
 * --------------------------------------------------------------- */

/**
 * The steps a keystroke reports must be exactly the edit it made: replaying
 * them on the document the key started from has to land on the document the
 * surface was handed. Anything less and undo would restore a state that never
 * existed.
 */
function expectOneTransaction(before: PromptDocument, pressed: Pressed) {
	expect(pressed.steps.length).toBeGreaterThan(0);
	expect(applySteps(before, pressed.steps)).toEqual(pressed.prompt);
}

/* --------------------------------------------------------------- *
 * Enter
 * --------------------------------------------------------------- */

describe("Enter on an empty list item", () => {
	test("outdents a nested item to sit after its parent", () => {
		const before = doc({
			type: "bulletList",
			items: [
				{
					type: "listItem",
					content: ["outer"],
					children: [bullets("inner", "")],
				},
			],
		});
		const pressed = press(before, { nodeId: id.bullets(2), itemIndex: 1 }, "Enter");

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("- outer\n    - inner\n-");
		expect(pressed.moved).toEqual({
			nodeId: id.bullets(1),
			itemIndex: 1,
			caret: 0,
		});
	});

	test("leaves a top-level list for a paragraph after it", () => {
		const before = doc(bullets("one", ""));
		const pressed = press(before, { nodeId: id.bullets(1), itemIndex: 1 }, "Enter");

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("- one\n\n");
		expect(pressed.moved?.caret).toBe(0);
		expect(pressed.moved?.itemIndex).toBeUndefined();
	});

	test("splits instead when the item carries text", () => {
		const before = doc(bullets("one"));
		const pressed = press(
			before,
			{ nodeId: id.bullets(1), itemIndex: 0 },
			"Enter",
			{ value: "one", caret: 3 },
		);

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("- one\n-");
		expect(pressed.moved).toEqual({
			nodeId: id.bullets(1),
			itemIndex: 1,
			caret: 0,
		});
	});
});

describe("Enter on an empty paragraph in a section", () => {
	const build = (...children: PromptBlockNode[]) =>
		doc({ type: "section", tag: "purpose", children });

	test("climbs out when the paragraph trails the section", () => {
		const before = build(
			{ type: "paragraph", content: ["kept"] },
			{ type: "paragraph", content: [""] },
		);
		const pressed = press(before, { nodeId: id.para(2) }, "Enter");

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("<purpose>\n    kept\n</purpose>\n\n");
		expect(pressed.moved).toEqual({
			nodeId: id.para(2),
			itemIndex: undefined,
			caret: 0,
		});
	});

	test("splits when the paragraph is not the last child", () => {
		const before = build(
			{ type: "paragraph", content: [""] },
			{ type: "paragraph", content: ["after"] },
		);
		const pressed = press(before, { nodeId: id.para(1) }, "Enter");

		expectOneTransaction(before, pressed);
		// Still inside the section, now two empty paragraphs where there was one.
		expect(pressed.text).toBe("<purpose>\n    \n\n    \n\n    after\n</purpose>");
	});

	test("splits at the document root, where there is nothing to climb out of", () => {
		const before = doc({ type: "paragraph", content: [""] });
		const pressed = press(before, { nodeId: id.para(1) }, "Enter");

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("\n\n");
	});
});

describe("Enter on a section tag", () => {
	test("drops the caret into the section body without editing anything", () => {
		const before = doc({
			type: "section",
			tag: "purpose",
			children: [{ type: "paragraph", content: ["body"] }],
		});
		const pressed = press(
			before,
			{ nodeId: id.purpose, role: "open" },
			"Enter",
			{ value: "purpose" },
		);

		expect(pressed.steps).toHaveLength(0);
		expect(pressed.moved).toEqual({
			nodeId: id.para(1),
			itemIndex: undefined,
			caret: "end",
		});
	});
});

/* --------------------------------------------------------------- *
 * Backspace
 * --------------------------------------------------------------- */

// With the per-item remove × gone, the keyboard IS the item-delete path:
// Backspace in an emptied item removes exactly that item (or the whole list
// when it was the last one), and Backspace at the start of a non-empty item
// merges it into the one above. These press the real keymap end-to-end.
describe("Backspace on a list item", () => {
	test("removes an emptied item, keeping the list when others remain", () => {
		const before = doc(bullets("one", ""));
		const pressed = press(
			before,
			{ nodeId: id.bullets(1), itemIndex: 1 },
			"Backspace",
			{ value: "", caret: 0 },
		);

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("- one");
		expect(pressed.prevented).toBe(true);
		// The caret lands on the previous item, ready to keep deleting.
		expect(pressed.moved).toEqual({
			nodeId: id.bullets(1),
			itemIndex: 0,
			caret: "end",
		});
	});

	test("removes the whole list with its last emptied item", () => {
		const before = doc(
			{ type: "paragraph", content: ["keep"] },
			bullets(""),
		);
		const pressed = press(
			before,
			{ nodeId: id.bullets(1), itemIndex: 0 },
			"Backspace",
			{ value: "", caret: 0 },
		);

		expectOneTransaction(before, pressed);
		// Only the paragraph survives — an empty list would render nothing.
		expect(pressed.text).toBe("keep");
	});

	test("merges a non-empty item into the previous one at caret 0", () => {
		const before = doc(bullets("one", "two"));
		const pressed = press(
			before,
			{ nodeId: id.bullets(1), itemIndex: 1 },
			"Backspace",
			{ value: "two", caret: 0 },
		);

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("- onetwo");
		expect(pressed.moved).toEqual({
			nodeId: id.bullets(1),
			itemIndex: 0,
			caret: 3,
		});
	});
});

/* --------------------------------------------------------------- *
 * Tab / Shift+Tab
 * --------------------------------------------------------------- */

describe("Tab in a list", () => {
	test("nests an item and keeps the caret in it", () => {
		const before = doc(bullets("one", "two"));
		const pressed = press(
			before,
			{ nodeId: id.bullets(1), itemIndex: 1 },
			"Tab",
			{ value: "two", caret: 2 },
		);

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("- one\n    - two");
		// The item moved into a NEW list node; the caret has to follow it there.
		expect(pressed.moved?.nodeId).not.toBe(id.bullets(1));
		expect(pressed.moved?.itemIndex).toBe(0);
		expect(pressed.moved?.caret).toBe(2);
		expect(pressed.edited).toBe(true);
	});

	test("appends to an existing nested list and lands on the new last item", () => {
		const before = doc({
			type: "bulletList",
			items: [
				{ type: "listItem", content: ["one"], children: [bullets("a")] },
				{ type: "listItem", content: ["two"] },
			],
		});
		const pressed = press(
			before,
			{ nodeId: id.bullets(1), itemIndex: 1 },
			"Tab",
			{ value: "two", caret: 3 },
		);

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("- one\n    - a\n    - two");
		expect(pressed.moved).toEqual({
			nodeId: id.bullets(2),
			itemIndex: 1,
			caret: 3,
		});
	});

	test("un-nests with Shift and keeps the caret", () => {
		const before = doc({
			type: "bulletList",
			items: [
				{ type: "listItem", content: ["one"], children: [bullets("two")] },
			],
		});
		const pressed = press(
			before,
			{ nodeId: id.bullets(2), itemIndex: 0 },
			"Tab",
			{ value: "two", caret: 1, shiftKey: true },
		);

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("- one\n- two");
		expect(pressed.moved).toEqual({
			nodeId: id.bullets(1),
			itemIndex: 1,
			caret: 1,
		});
	});

	test("is swallowed on the first item, which has nothing to nest under", () => {
		const before = doc(bullets("one"));
		const pressed = press(before, { nodeId: id.bullets(1), itemIndex: 0 }, "Tab");

		expect(pressed.steps).toHaveLength(0);
		// Swallowed, so Tab never moves focus out of the buffer.
		expect(pressed.prevented).toBe(true);
	});
});

describe("Tab on a paragraph", () => {
	test("indents into the section directly above it", () => {
		const before = doc(
			{ type: "section", tag: "purpose", children: [{ type: "paragraph", content: ["a"] }] },
			{ type: "paragraph", content: ["moved"] },
		);
		const pressed = press(before, { nodeId: id.para(2) }, "Tab", {
			value: "moved",
			caret: 2,
		});

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("<purpose>\n    a\n\n    moved\n</purpose>");
		expect(pressed.moved).toEqual({
			nodeId: id.para(2),
			itemIndex: undefined,
			caret: 2,
		});
	});

	test("climbs out of its section with Shift", () => {
		const before = doc({
			type: "section",
			tag: "purpose",
			children: [
				{ type: "paragraph", content: ["a"] },
				{ type: "paragraph", content: ["moved"] },
			],
		});
		const pressed = press(before, { nodeId: id.para(2) }, "Tab", {
			value: "moved",
			caret: 5,
			shiftKey: true,
		});

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("<purpose>\n    a\n</purpose>\n\nmoved");
		expect(pressed.moved?.caret).toBe(5);
	});

	test("is swallowed when there is no section beside it", () => {
		const before = doc({ type: "paragraph", content: ["alone"] });
		const pressed = press(before, { nodeId: id.para(1) }, "Tab", {
			value: "alone",
		});

		expect(pressed.steps).toHaveLength(0);
		expect(pressed.prevented).toBe(true);
	});
});

describe("Tab on a section", () => {
	test("nests it under the previous section, children and all", () => {
		const before = doc(
			{ type: "section", tag: "purpose", children: [{ type: "paragraph", content: ["a"] }] },
			{ type: "section", tag: "rules", children: [{ type: "paragraph", content: ["b"] }] },
		);
		const pressed = press(
			before,
			{ nodeId: id.nested, role: "open" },
			"Tab",
			{ value: "rules", caret: 3 },
		);

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe(
			"<purpose>\n    a\n\n    <rules>\n        b\n    </rules>\n</purpose>",
		);
		expect(pressed.moved).toEqual({
			nodeId: id.nested,
			itemIndex: undefined,
			caret: 3,
		});
	});

	test("lifts it back out with Shift", () => {
		const before = doc({
			type: "section",
			tag: "purpose",
			children: [
				{ type: "section", tag: "rules", children: [{ type: "paragraph", content: ["b"] }] },
			],
		});
		const pressed = press(
			before,
			{ nodeId: id.nested, role: "open" },
			"Tab",
			{ value: "rules", caret: 1, shiftKey: true },
		);

		expectOneTransaction(before, pressed);
		expect(pressed.text).toBe("<purpose>\n</purpose>\n\n<rules>\n    b\n</rules>");
		expect(pressed.moved?.caret).toBe(1);
	});
});

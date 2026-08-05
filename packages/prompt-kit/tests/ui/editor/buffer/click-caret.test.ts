import { describe, expect, test } from "bun:test";
import type { PromptBlockNode } from "../../../../src/index";

import type { XmlLine } from "../../../../src/document/render/line-model";
import { caretForLineClick, lineIndentLength } from "../../../../src/ui/editor/buffer/click-caret";

function line(
	text: string,
	node: PromptBlockNode,
	extra: Partial<XmlLine> = {},
): XmlLine {
	return {
		text,
		node,
		nodeId: node.id ?? "node",
		depth: 0,
		role: "content",
		editable: true,
		...extra,
	};
}

const paragraph: PromptBlockNode = {
	type: "paragraph",
	id: "p1",
	content: ["hello world"],
};

const bullets: PromptBlockNode = {
	type: "bulletList",
	id: "l1",
	items: [{ type: "listItem", content: ["first item"] }],
};

const raw: PromptBlockNode = {
	type: "raw",
	id: "r1",
	value: "alpha\nbeta\ngamma",
};

describe("caretForLineClick", () => {
	test("strips the rendered indent from a plain row's click offset", () => {
		const row = line("    hello world", paragraph);

		expect(lineIndentLength(row)).toBe(4);
		// Click on the "w" of "world" (display offset 10) → offset 6 in the value.
		expect(caretForLineClick(row, 10, lineIndentLength(row))).toBe(6);
	});

	test("clicks inside the indent clamp to the start of the value", () => {
		const row = line("    hello world", paragraph);

		expect(caretForLineClick(row, 0, lineIndentLength(row))).toBe(0);
		expect(caretForLineClick(row, 2, lineIndentLength(row))).toBe(0);
	});

	test("list items take the same path with a zero display prefix", () => {
		// The item's marker is separate trim, so its container renders only the
		// content: a click offset maps straight onto the editable value.
		const row = line("  - first item", bullets, {
			role: "item",
			itemIndex: 0,
		});

		expect(caretForLineClick(row, 0, 0)).toBe(0);
		expect(caretForLineClick(row, 6, 0)).toBe(6);
	});

	test("raw rows offset by the content lines above the clicked one", () => {
		const first = line("alpha", raw, { contentLineIndex: 0 });
		const second = line("beta", raw, { contentLineIndex: 1 });
		const third = line("gamma", raw, { contentLineIndex: 2 });

		expect(caretForLineClick(first, 3, 0)).toBe(3);
		expect(caretForLineClick(second, 2, 0)).toBe("alpha\n".length + 2);
		expect(caretForLineClick(third, 5, 0)).toBe("alpha\nbeta\n".length + 5);
	});

	test("a raw click past the end of its content line stops at that line's end", () => {
		const second = line("beta", raw, { contentLineIndex: 1 });

		expect(caretForLineClick(second, 99, 0)).toBe(
			"alpha\n".length + "beta".length,
		);
	});
});

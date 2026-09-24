import { describe, expect, it } from "bun:test";
import { canonicalizePrompt, type PromptDocument } from "../../../../src/index";
import { ensurePromptNodeIds, inlineToEditableText } from "../../../../src/ui/editor/model";
import { applySteps, invertStep, type PromptStep } from "../../../../src/ui/editor/transactions";
import { pasteParagraphLines } from "../../../../src/ui/editor/steps/writing-steps";
import { pasteListItemsStep } from "../../../../src/ui/editor/steps/list-item-steps";

function document(nodes: PromptDocument["nodes"]): PromptDocument {
	return ensurePromptNodeIds({kind: "prompt", schemaVersion: "prompt-kit/v1", id: "paste-ux", nodes});
}
function roundtrip(before: PromptDocument, prompt: PromptDocument, steps: PromptStep[]) {
	expect(canonicalizePrompt(applySteps(before, steps))).toBe(canonicalizePrompt(prompt));
	expect(canonicalizePrompt(applySteps(prompt, [...steps].reverse().map(invertStep)))).toBe(canonicalizePrompt(before));
}

describe("paste UX boundaries", () => {
	it("pastes nested Markdown with mixed markers, dedents, and a nested caret", () => {
		const before = document([{type: "paragraph", id: "p", content: ["Original"]}]);
		const value = "Intro\n- Parent\n  7. Child\n    - Grandchild\n  8. Sibling\n- Next\n  + Last";
		const result = pasteParagraphLines(before, "p", value, value.length)!;
		const root = result.prompt.nodes[1]!;
		if (root.type !== "bulletList") throw new Error("Expected list");
		expect(root.items.map((item) => inlineToEditableText(item.content))).toEqual(["Parent", "Next"]);
		const nested = root.items[0]!.children![0]!;
		if (nested.type !== "orderedList") throw new Error("Expected ordered child list");
		expect(nested.start).toBe(7);
		expect(nested.items.map((item) => inlineToEditableText(item.content))).toEqual(["Child", "Sibling"]);
		expect(nested.items[0]!.children![0]!.type).toBe("bulletList");
		expect(result.focusNodeId).toBe(root.items[1]!.children![0]!.id);
		expect(result.focusItemIndex).toBe(0);
		expect(result.caretOffset).toBe(4);
		expect(canonicalizePrompt(ensurePromptNodeIds(result.prompt))).toBe(canonicalizePrompt(result.prompt));
		roundtrip(before, result.prompt, result.steps);
	});
	it("nests pasted list items without mutating existing descendants and focuses the suffix", () => {
		const before = document([{type: "bulletList", id: "list", items: [{type: "listItem", content: ["PrefixTail"], children: [{type: "paragraph", id: "child", content: ["Keep"]}]}]}]);
		const snapshot = canonicalizePrompt(before);
		const result = pasteListItemsStep(before, "list", 0, "Prefix", "- Parent\n  3) Child", "Tail");
		expect(canonicalizePrompt(before)).toBe(snapshot);
		const list = result.prompt.nodes[0]!;
		if (list.type !== "bulletList") throw new Error("Expected list");
		expect(list.items).toHaveLength(1);
		expect(inlineToEditableText(list.items[0]!.content)).toBe("PrefixParent");
		expect(list.items[0]!.children![0]!.id).toBe("child");
		const focused = list.items[0]!.children![1]!;
		expect(result.focusListId).toBe(focused.id);
		if (focused.type !== "orderedList") throw new Error("Expected ordered child list");
		expect(focused.start).toBe(3);
		expect(inlineToEditableText(focused.items[0]!.content)).toBe("ChildTail");
		expect(result.caretOffset).toBe(5);
		expect(result.focusItemIndex).toBe(0);
		roundtrip(before, result.prompt, [result.step!]);
	});
	it("preserves the starting number of a pasted ordered list", () => {
		const before = document([{type: "paragraph", id: "p", content: [""]}]);
		const result = pasteParagraphLines(before, "p", "7. Seven\n8. Eight", 17)!;
		const list = result.prompt.nodes[0]!;
		if (list.type !== "orderedList") throw new Error("Expected ordered list");
		expect(list.start).toBe(7);
		roundtrip(before, result.prompt, result.steps);
	});
	it("preserves suffix on its own item when pasted text ends with a newline", () => {
		const before = document([{type: "bulletList", id: "list", items: [{type: "listItem", content: ["PrefixTail"]}]}]);
		const result = pasteListItemsStep(before, "list", 0, "Prefix", "One\nTwo\n", "Tail");
		const list = result.prompt.nodes[0]!;
		if (list.type !== "bulletList") throw new Error("Expected list");
		expect(list.items.map((item) => inlineToEditableText(item.content))).toEqual(["PrefixOne", "Two", "Tail"]);
		expect(result.focusItemIndex).toBe(2);
		expect(result.caretOffset).toBe(0);
		roundtrip(before, result.prompt, [result.step!]);
	});
	it("keeps prefix, suffix, and caret through mixed paragraphs, blank lines, and ordered markers", () => {
		const before = document([{type: "paragraph", id: "p", content: ["PrefixTail"]}]);
		const value = "PrefixOne\n\n1) First\n2) Second\nLastTail";
		const result = pasteParagraphLines(before, "p", value, value.length - 4)!;
		expect(result.prompt.nodes.map((node) => node.type)).toEqual(["paragraph", "paragraph", "orderedList", "paragraph"]);
		expect(result.caretOffset).toBe(4);
		expect(result.focusNodeId).toBe(result.prompt.nodes[3]!.id);
		roundtrip(before, result.prompt, result.steps);
	});
	it("preserves descendants and variables when replacing the middle of a nested item", () => {
		const before = document([{type: "bulletList", id: "outer", items: [{type: "listItem", content: ["Parent"], children: [{type: "orderedList", id: "nested", items: [{type: "listItem", content: ["Before", {type: "variable", name: "subject"}, "After"], children: [{type: "paragraph", id: "child", content: ["Descendant"]}]}]}]}]}]);
		const result = pasteListItemsStep(before, "nested", 0, "Before", "One\nTwo", "{{subject}}After");
		expect(JSON.stringify(result.prompt)).toContain('"name":"subject"');
		expect(JSON.stringify(result.prompt)).toContain("Descendant");
		expect(result.caretOffset).toBe(3);
		roundtrip(before, result.prompt, [result.step!]);
	});
});

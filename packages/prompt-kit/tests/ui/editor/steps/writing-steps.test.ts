import { describe, expect, it } from "bun:test";
import { canonicalizePrompt, type PromptDocument } from "../../../../src/index";
import { ensurePromptNodeIds } from "../../../../src/ui/editor/model";
import { applySteps, invertStep, type PromptStep } from "../../../../src/ui/editor/transactions";
import { autoformatParagraphLine, pasteParagraphLines } from "../../../../src/ui/editor/steps/writing-steps";
import { pasteListItemsStep } from "../../../../src/ui/editor/steps/list-item-steps";
import { convertParagraphToStep } from "../../../../src/ui/editor/steps/structure-steps";

function doc(nodes: PromptDocument["nodes"]): PromptDocument {
	return ensurePromptNodeIds({kind: "prompt", schemaVersion: "prompt-kit/v1", id: "writing", nodes});
}
function roundtrip(before: PromptDocument, result: {prompt: PromptDocument; steps: PromptStep[]}) {
	expect(canonicalizePrompt(applySteps(before, result.steps))).toBe(canonicalizePrompt(result.prompt));
	expect(canonicalizePrompt(applySteps(result.prompt, [...result.steps].reverse().map(invertStep)))).toBe(canonicalizePrompt(before));
}
describe("writing transactions", () => {
	it("undo restores a paragraph after converting only its middle line", () => {
		const before = doc([{type: "paragraph", id: "p", content: ["Before\n-\nAfter"]}]);
		const result = autoformatParagraphLine(before, "p", "Before\n- \nAfter", 7, 9)!;
		expect(result.prompt.nodes.map((node) => node.type)).toEqual(["paragraph", "bulletList", "paragraph"]);
		roundtrip(before, result);
	});
	it("undo restores a selection replaced with mixed prose and lists", () => {
		const before = doc([{type: "paragraph", id: "p", content: ["Original"]}]);
		const result = pasteParagraphLines(before, "p", "Intro\n- First\n- Second\n1. Third\nTail", 36)!;
		expect(result.prompt.nodes.map((node) => node.type)).toEqual(["paragraph", "bulletList", "orderedList", "paragraph"]);
		roundtrip(before, result);
	});
	it("paste into a nested list preserves existing descendants, assigns IDs, and undoes", () => {
		const before = doc([{type: "bulletList", id: "outer", items: [{type: "listItem", content: ["Parent"], children: [{type: "bulletList", id: "nested", items: [{type: "listItem", content: ["Original"], children: [{type: "paragraph", id: "child", content: ["Keep child"]}]}]}]}]}]);
		const result = pasteListItemsStep(before, "nested", 0, "", "- First\n- Second", "");
		expect(result.step).toBeDefined();
		expect(result.step!.op).toBe("update");
		expect(JSON.stringify(result.prompt)).toContain("Keep child");
		expect(canonicalizePrompt(ensurePromptNodeIds(result.prompt))).toBe(canonicalizePrompt(result.prompt));
		roundtrip(before, {...result, steps: [result.step!]});
	});
	it("paragraph conversion retains structured inline references across lines", () => {
		const before = doc([{type: "paragraph", id: "p", content: ["First\nSecond ", {type: "variable", name: "subject"}]}]);
		const result = convertParagraphToStep(before, "p", "bulletList")!;
		expect(result.prompt.nodes[0]!.type).toBe("bulletList");
		expect(JSON.stringify(result.prompt)).toContain('"name":"subject"');
		roundtrip(before, result);
	});
});

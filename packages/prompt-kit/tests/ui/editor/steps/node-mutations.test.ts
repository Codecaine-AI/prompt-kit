import { describe, expect, test } from "bun:test";
import {
	canonicalizePrompt,
	type ParagraphNode,
	type PromptBlockNode,
	type PromptDocument,
} from "../../../../src/index";
import {
	createPromptEditorModel,
	inlineToEditableText,
} from "../../../../src/ui/editor/model";
import {
	applyStep,
	invertStep,
	type PromptStep,
} from "../../../../src/ui/editor/transactions";

import {
	mergeParagraphsSteps,
	removeParagraphSteps,
	splitParagraphSteps,
} from "../../../../src/ui/editor/steps/node-mutations";

function doc(...nodes: PromptBlockNode[]): PromptDocument {
	return createPromptEditorModel({
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "node-mutations-test",
		nodes,
	}).prompt;
}

function paragraph(text: string): PromptBlockNode {
	return { type: "paragraph", content: [text] };
}

function texts(prompt: PromptDocument): string[] {
	return prompt.nodes
		.filter((node): node is ParagraphNode => node.type === "paragraph")
		.map((node) => inlineToEditableText(node.content));
}

function idAt(prompt: PromptDocument, index: number): string {
	return prompt.nodes[index]!.id!;
}

/**
 * A logical action's steps must round-trip: applying them in order reproduces
 * the result, and inverting them in REVERSE order returns the original.
 */
function expectRoundTrip(
	before: PromptDocument,
	steps: PromptStep[],
	after: PromptDocument,
) {
	let forward = before;
	for (const step of steps) forward = applyStep(forward, step);
	expect(canonicalizePrompt(forward)).toBe(canonicalizePrompt(after));

	let back = after;
	for (const step of [...steps].reverse()) back = applyStep(back, invertStep(step));
	expect(canonicalizePrompt(back)).toBe(canonicalizePrompt(before));
}

describe("splitParagraphSteps", () => {
	test("splits at the caret and focuses the new paragraph at offset 0", () => {
		const before = doc(paragraph("hello world"));
		const result = splitParagraphSteps(
			before,
			idAt(before, 0),
			"hello ",
			"world",
		);
		expect(texts(result.prompt)).toEqual(["hello ", "world"]);
		expect(result.caretOffset).toBe(0);
		expect(result.focusNodeId).toBe(idAt(result.prompt, 1));
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("at end-of-text it degenerates to a clean add-below", () => {
		const before = doc(paragraph("done"), paragraph("after"));
		const result = splitParagraphSteps(before, idAt(before, 0), "done", "");
		expect(texts(result.prompt)).toEqual(["done", "", "after"]);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("at caret 0 it pushes the text down into the new paragraph", () => {
		const before = doc(paragraph("text"));
		const result = splitParagraphSteps(before, idAt(before, 0), "", "text");
		expect(texts(result.prompt)).toEqual(["", "text"]);
	});

	test("commits as ONE transaction so a single undo restores the original", () => {
		const before = doc(paragraph("a b"));
		const result = splitParagraphSteps(before, idAt(before, 0), "a ", "b");
		expect(result.steps).toHaveLength(2);
		expect(result.steps.map((step) => step.op)).toEqual(["update", "insert"]);
	});
});

describe("mergeParagraphsSteps", () => {
	test("concatenates into the previous paragraph with the caret at the join", () => {
		const before = doc(paragraph("hello "), paragraph("world"));
		const result = mergeParagraphsSteps(
			before,
			idAt(before, 0),
			idAt(before, 1),
		);
		expect(texts(result.prompt)).toEqual(["hello world"]);
		expect(result.caretOffset).toBe("hello ".length);
		expect(result.focusNodeId).toBe(idAt(before, 0));
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("structured inline content survives the merge", () => {
		const before = doc(
			{ type: "paragraph", content: ["hi "] },
			{
				type: "paragraph",
				content: [{ type: "variable", name: "name" }],
			},
		);
		const result = mergeParagraphsSteps(
			before,
			idAt(before, 0),
			idAt(before, 1),
		);
		const merged = result.prompt.nodes[0] as ParagraphNode;
		expect(merged.content).toEqual([
			"hi ",
			{ type: "variable", name: "name" },
		]);
	});

	test("merging an empty paragraph up leaves the caret at the end", () => {
		const before = doc(paragraph("kept"), paragraph(""));
		const result = mergeParagraphsSteps(
			before,
			idAt(before, 0),
			idAt(before, 1),
		);
		expect(texts(result.prompt)).toEqual(["kept"]);
		expect(result.caretOffset).toBe("kept".length);
	});

	test("refuses to merge when either side is not a paragraph", () => {
		const before = doc(paragraph("text"), { type: "raw", value: "literal" });
		const result = mergeParagraphsSteps(
			before,
			idAt(before, 0),
			idAt(before, 1),
		);
		expect(result.steps).toHaveLength(0);
		expect(result.prompt).toBe(before);
	});
});

describe("removeParagraphSteps", () => {
	test("removes an empty paragraph as one invertible step", () => {
		const before = doc(paragraph("keep"), paragraph(""));
		const result = removeParagraphSteps(before, idAt(before, 1));
		expect(texts(result.prompt)).toEqual(["keep"]);
		expect(result.steps).toHaveLength(1);
		expectRoundTrip(before, result.steps, result.prompt);
	});
});

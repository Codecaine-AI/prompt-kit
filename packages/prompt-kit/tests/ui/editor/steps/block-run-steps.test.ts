import { describe, expect, it } from "bun:test";

import { canonicalizePrompt, type PromptDocument, type SectionNode } from "../../../../src/index";
import {
	applySteps,
	revertSteps,
} from "../../../../src/ui/editor/transactions";
import { moveBlocksStep, removeBlocksStep } from "../../../../src/ui/editor/steps/block-run-steps";

function paragraph(id: string) {
	return { type: "paragraph" as const, id, content: [id] };
}

function flatDoc(...ids: string[]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "block-run-doc",
		nodes: ids.map(paragraph),
	};
}

const nestedDoc: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "block-run-nested-doc",
	nodes: [
		{
			type: "section",
			tag: "steps",
			id: "sec-1",
			children: [paragraph("c1"), paragraph("c2"), paragraph("c3")],
		},
		paragraph("tail"),
	],
};

function topIds(doc: PromptDocument): (string | undefined)[] {
	return doc.nodes.map((node) => node.id);
}

function sectionChildIds(doc: PromptDocument): (string | undefined)[] {
	return (doc.nodes[0] as SectionNode).children.map((node) => node.id);
}

/** The steps must be ONE replayable, invertible transaction. */
function expectTransactionRoundTrip(
	before: PromptDocument,
	steps: Parameters<typeof applySteps>[1],
	after: PromptDocument,
) {
	expect(canonicalizePrompt(applySteps(before, steps))).toBe(
		canonicalizePrompt(after),
	);
	expect(canonicalizePrompt(revertSteps(after, steps))).toBe(
		canonicalizePrompt(before),
	);
}

describe("moveBlocksStep (contiguous block-run reorder)", () => {
	it("moves a top-level run backward, preserving order, as one invertible transaction", () => {
		const before = flatDoc("p1", "p2", "p3", "p4");
		const result = moveBlocksStep(before, null, 1, 2, 0);
		expect(topIds(result.prompt)).toEqual(["p2", "p3", "p1", "p4"]);
		expect(result.runIds).toEqual(["p2", "p3"]);
		expect(result.steps.length).toBeGreaterThan(0);
		expectTransactionRoundTrip(before, result.steps, result.prompt);
	});

	it("moves a top-level run forward with slot semantics in the ORIGINAL indexing", () => {
		const before = flatDoc("p1", "p2", "p3", "p4");
		// Slot 4 = after the last sibling.
		const result = moveBlocksStep(before, null, 0, 2, 4);
		expect(topIds(result.prompt)).toEqual(["p3", "p4", "p1", "p2"]);
		expectTransactionRoundTrip(before, result.steps, result.prompt);
	});

	it("moves a run under a SECTION parent", () => {
		const result = moveBlocksStep(nestedDoc, "sec-1", 1, 2, 0);
		expect(sectionChildIds(result.prompt)).toEqual(["c2", "c3", "c1"]);
		// The rest of the document is untouched.
		expect(topIds(result.prompt)).toEqual(["sec-1", "tail"]);
		expectTransactionRoundTrip(nestedDoc, result.steps, result.prompt);
	});

	it("a slot strictly inside the run is a no-op (the run cannot land in itself)", () => {
		const before = flatDoc("p1", "p2", "p3", "p4");
		const result = moveBlocksStep(before, null, 1, 2, 2);
		expect(result.steps).toEqual([]);
		expect(result.prompt).toBe(before);
	});

	it("the run's own edges are no-op 'put it back' slots", () => {
		const before = flatDoc("p1", "p2", "p3", "p4");
		expect(moveBlocksStep(before, null, 1, 2, 1).steps).toEqual([]);
		expect(moveBlocksStep(before, null, 1, 2, 3).steps).toEqual([]);
	});

	it("declines bad addresses: unknown parent, out-of-range run", () => {
		const before = flatDoc("p1", "p2");
		expect(moveBlocksStep(before, "missing", 0, 1, 2).steps).toEqual([]);
		expect(moveBlocksStep(before, null, 1, 2, 0).steps).toEqual([]);
		expect(moveBlocksStep(before, null, -1, 1, 0).steps).toEqual([]);
		expect(moveBlocksStep(before, null, 0, 0, 1).steps).toEqual([]);
	});
});

describe("removeBlocksStep (structural-selection run delete)", () => {
	it("removes a top-level run as one transaction; undo restores every block", () => {
		const before = flatDoc("p1", "p2", "p3", "p4");
		const result = removeBlocksStep(before, null, 1, 2);
		expect(topIds(result.prompt)).toEqual(["p1", "p4"]);
		expect(result.runIds).toEqual(["p2", "p3"]);
		expect(result.steps.every((step) => step.op === "remove")).toBe(true);
		expectTransactionRoundTrip(before, result.steps, result.prompt);
	});

	it("removes a run under a section parent (a whole subtree per block)", () => {
		const result = removeBlocksStep(nestedDoc, "sec-1", 0, 3);
		expect(sectionChildIds(result.prompt)).toEqual([]);
		expectTransactionRoundTrip(nestedDoc, result.steps, result.prompt);
	});

	it("declines out-of-range runs", () => {
		const before = flatDoc("p1", "p2");
		expect(removeBlocksStep(before, null, 1, 2).steps).toEqual([]);
		expect(removeBlocksStep(before, null, 0, 0).steps).toEqual([]);
	});
});

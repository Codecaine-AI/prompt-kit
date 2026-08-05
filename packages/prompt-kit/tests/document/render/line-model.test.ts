import { describe, expect, it } from "bun:test";
import type { PromptBlockNode, PromptDocument } from "../../../src/index";
import {
	ensurePromptNodeIds,
	PROMPT_KIT_SCHEMA_VERSION,
	renderXmlMarkdown,
} from "../../../src/index";

import {
	buildXmlLineModel,
	nodeRenderedLines,
	nodeRenderedText,
} from "../../../src/document/render/line-model";

function doc(nodes: PromptBlockNode[]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: "test-doc",
		nodes,
	};
}

function linesToString(prompt: PromptDocument): string {
	return buildXmlLineModel(prompt)
		.lines.map((line) => line.text)
		.join("\n");
}

/**
 * The whole contract: the editor's per-line model must concatenate to exactly
 * what the read-only Raw view renders. If these diverge, line numbers stop
 * tracking Raw and the "toggle editability" illusion breaks.
 */
function expectMatchesRenderer(nodes: PromptBlockNode[]) {
	const prompt = ensurePromptNodeIds(doc(nodes));
	expect(linesToString(prompt)).toBe(renderXmlMarkdown(prompt));
}

describe("buildXmlLineModel", () => {
	it("matches the renderer for a flat document with blank separators", () => {
		expectMatchesRenderer([
			{ type: "paragraph", content: ["First paragraph."] },
			{ type: "paragraph", content: ["Second paragraph."] },
		]);
	});

	it("matches the renderer for nested sections", () => {
		expectMatchesRenderer([
			{
				type: "section",
				tag: "purpose",
				children: [
					{ type: "paragraph", content: ["You are an agent."] },
					{
						type: "section",
						tag: "rules",
						children: [{ type: "paragraph", content: ["Be precise."] }],
					},
				],
			},
			{
				type: "section",
				tag: "process",
				children: [
					{
						type: "orderedList",
						items: [
							{ type: "listItem", content: ["Read."] },
							{ type: "listItem", content: ["Write."] },
						],
					},
				],
			},
		]);
	});

	it("matches the renderer for lists, fields, code, raw, example, context", () => {
		expectMatchesRenderer([
			{
				type: "bulletList",
				items: [
					{ type: "listItem", content: ["Alpha"] },
					{ type: "listItem", content: ["Beta"] },
				],
			},
			{ type: "field", label: "Model", value: ["opus"] },
			{
				type: "codeBlock",
				language: "ts",
				code: "const x = 1;\n\nconst y = 2;",
			},
			{ type: "raw", value: "line one\nline two" },
			{
				type: "example",
				title: "Sample",
				children: [{ type: "paragraph", content: ["Body."] }],
			},
			{
				type: "contextUsage",
				contextId: "researchContext",
				instructions: [{ type: "paragraph", content: ["Use it."] }],
			},
		]);
	});

	it("matches the renderer for an empty section", () => {
		expectMatchesRenderer([{ type: "section", tag: "empty", children: [] }]);
	});

	it("matches the renderer for list items with children", () => {
		expectMatchesRenderer([
			{
				type: "orderedList",
				items: [
					{
						type: "listItem",
						content: ["Parent step"],
						children: [{ type: "paragraph", content: ["Detail paragraph."] }],
					},
					{ type: "listItem", content: ["Next step"] },
				],
			},
		]);
	});

	it("tags line roles and editability", () => {
		const prompt = ensurePromptNodeIds(
			doc([
				{
					type: "section",
					tag: "purpose",
					children: [{ type: "paragraph", content: ["Hi."] }],
				},
			]),
		);
		const { lines } = buildXmlLineModel(prompt);
		expect(lines.map((line) => line.role)).toEqual(["open", "content", "close"]);
		expect(lines[1]?.editable).toBe(true);
		// A section's open tag is its name, and the name is typed in place.
		expect(lines[0]?.editable).toBe(true);
		expect(lines[2]?.editable).toBe(false);
	});

	it("carries item ids and parent block ids for annotation targeting", () => {
		const prompt = ensurePromptNodeIds(
			doc([
				{
					type: "section",
					tag: "steps",
					id: "sec-1",
					children: [
						{ type: "paragraph", id: "para-1", content: ["Intro."] },
						{
							type: "bulletList",
							id: "list-1",
							items: [
								{ type: "listItem", id: "item-1", content: ["Alpha"] },
								{
									type: "listItem",
									id: "item-2",
									content: ["Beta"],
									children: [
										{ type: "paragraph", id: "para-2", content: ["Nested."] },
									],
								},
							],
						},
					],
				},
			]),
		);
		const { lines } = buildXmlLineModel(prompt);

		// Item lines: own item id + the list as parent.
		const itemLines = lines.filter((line) => line.role === "item");
		expect(itemLines.map((line) => line.itemId)).toEqual(["item-1", "item-2"]);
		expect(itemLines.map((line) => line.parentNodeId)).toEqual([
			"list-1",
			"list-1",
		]);

		// A block nested inside a section parents to the section; a block
		// nested inside an ITEM parents to the item. Top level has no parent.
		expect(
			lines.find((line) => line.nodeId === "para-1")?.parentNodeId,
		).toBe("sec-1");
		expect(
			lines.find((line) => line.nodeId === "para-2")?.parentNodeId,
		).toBe("item-2");
		expect(
			lines.find((line) => line.nodeId === "sec-1" && line.role === "open")
				?.parentNodeId,
		).toBeUndefined();
	});

	it("resolves item ids to the item's full extent (own line plus nested blocks)", () => {
		const prompt = ensurePromptNodeIds(
			doc([
				{
					type: "bulletList",
					id: "list-1",
					items: [
						{ type: "listItem", id: "item-1", content: ["Alpha"] },
						{
							type: "listItem",
							id: "item-2",
							content: ["Beta"],
							children: [
								{ type: "paragraph", id: "para-2", content: ["Nested."] },
							],
						},
					],
				},
			]),
		);
		const { lines } = buildXmlLineModel(prompt);

		// An item's rendered text is its full extent: its own line plus any
		// blocks nested inside it (a childless item is just its line).
		expect(nodeRenderedText(lines, "item-1")).toBe("- Alpha");
		expect(nodeRenderedText(lines, "item-2")).toBe("- Beta\n    Nested.");
		expect(nodeRenderedLines(lines, "item-2").length).toBe(2);

		// The list id collects every item line plus item-nested blocks — the
		// list's whole extent, so multi-bullet ranges can quote across it.
		expect(nodeRenderedText(lines, "list-1")).toBe(
			"- Alpha\n- Beta\n    Nested.",
		);
	});

	it("keeps an attributed open tag structural", () => {
		const prompt = ensurePromptNodeIds(
			doc([
				{
					type: "section",
					tag: "example",
					attrs: { title: "One" },
					children: [{ type: "paragraph", content: ["Hi."] }],
				},
			]),
		);
		const { lines } = buildXmlLineModel(prompt);
		// The line renders more than a name, so there is nothing to type over.
		expect(lines[0]?.text.trim()).toBe('<example title="One">');
		expect(lines[0]?.editable).toBe(false);
	});
});

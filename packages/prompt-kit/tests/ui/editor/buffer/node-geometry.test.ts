import { describe, expect, it } from "bun:test";
import type { PromptBlockNode } from "../../../../src/index";

import type { XmlLine } from "../../../../src/document/render/line-model";
import { trimPaintedNodeRange } from "../../../../src/ui/editor/buffer/node-geometry";

const node: PromptBlockNode = {
	type: "raw",
	id: "raw-node",
	value: "",
};

function contentLine(text: string): XmlLine {
	return {
		text,
		node,
		nodeId: "raw-node",
		depth: 0,
		role: "content",
		editable: true,
	};
}

describe("trimPaintedNodeRange", () => {
	it("trims blank edge rows and preserves blank rows inside the paint range", () => {
		const lines = [
			contentLine(""),
			contentLine("first"),
			contentLine(""),
			contentLine("last"),
			contentLine("   "),
		];

		const trimmed = trimPaintedNodeRange(lines, { start: 0, end: 4 });

		expect(trimmed).toEqual({ start: 1, end: 3 });
		expect(
			lines
				.slice(trimmed?.start, (trimmed?.end ?? -1) + 1)
				.map((line) => line.text),
		).toEqual(["first", "", "last"]);
	});

	it("returns no paint range when every row is blank", () => {
		const lines = [contentLine(""), contentLine("  ")];

		expect(trimPaintedNodeRange(lines, { start: 0, end: 1 })).toBeUndefined();
	});
});

describe("computeItemRanges", () => {
	it("covers each item's marker row plus its nested child rows, innermost included", async () => {
		const { buildXmlLineModel } = await import("../../../../src/document/render/line-model");
		const { computeItemRanges } = await import("../../../../src/ui/editor/buffer/node-geometry");
		const prompt = {
			kind: "prompt" as const,
			schemaVersion: "prompt-kit/v1" as const,
			id: "item-ranges",
			nodes: [
				{
					type: "bulletList" as const,
					id: "list-1",
					items: [
						{
							type: "listItem" as const,
							id: "item-a",
							content: ["alpha"],
							children: [
								{
									type: "paragraph" as const,
									id: "para-a",
									content: ["alpha detail"],
								},
								{
									type: "bulletList" as const,
									id: "list-2",
									items: [
										{
											type: "listItem" as const,
											id: "item-a1",
											content: ["alpha child"],
										},
									],
								},
							],
						},
						{ type: "listItem" as const, id: "item-b", content: ["beta"] },
					],
				},
			],
		};
		const lines = buildXmlLineModel(prompt).lines;
		const ranges = computeItemRanges(lines);

		const rowOf = (predicate: (line: (typeof lines)[number]) => boolean) =>
			lines.findIndex(predicate);
		const itemARow = rowOf((line) => line.itemId === "item-a");
		const itemA1Row = rowOf((line) => line.itemId === "item-a1");
		const itemBRow = rowOf((line) => line.itemId === "item-b");
		const paraRow = rowOf((line) => line.nodeId === "para-a");

		// item-a's extent: its marker row through its LAST descendant row (the
		// nested list's item), NOT the sibling item-b — the whole multi-line
		// unit an item drag lifts, dims, and ghosts.
		expect(ranges.get("item-a")).toEqual({ start: itemARow, end: itemA1Row });
		expect(itemARow).toBeLessThan(paraRow);
		expect(paraRow).toBeLessThan(itemA1Row);
		expect(itemA1Row).toBeLessThan(itemBRow);
		// Single-line items span exactly their own row.
		expect(ranges.get("item-b")).toEqual({ start: itemBRow, end: itemBRow });
		// The nested item is its own innermost extent.
		expect(ranges.get("item-a1")).toEqual({ start: itemA1Row, end: itemA1Row });
	});
});

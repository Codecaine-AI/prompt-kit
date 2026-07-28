import { describe, expect, it } from "bun:test";
import type { PromptBlockNode } from "../../../index";

import type { XmlLine } from "../xml-line-model";
import { trimPaintedNodeRange } from "./node-geometry";

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

import { describe, expect, it } from "bun:test";

import { matchAutoformatMarker, resolveAutoformat } from "../../../../src/ui/editor/buffer/autoformat";

describe("matchAutoformatMarker", () => {
	it("reads the bullet markers", () => {
		expect(matchAutoformatMarker("- ")).toEqual({
			target: "bulletList",
			rest: "",
			markerLength: 2,
		});
		expect(matchAutoformatMarker("* ")?.target).toBe("bulletList");
	});

	it("reads numbered markers with either punctuation", () => {
		expect(matchAutoformatMarker("1. ")).toEqual({
			target: "orderedList",
			rest: "",
			markerLength: 3,
		});
		expect(matchAutoformatMarker("12) ")?.markerLength).toBe(4);
	});

	it("carries text that follows the marker", () => {
		expect(matchAutoformatMarker("- buy milk")?.rest).toBe("buy milk");
	});

	it("reads a fence and its language", () => {
		expect(matchAutoformatMarker("```")).toEqual({
			target: "codeBlock",
			rest: "",
			markerLength: 3,
		});
		expect(matchAutoformatMarker("```ts")).toEqual({
			target: "codeBlock",
			rest: "",
			language: "ts",
			markerLength: 3,
		});
	});

	it("ignores text that names no marker", () => {
		expect(matchAutoformatMarker("hello")).toBeNull();
		expect(matchAutoformatMarker("-no space")).toBeNull();
		expect(matchAutoformatMarker(" - indented")).toBeNull();
		expect(matchAutoformatMarker("a - b")).toBeNull();
	});
});

describe("resolveAutoformat", () => {
	it("fires when the marker is typed on an empty paragraph", () => {
		expect(resolveAutoformat("-", "- ")?.target).toBe("bulletList");
		expect(resolveAutoformat("1.", "1. ")?.target).toBe("orderedList");
		expect(resolveAutoformat("``", "```")?.target).toBe("codeBlock");
	});

	it("fires on a paste that starts with a marker", () => {
		const match = resolveAutoformat("", "- buy milk");
		expect(match?.target).toBe("bulletList");
		expect(match?.rest).toBe("buy milk");
	});

	it("does NOT fire when the paragraph already held prose", () => {
		// Caret parked at the start of a real paragraph, typing "- ".
		expect(resolveAutoformat("hello", "- hello")).toBeNull();
	});

	it("does not fire twice for the same marker", () => {
		expect(resolveAutoformat("- ", "- x")).toBeNull();
	});

	it("does not fire when the edit was not an append", () => {
		expect(resolveAutoformat("xyz", "- ")).toBeNull();
	});
});

import { describe, expect, test } from "bun:test";
import {
	addedLines,
	afterRegionForRun,
	findLineRun,
	lcsLineMatch,
} from "../../../src/ui/lab/staged-diff";

describe("lcsLineMatch", () => {
	test("pairs identical lines monotonically and leaves changes unmatched", () => {
		const before = ["a", "b", "c", "d"];
		const after = ["a", "x", "c", "d"];
		expect(lcsLineMatch(before, after)).toEqual([0, -1, 2, 3]);
	});

	test("handles pure inserts and deletes", () => {
		expect(lcsLineMatch(["a", "b"], ["a", "new", "b"])).toEqual([0, 2]);
		expect(lcsLineMatch(["a", "gone", "b"], ["a", "b"])).toEqual([0, -1, 1]);
	});
});

describe("afterRegionForRun", () => {
	test("maps a changed run to its replacement between the surrounding matches", () => {
		const before = ["<t>", "old one", "old two", "</t>", "tail"];
		const after = ["<t>", "new one", "new two", "new three", "</t>", "tail"];
		expect(afterRegionForRun(before, after, 1, 2)).toEqual([
			"new one",
			"new two",
			"new three",
		]);
	});

	test("a partially-changed block maps to its WHOLE replacement", () => {
		// Middle line unchanged: the region still spans the full block, so the
		// inline review shows old-block/new-block rather than minimal hunks.
		const before = ["ctx", "a1", "same", "a3", "ctx2"];
		const after = ["ctx", "b1", "same", "b3", "ctx2"];
		expect(afterRegionForRun(before, after, 1, 3)).toEqual([
			"b1",
			"same",
			"b3",
		]);
	});

	test("a run at the document edges clamps to the document edges", () => {
		const before = ["only-old"];
		const after = ["only-new-1", "only-new-2"];
		expect(afterRegionForRun(before, after, 0, 0)).toEqual([
			"only-new-1",
			"only-new-2",
		]);
	});
});

describe("findLineRun", () => {
	test("finds a contiguous run and rejects non-contiguous matches", () => {
		expect(findLineRun(["a", "b", "c", "b", "c"], ["b", "c"])).toBe(1);
		expect(findLineRun(["a", "b", "x", "c"], ["b", "c"])).toBe(-1);
		expect(findLineRun(["a"], [])).toBe(-1);
	});
});

describe("addedLines", () => {
	test("returns exactly the unmatched after lines", () => {
		expect(addedLines(["a", "b"], ["a", "n1", "b", "n2"])).toEqual([
			"n1",
			"n2",
		]);
	});
});

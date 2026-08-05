import { describe, expect, test } from "bun:test";
import type { PromptDocument, SectionNode } from "../../../index";
import { renderXmlMarkdown } from "../../../index";
import {
	updatePromptBlockNodeByIdWithStep,
} from "../transactions";

import {
	attrRowsFromAttrs,
	attrsSignature,
	buildAttrs,
	sanitizeAttributeKey,
	type AttrRow,
} from "./attrs";
import { fenceHint, normalizeLanguage } from "./languages";

describe("sanitizeAttributeKey", () => {
	test("keeps the XML name character set", () => {
		expect(sanitizeAttributeKey("data-priority")).toBe("data-priority");
		expect(sanitizeAttributeKey("xml:lang")).toBe("xml:lang");
		expect(sanitizeAttributeKey("_private")).toBe("_private");
	});

	test("folds whitespace to underscores and drops illegal characters", () => {
		expect(sanitizeAttributeKey("two words")).toBe("two_words");
		expect(sanitizeAttributeKey('a="b"')).toBe("ab");
		expect(sanitizeAttributeKey("<tag>")).toBe("tag");
	});

	test("a name cannot start with a digit", () => {
		expect(sanitizeAttributeKey("2fast")).toBe("fast");
		expect(sanitizeAttributeKey("-lead")).toBe("lead");
		expect(sanitizeAttributeKey("v2")).toBe("v2");
	});

	test("is idempotent", () => {
		const once = sanitizeAttributeKey("3 bad!name");
		expect(sanitizeAttributeKey(once)).toBe(once);
	});
});

describe("buildAttrs", () => {
	const rows = (...pairs: [string, string][]): AttrRow[] =>
		pairs.map(([key, value]) => ({ key, value }));

	test("adds an attribute", () => {
		expect(buildAttrs(rows(["priority", "high"]))).toEqual({
			attrs: { priority: "high" },
			duplicateRows: [],
		});
	});

	test("renaming a key keeps row order", () => {
		const built = buildAttrs(rows(["when", "always"], ["priority", "high"]));
		expect(Object.keys(built.attrs ?? {})).toEqual(["when", "priority"]);
	});

	test("a removed row leaves the record, and the last one clears it", () => {
		expect(buildAttrs(rows(["priority", "high"])).attrs).toEqual({
			priority: "high",
		});
		expect(buildAttrs([]).attrs).toBeUndefined();
	});

	test("a keyless row is ignored", () => {
		expect(buildAttrs(rows(["", "orphan"], ["priority", "high"]))).toEqual({
			attrs: { priority: "high" },
			duplicateRows: [],
		});
	});

	test("a duplicate key is reported, and never clobbers the first", () => {
		const built = buildAttrs(rows(["priority", "high"], ["priority", "low"]));
		expect(built.attrs).toEqual({ priority: "high" });
		expect(built.duplicateRows).toEqual([1]);
	});

	test("untouched non-string values keep their stored type", () => {
		const originals = { count: 3, live: true, note: "hi" };
		const built = buildAttrs(
			rows(["count", "3"], ["live", "true"], ["note", "there"]),
			originals,
		);
		expect(built.attrs).toEqual({ count: 3, live: true, note: "there" });
	});

	test("an edited non-string value becomes the typed string", () => {
		const built = buildAttrs(rows(["count", "4"]), { count: 3 });
		expect(built.attrs).toEqual({ count: "4" });
	});
});

describe("attrRowsFromAttrs", () => {
	test("projects every stored value to text, blank for null", () => {
		expect(attrRowsFromAttrs({ a: "x", b: 2, c: false, d: null })).toEqual([
			{ key: "a", value: "x" },
			{ key: "b", value: "2" },
			{ key: "c", value: "false" },
			{ key: "d", value: "" },
		]);
	});

	test("signature separates a missing key from an undefined value", () => {
		expect(attrsSignature({ a: undefined })).not.toBe(attrsSignature({}));
		expect(attrsSignature({ a: "1" })).toBe(attrsSignature({ a: "1" }));
	});
});

describe("normalizeLanguage", () => {
	test("keeps a fence word and clears an empty one", () => {
		expect(normalizeLanguage("ts")).toBe("ts");
		expect(normalizeLanguage("")).toBeUndefined();
		expect(normalizeLanguage("   ")).toBeUndefined();
	});

	test("drops what would break out of the fence", () => {
		expect(normalizeLanguage(" ts x ")).toBe("tsx");
		expect(normalizeLanguage("```json")).toBe("json");
	});

	test("hint shows the fence that will render", () => {
		expect(fenceHint("ts")).toBe("```ts");
		expect(fenceHint(undefined)).toBe("```");
	});
});

describe("committed edits render", () => {
	const document = (): PromptDocument => ({
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "doc",
		nodes: [
			{ type: "section", id: "s1", tag: "steps", children: [] },
			{ type: "codeBlock", id: "c1", code: "run()" },
		],
	});

	test("an attribute reaches the rendered open tag", () => {
		const { attrs } = buildAttrs([{ key: "priority", value: "high" }]);
		const result = updatePromptBlockNodeByIdWithStep(document(), "s1", (node) =>
			node.type === "section" ? ({ ...node, attrs } satisfies SectionNode) : node,
		);
		expect(result.step).toBeDefined();
		expect(renderXmlMarkdown(result.prompt)).toContain('<steps priority="high">');
	});

	test("a language reaches the rendered fence", () => {
		const result = updatePromptBlockNodeByIdWithStep(document(), "c1", (node) =>
			node.type === "codeBlock"
				? { ...node, language: normalizeLanguage("ts") }
				: node,
		);
		expect(renderXmlMarkdown(result.prompt)).toContain("```ts");
	});

	test("a section's title is dead input — it renders nothing", () => {
		const result = updatePromptBlockNodeByIdWithStep(document(), "s1", (node) =>
			node.type === "section" ? { ...node, title: "Test" } : node,
		);
		expect(renderXmlMarkdown(result.prompt)).toContain("<steps>");
		expect(renderXmlMarkdown(result.prompt)).not.toContain("Test");
	});
});

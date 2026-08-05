import { describe, expect, test } from "bun:test";

import {
	classifyRenderedLines,
	type RenderedLineInfo,
} from "../../../src/ui/view/rendered-line-model";

function roles(content: string): string[] {
	return classifyRenderedLines(content).map((info) => info.role);
}

describe("classifyRenderedLines", () => {
	test("returns one entry per split line, in order", () => {
		const content = "<a>\nhello\n</a>";
		const infos = classifyRenderedLines(content);
		expect(infos.length).toBe(content.split("\n").length);
	});

	test("empty string classifies as a single depth-0 gap", () => {
		expect(classifyRenderedLines("")).toEqual([{ role: "gap", depth: 0 }]);
	});

	test("nested sections: open/close depths pair with their openers", () => {
		const content = [
			"<outer>", // open, depth 0 (before push)
			"    <inner>", // open, depth 1
			"        text", // content, depth 2
			"    </inner>", // close, depth 1 (matches its opener)
			"</outer>", // close, depth 0
		].join("\n");
		expect(classifyRenderedLines(content)).toEqual([
			{ role: "open", depth: 0 },
			{ role: "open", depth: 1 },
			{ role: "content", depth: 2 },
			{ role: "close", depth: 1 },
			{ role: "close", depth: 0 },
		] satisfies RenderedLineInfo[]);
	});

	test("attributed open tags still classify as open", () => {
		const content = [
			'<section name="rules" priority="high">',
			"    body",
			"</section>",
		].join("\n");
		expect(classifyRenderedLines(content)).toEqual([
			{ role: "open", depth: 0 },
			{ role: "content", depth: 1 },
			{ role: "close", depth: 0 },
		]);
	});

	test("list items: dash, star, and ordered markers at any indent", () => {
		const content = [
			"<list>",
			"    - dash item",
			"    * star item",
			"    12. ordered item",
			"    1.shorthand ordered",
			"</list>",
		].join("\n");
		expect(roles(content)).toEqual([
			"open",
			"item",
			"item",
			"item",
			"item",
			"close",
		]);
	});

	test("markers without trailing whitespace are not items (except N.)", () => {
		const content = ["--- rule-ish", "*emphasis*", "-tight"].join("\n");
		expect(roles(content)).toEqual(["content", "content", "content"]);
	});

	test("blank and whitespace-only lines are gaps at the current stack depth", () => {
		const content = [
			"", // gap, depth 0
			"<a>",
			"", // gap, depth 1
			"    <b>",
			"   ", // whitespace-only gap, depth 2
			"    </b>",
			"</a>",
			"", // gap, depth 0 again
		].join("\n");
		expect(classifyRenderedLines(content)).toEqual([
			{ role: "gap", depth: 0, gapBeforeOpenDepth: 0 },
			{ role: "open", depth: 0 },
			{ role: "gap", depth: 1, gapBeforeOpenDepth: 1 },
			{ role: "open", depth: 1 },
			{ role: "gap", depth: 2 },
			{ role: "close", depth: 1 },
			{ role: "close", depth: 0 },
			{ role: "gap", depth: 0 },
		]);
	});

	test("gaps carry the following opener's depth, and only then", () => {
		const content = [
			"<a>", // open, depth 0
			"    one", // content, depth 1
			"", // gap before content -> untagged
			"    two", // content, depth 1
			"", // gap before close -> untagged
			"</a>", // close, depth 0
			"", // gap in a run before an open -> tagged 0
			"", // gap directly before the open -> tagged 0
			"<b>", // open, depth 0
			"</b>", // close, depth 0
			"", // trailing gap (EOF) -> untagged
		].join("\n");
		expect(
			classifyRenderedLines(content).map((info) => info.gapBeforeOpenDepth),
		).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			0,
			0,
			undefined,
			undefined,
			undefined,
		]);
	});

	test("fences suppress tag, gap, and item classification inside", () => {
		const content = [
			"<doc>",
			"    ```xml",
			"    <fake>",
			"", // blank inside fence: still content
			"    - not an item",
			"    </fake>",
			"    ```",
			"    after",
			"</doc>",
		].join("\n");
		expect(classifyRenderedLines(content)).toEqual([
			{ role: "open", depth: 0 },
			{ role: "content", depth: 1 }, // opening fence
			{ role: "content", depth: 1 },
			{ role: "content", depth: 1 },
			{ role: "content", depth: 1 },
			{ role: "content", depth: 1 }, // </fake> does NOT pop
			{ role: "content", depth: 1 }, // closing fence
			{ role: "content", depth: 1 },
			{ role: "close", depth: 0 },
		]);
	});

	test("unterminated fence runs to end of input without corrupting the stack", () => {
		const content = ["<a>", "    ```", "    </a>", "    <b>"].join("\n");
		expect(classifyRenderedLines(content)).toEqual([
			{ role: "open", depth: 0 },
			{ role: "content", depth: 1 },
			{ role: "content", depth: 1 },
			{ role: "content", depth: 1 },
		]);
	});

	test("prose with inline tag references is content, not open/close", () => {
		const content = [
			"<rules>",
			"    Use the <look> tool before editing.",
			"    Wrap output in <result> and </result> markers.",
			"    a <b> c",
			"</rules>",
		].join("\n");
		expect(roles(content)).toEqual([
			"open",
			"content",
			"content",
			"content",
			"close",
		]);
	});

	test("open tag followed by text on the same line is content", () => {
		expect(roles("<name>value</name>")).toEqual(["content"]);
		expect(roles("<a><b>")).toEqual(["content"]);
	});

	test("self-closing tags are content and never push the stack", () => {
		const content = ["<a>", "    <hr/>", '    <img src="x" />', "</a>"].join(
			"\n",
		);
		expect(classifyRenderedLines(content)).toEqual([
			{ role: "open", depth: 0 },
			{ role: "content", depth: 1 },
			{ role: "content", depth: 1 },
			{ role: "close", depth: 0 },
		]);
	});

	test("unbalanced close never yields negative depth", () => {
		const content = ["</stray>", "text"].join("\n");
		expect(classifyRenderedLines(content)).toEqual([
			{ role: "close", depth: 0 },
			{ role: "content", depth: 0 },
		]);
	});

	test("tag names with digits, underscores, and hyphens are recognized", () => {
		const content = ["<state_grammar-v2>", "    x", "</state_grammar-v2>"].join(
			"\n",
		);
		expect(roles(content)).toEqual(["open", "content", "close"]);
	});

	test("depth tracking survives siblings at multiple levels", () => {
		const content = [
			"<a>",
			"    <b>",
			"    </b>",
			"",
			"    <c>",
			"        deep",
			"    </c>",
			"</a>",
		].join("\n");
		expect(classifyRenderedLines(content)).toEqual([
			{ role: "open", depth: 0 },
			{ role: "open", depth: 1 },
			{ role: "close", depth: 1 },
			{ role: "gap", depth: 1, gapBeforeOpenDepth: 1 },
			{ role: "open", depth: 1 },
			{ role: "content", depth: 2 },
			{ role: "close", depth: 1 },
			{ role: "close", depth: 0 },
		]);
	});
});

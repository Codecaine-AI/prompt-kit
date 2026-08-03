import { describe, expect, test } from "bun:test";
import {
	canonicalizePrompt,
	renderXmlMarkdown,
	type BulletListNode,
	type CodeBlockNode,
	type ListItemNode,
	type OrderedListNode,
	type ParagraphNode,
	type PromptBlockNode,
	type PromptDocument,
	type SectionNode,
} from "../../../index";
import {
	applyStep,
	createPromptEditorModel,
	inlineToEditableText,
	invertStep,
	type PromptStep,
} from "../../editors";

import {
	convertBlockToParagraphStep,
	convertParagraphToStep,
	demoteSectionStep,
	escapeListStep,
	indentParagraphIntoSectionStep,
	outdentParagraphStep,
	promoteSectionStep,
} from "./structure-steps";

/* --------------------------------------------------------------- *
 * Fixtures
 * --------------------------------------------------------------- */

/** Builds a document with ids assigned exactly as the editor assigns them. */
function doc(...nodes: PromptBlockNode[]): PromptDocument {
	return createPromptEditorModel({
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "structure-steps-test",
		nodes,
	}).prompt;
}

/** Builds a document verbatim, so fixtures can pin their own ids. */
function rawDoc(...nodes: PromptBlockNode[]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "structure-steps-test",
		nodes,
	};
}

function paragraph(text: string, id?: string): ParagraphNode {
	return { type: "paragraph", ...(id ? { id } : {}), content: [text] };
}

function section(
	tag: string,
	children: PromptBlockNode[],
	id?: string,
): SectionNode {
	return { type: "section", ...(id ? { id } : {}), tag, children };
}

function item(text: string, children?: ListItemNode["children"]): ListItemNode {
	return {
		type: "listItem",
		content: [text],
		...(children ? { children } : {}),
	};
}

function bulletList(id: string, ...items: ListItemNode[]): BulletListNode {
	return { type: "bulletList", id, items };
}

/* --------------------------------------------------------------- *
 * Assertions
 * --------------------------------------------------------------- */

/**
 * A gesture's steps must round-trip: applying them in order reproduces the
 * result, and inverting them in REVERSE order restores the original document
 * byte-for-byte (canonical form, which includes node ids).
 */
function expectRoundTrip(
	before: PromptDocument,
	steps: PromptStep[],
	after: PromptDocument,
) {
	expect(steps.length).toBeGreaterThan(0);
	let forward = before;
	for (const step of steps) forward = applyStep(forward, step);
	expect(canonicalizePrompt(forward)).toBe(canonicalizePrompt(after));

	let back = after;
	for (const step of [...steps].reverse()) {
		back = applyStep(back, invertStep(step));
	}
	expect(canonicalizePrompt(back)).toBe(canonicalizePrompt(before));
}

function nodeById(
	prompt: PromptDocument,
	id: string,
): PromptBlockNode | undefined {
	const walk = (
		nodes: readonly PromptBlockNode[],
	): PromptBlockNode | undefined => {
		for (const node of nodes) {
			if (node.id === id) return node;
			const children =
				node.type === "section" || node.type === "example"
					? node.children
					: undefined;
			if (!children) continue;
			const found = walk(children);
			if (found) return found;
		}
		return undefined;
	};
	return walk(prompt.nodes);
}

function firstList(prompt: PromptDocument): BulletListNode {
	return prompt.nodes[0] as BulletListNode;
}

function itemTexts(list: BulletListNode | OrderedListNode): string[] {
	return list.items.map((entry) => inlineToEditableText(entry.content));
}

/* --------------------------------------------------------------- *
 * 1. escapeListStep
 * --------------------------------------------------------------- */

describe("escapeListStep — Enter on an empty list item", () => {
	test("drops the empty trailing item and opens a paragraph after the list", () => {
		const before = rawDoc(bulletList("list1", item("a"), item("")));
		const result = escapeListStep(before, "list1", 1)!;
		expect(result).not.toBeNull();
		expect(itemTexts(firstList(result.prompt))).toEqual(["a"]);
		expect(result.prompt.nodes).toHaveLength(2);
		expect(result.prompt.nodes[1]!.type).toBe("paragraph");
		expect(result.focusNodeId).toBe(result.prompt.nodes[1]!.id!);
		expect(result.caretOffset).toBe(0);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("the only item takes the whole list with it, paragraph in its place", () => {
		const before = rawDoc(
			paragraph("intro", "p1"),
			bulletList("list1", item("")),
			paragraph("outro", "p2"),
		);
		const result = escapeListStep(before, "list1", 0)!;
		expect(result.prompt.nodes.map((node) => node.type)).toEqual([
			"paragraph",
			"paragraph",
			"paragraph",
		]);
		// The paragraph lands exactly where the list was.
		expect(result.prompt.nodes[1]!.id).toBe(result.focusNodeId!);
		expect(renderXmlMarkdown(result.prompt)).toBe("intro\n\noutro");
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("a list inside a section escapes to the section's level, not the root", () => {
		const before = rawDoc(
			section("rules", [paragraph("keep", "p1"), bulletList("list1", item(""))], "sec1"),
		);
		const result = escapeListStep(before, "list1", 0)!;
		const parent = nodeById(result.prompt, "sec1") as SectionNode;
		expect(parent.children.map((child) => child.type)).toEqual([
			"paragraph",
			"paragraph",
		]);
		expect(result.prompt.nodes).toHaveLength(1);
		// The new empty paragraph renders as an indented blank line inside the
		// section — the renderer only drops nodes that render to nothing at all.
		expect(renderXmlMarkdown(result.prompt)).toBe(
			"<rules>\n    keep\n\n    \n</rules>",
		);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("escaping from the middle of a list leaves the tail items in place", () => {
		const before = rawDoc(bulletList("list1", item("a"), item(""), item("c")));
		const result = escapeListStep(before, "list1", 1)!;
		expect(itemTexts(firstList(result.prompt))).toEqual(["a", "c"]);
		expect(result.prompt.nodes[1]!.type).toBe("paragraph");
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("a nested empty item outdents one level instead of leaving the list", () => {
		const before = rawDoc(
			bulletList(
				"outer",
				item("parent", [bulletList("inner", item("kept"), item(""))]),
			),
		);
		const result = escapeListStep(before, "inner", 1)!;
		const outer = firstList(result.prompt);
		expect(itemTexts(outer)).toEqual(["parent", ""]);
		const inner = outer.items[0]!.children![0] as BulletListNode;
		expect(itemTexts(inner)).toEqual(["kept"]);
		expect(result.focusNodeId).toBe("outer");
		expect(result.focusItemIndex).toBe(1);
		expect(result.caretOffset).toBe(0);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("outdenting the only nested item drops the empty child list", () => {
		const before = rawDoc(
			bulletList("outer", item("parent", [bulletList("inner", item(""))])),
		);
		const result = escapeListStep(before, "inner", 0)!;
		const outer = firstList(result.prompt);
		expect(itemTexts(outer)).toEqual(["parent", ""]);
		expect(outer.items[0]!.children).toBeUndefined();
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("a doubly nested item outdents into the list one level up", () => {
		const before = rawDoc(
			bulletList(
				"outer",
				item("top", [
					bulletList("mid", item("middle", [bulletList("deep", item(""))])),
				]),
			),
		);
		const result = escapeListStep(before, "deep", 0)!;
		const mid = firstList(result.prompt).items[0]!.children![0] as BulletListNode;
		expect(itemTexts(mid)).toEqual(["middle", ""]);
		expect(result.focusNodeId).toBe("mid");
		expect(result.focusItemIndex).toBe(1);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("declines on an item that still holds text", () => {
		const before = rawDoc(bulletList("list1", item("a"), item("b")));
		expect(escapeListStep(before, "list1", 1)).toBeNull();
	});

	test("declines on an empty item that still holds nested children", () => {
		const before = rawDoc(
			bulletList("list1", item("", [bulletList("inner", item("child"))])),
		);
		expect(escapeListStep(before, "list1", 0)).toBeNull();
	});

	test("declines on an unknown list or item index", () => {
		const before = rawDoc(bulletList("list1", item("")));
		expect(escapeListStep(before, "missing", 0)).toBeNull();
		expect(escapeListStep(before, "list1", 7)).toBeNull();
	});
});

/* --------------------------------------------------------------- *
 * 2. outdentParagraphStep
 * --------------------------------------------------------------- */

describe("outdentParagraphStep", () => {
	test("moves a paragraph out to sit after its section, keeping its id", () => {
		const before = rawDoc(
			section("rules", [paragraph("kept", "p1"), paragraph("", "p2")], "sec1"),
			paragraph("tail", "p3"),
		);
		const result = outdentParagraphStep(before, "p2")!;
		expect(result.prompt.nodes.map((node) => node.id)).toEqual([
			"sec1",
			"p2",
			"p3",
		]);
		expect((nodeById(result.prompt, "sec1") as SectionNode).children).toHaveLength(1);
		expect(result.focusNodeId).toBe("p2");
		expect(result.caretOffset).toBe(0);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("the caret defaults to the end of the paragraph's text", () => {
		const before = rawDoc(section("rules", [paragraph("hello", "p1")], "sec1"));
		const result = outdentParagraphStep(before, "p1")!;
		expect(result.caretOffset).toBe("hello".length);
		expect(outdentParagraphStep(before, "p1", 2)!.caretOffset).toBe(2);
	});

	test("emptying a section leaves a self-contained open/close pair", () => {
		const before = rawDoc(section("rules", [paragraph("only", "p1")], "sec1"));
		const result = outdentParagraphStep(before, "p1")!;
		expect(renderXmlMarkdown(result.prompt)).toBe("<rules>\n</rules>\n\nonly");
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("climbs exactly one level out of a nested section", () => {
		const before = rawDoc(
			section(
				"outer",
				[section("inner", [paragraph("deep", "p1")], "sec2")],
				"sec1",
			),
		);
		const result = outdentParagraphStep(before, "p1")!;
		const outer = nodeById(result.prompt, "sec1") as SectionNode;
		expect(outer.children.map((child) => child.id)).toEqual(["sec2", "p1"]);
		expect(renderXmlMarkdown(result.prompt)).toBe(
			"<outer>\n    <inner>\n    </inner>\n\n    deep\n</outer>",
		);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("is a no-op at the document root or on a non-paragraph", () => {
		const before = rawDoc(paragraph("root", "p1"), section("rules", [], "sec1"));
		expect(outdentParagraphStep(before, "p1")).toBeNull();
		expect(outdentParagraphStep(before, "sec1")).toBeNull();
		expect(outdentParagraphStep(before, "missing")).toBeNull();
	});
});

/* --------------------------------------------------------------- *
 * 3. indentParagraphIntoSectionStep
 * --------------------------------------------------------------- */

describe("indentParagraphIntoSectionStep", () => {
	test("appends the paragraph as the preceding section's last child", () => {
		const before = rawDoc(
			section("rules", [paragraph("first", "p1")], "sec1"),
			paragraph("moved", "p2"),
			paragraph("after", "p3"),
		);
		const result = indentParagraphIntoSectionStep(before, "p2", 3)!;
		const target = nodeById(result.prompt, "sec1") as SectionNode;
		expect(target.children.map((child) => child.id)).toEqual(["p1", "p2"]);
		expect(result.prompt.nodes.map((node) => node.id)).toEqual(["sec1", "p3"]);
		expect(result.focusNodeId).toBe("p2");
		expect(result.caretOffset).toBe(3);
		expect(renderXmlMarkdown(result.prompt)).toBe(
			"<rules>\n    first\n\n    moved\n</rules>\n\nafter",
		);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("indents into an empty section", () => {
		const before = rawDoc(section("rules", [], "sec1"), paragraph("solo", "p1"));
		const result = indentParagraphIntoSectionStep(before, "p1")!;
		expect((nodeById(result.prompt, "sec1") as SectionNode).children).toHaveLength(1);
		expect(result.caretOffset).toBe("solo".length);
		expect(renderXmlMarkdown(result.prompt)).toBe("<rules>\n    solo\n</rules>");
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("works one level down, inside another section", () => {
		const before = rawDoc(
			section(
				"outer",
				[section("inner", [], "sec2"), paragraph("moved", "p1")],
				"sec1",
			),
		);
		const result = indentParagraphIntoSectionStep(before, "p1")!;
		const inner = nodeById(result.prompt, "sec2") as SectionNode;
		expect(inner.children.map((child) => child.id)).toEqual(["p1"]);
		expect((nodeById(result.prompt, "sec1") as SectionNode).children).toHaveLength(1);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("is a no-op without a preceding section", () => {
		const before = rawDoc(
			paragraph("first", "p1"),
			paragraph("second", "p2"),
			section("rules", [], "sec1"),
		);
		// No previous sibling at all.
		expect(indentParagraphIntoSectionStep(before, "p1")).toBeNull();
		// Previous sibling is a paragraph, not a section.
		expect(indentParagraphIntoSectionStep(before, "p2")).toBeNull();
		// Not a paragraph.
		expect(indentParagraphIntoSectionStep(before, "sec1")).toBeNull();
	});

	test("indent then outdent restores the document exactly", () => {
		const before = rawDoc(
			section("rules", [paragraph("first", "p1")], "sec1"),
			paragraph("moved", "p2"),
		);
		const indented = indentParagraphIntoSectionStep(before, "p2")!;
		const restored = outdentParagraphStep(indented.prompt, "p2")!;
		expect(canonicalizePrompt(restored.prompt)).toBe(canonicalizePrompt(before));
	});
});

/* --------------------------------------------------------------- *
 * 4. demoteSectionStep / promoteSectionStep
 * --------------------------------------------------------------- */

describe("demoteSectionStep", () => {
	test("nests a section under the previous sibling section, children and all", () => {
		const before = rawDoc(
			section("outer", [paragraph("kept", "p1")], "sec1"),
			section("moved", [paragraph("child", "p2")], "sec2"),
			paragraph("tail", "p3"),
		);
		const result = demoteSectionStep(before, "sec2")!;
		const outer = nodeById(result.prompt, "sec1") as SectionNode;
		expect(outer.children.map((child) => child.id)).toEqual(["p1", "sec2"]);
		expect(result.prompt.nodes.map((node) => node.id)).toEqual(["sec1", "p3"]);
		expect(result.focusNodeId).toBe("sec2");
		expect(renderXmlMarkdown(result.prompt)).toBe(
			"<outer>\n    kept\n\n    <moved>\n        child\n    </moved>\n</outer>\n\ntail",
		);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("demotes inside a section too", () => {
		const before = rawDoc(
			section(
				"root",
				[section("a", [], "secA"), section("b", [], "secB")],
				"sec1",
			),
		);
		const result = demoteSectionStep(before, "secB")!;
		const a = nodeById(result.prompt, "secA") as SectionNode;
		expect(a.children.map((child) => child.id)).toEqual(["secB"]);
		expect((nodeById(result.prompt, "sec1") as SectionNode).children).toHaveLength(1);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("is a no-op for the first sibling, a non-section neighbour, or a non-section", () => {
		const before = rawDoc(
			section("first", [], "sec1"),
			paragraph("between", "p1"),
			section("third", [], "sec2"),
		);
		expect(demoteSectionStep(before, "sec1")).toBeNull();
		expect(demoteSectionStep(before, "sec2")).toBeNull();
		expect(demoteSectionStep(before, "p1")).toBeNull();
	});
});

describe("promoteSectionStep", () => {
	test("lifts a nested section out to follow its parent", () => {
		const before = rawDoc(
			section(
				"outer",
				[paragraph("kept", "p1"), section("inner", [paragraph("deep", "p2")], "sec2")],
				"sec1",
			),
			paragraph("tail", "p3"),
		);
		const result = promoteSectionStep(before, "sec2")!;
		expect(result.prompt.nodes.map((node) => node.id)).toEqual([
			"sec1",
			"sec2",
			"p3",
		]);
		expect((nodeById(result.prompt, "sec2") as SectionNode).children).toHaveLength(1);
		expect(result.focusNodeId).toBe("sec2");
		expect(renderXmlMarkdown(result.prompt)).toBe(
			"<outer>\n    kept\n</outer>\n\n<inner>\n    deep\n</inner>\n\ntail",
		);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("a middle child lands directly after its former parent", () => {
		const before = rawDoc(
			section(
				"outer",
				[section("inner", [], "sec2"), paragraph("after", "p1")],
				"sec1",
			),
		);
		const result = promoteSectionStep(before, "sec2")!;
		expect(result.prompt.nodes.map((node) => node.id)).toEqual(["sec1", "sec2"]);
		expect((nodeById(result.prompt, "sec1") as SectionNode).children.map((c) => c.id)).toEqual([
			"p1",
		]);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("is a no-op at the top level or on a non-section", () => {
		const before = rawDoc(section("only", [paragraph("p", "p1")], "sec1"));
		expect(promoteSectionStep(before, "sec1")).toBeNull();
		expect(promoteSectionStep(before, "p1")).toBeNull();
		expect(promoteSectionStep(before, "missing")).toBeNull();
	});

	test("demote then promote restores the document exactly", () => {
		const before = rawDoc(
			section("a", [paragraph("one", "p1")], "secA"),
			section("b", [paragraph("two", "p2")], "secB"),
		);
		const demoted = demoteSectionStep(before, "secB")!;
		const restored = promoteSectionStep(demoted.prompt, "secB")!;
		expect(canonicalizePrompt(restored.prompt)).toBe(canonicalizePrompt(before));
	});
});

/* --------------------------------------------------------------- *
 * 5. convertParagraphToStep
 * --------------------------------------------------------------- */

describe("convertParagraphToStep", () => {
	test("an empty paragraph becomes a one-item bullet list in place", () => {
		const before = doc(paragraph("before"), paragraph(""), paragraph("after"));
		const id = before.nodes[1]!.id!;
		const result = convertParagraphToStep(before, id, "bulletList")!;
		const list = result.prompt.nodes[1] as BulletListNode;
		expect(list.type).toBe("bulletList");
		expect(list.id).toBe(id);
		expect(itemTexts(list)).toEqual([""]);
		expect(result.focusNodeId).toBe(id);
		expect(result.focusItemIndex).toBe(0);
		expect(result.caretOffset).toBe(0);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]!.op).toBe("update");
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("text on the paragraph is carried into the first item", () => {
		const before = doc(paragraph("write tests"));
		const id = before.nodes[0]!.id!;
		const result = convertParagraphToStep(before, id, "bulletList")!;
		expect(itemTexts(result.prompt.nodes[0] as BulletListNode)).toEqual([
			"write tests",
		]);
		expect(result.caretOffset).toBe("write tests".length);
		expect(renderXmlMarkdown(result.prompt)).toBe("- write tests");
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("orderedList renders with a numeric marker", () => {
		const before = doc(paragraph("step one"));
		const id = before.nodes[0]!.id!;
		const result = convertParagraphToStep(before, id, "orderedList")!;
		expect((result.prompt.nodes[0] as OrderedListNode).type).toBe("orderedList");
		expect(renderXmlMarkdown(result.prompt)).toBe("1. step one");
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("codeBlock takes the text as its body, with an optional language", () => {
		const before = doc(paragraph("const x = 1;"));
		const id = before.nodes[0]!.id!;
		const bare = convertParagraphToStep(before, id, "codeBlock")!;
		expect((bare.prompt.nodes[0] as CodeBlockNode).language).toBeUndefined();
		expect(renderXmlMarkdown(bare.prompt)).toBe("```\nconst x = 1;\n```");

		const typed = convertParagraphToStep(before, id, "codeBlock", {
			language: "ts",
		})!;
		const block = typed.prompt.nodes[0] as CodeBlockNode;
		expect(block.language).toBe("ts");
		expect(block.code).toBe("const x = 1;");
		expect(typed.caretOffset).toBe("const x = 1;".length);
		expectRoundTrip(before, typed.steps, typed.prompt);
	});

	test("section wraps the text in a child paragraph and focuses it", () => {
		const before = doc(paragraph("guidance"));
		const id = before.nodes[0]!.id!;
		const result = convertParagraphToStep(before, id, "section")!;
		const created = result.prompt.nodes[0] as SectionNode;
		expect(created.type).toBe("section");
		expect(created.id).toBe(id);
		expect(created.tag).toBe("section");
		expect(created.children).toHaveLength(1);
		// The new child paragraph is addressable, so the caller can focus it.
		const child = created.children[0]!;
		expect(child.id).toBeDefined();
		expect(child.id).not.toBe(id);
		expect(result.focusNodeId).toBe(child.id!);
		expect(result.caretOffset).toBe("guidance".length);
		expect(renderXmlMarkdown(result.prompt)).toBe(
			"<section>\n    guidance\n</section>",
		);
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("section honours a custom tag", () => {
		const before = doc(paragraph(""));
		const id = before.nodes[0]!.id!;
		const result = convertParagraphToStep(before, id, "section", {
			tag: "rules",
		})!;
		expect((result.prompt.nodes[0] as SectionNode).tag).toBe("rules");
		expect(renderXmlMarkdown(result.prompt)).toBe("<rules>\n    \n</rules>");
	});

	test("autoformat can override the carried content (marker already stripped)", () => {
		const before = doc(paragraph("- todo"));
		const id = before.nodes[0]!.id!;
		const result = convertParagraphToStep(before, id, "bulletList", {
			content: ["todo"],
		})!;
		expect(itemTexts(result.prompt.nodes[0] as BulletListNode)).toEqual(["todo"]);
		expect(renderXmlMarkdown(result.prompt)).toBe("- todo");
	});

	test("structured inline survives, and adjacent text runs coalesce", () => {
		const before = doc({
			type: "paragraph",
			content: ["hello ", "there ", { type: "variable", name: "name" }],
		});
		const id = before.nodes[0]!.id!;
		const result = convertParagraphToStep(before, id, "bulletList")!;
		const list = result.prompt.nodes[0] as BulletListNode;
		// Split runs would render identically but canonicalize differently, so a
		// conversion must leave exactly what typing the same characters gives.
		expect(list.items[0]!.content).toEqual([
			"hello there ",
			{ type: "variable", name: "name" },
		]);
		const typed = doc({
			type: "bulletList",
			items: [
				{
					type: "listItem",
					content: ["hello there ", { type: "variable", name: "name" }],
				},
			],
		});
		expect(renderXmlMarkdown(result.prompt)).toBe(renderXmlMarkdown(typed));
	});

	test("preserves position among siblings", () => {
		const before = doc(paragraph("one"), paragraph("two"), paragraph("three"));
		const id = before.nodes[1]!.id!;
		const result = convertParagraphToStep(before, id, "bulletList")!;
		expect(renderXmlMarkdown(result.prompt)).toBe("one\n\n- two\n\nthree");
	});

	test("converts a paragraph nested inside a section", () => {
		const before = rawDoc(section("rules", [paragraph("nested", "p1")], "sec1"));
		const result = convertParagraphToStep(before, "p1", "bulletList")!;
		const parent = nodeById(result.prompt, "sec1") as SectionNode;
		expect(parent.children[0]!.type).toBe("bulletList");
		expect(renderXmlMarkdown(result.prompt)).toBe("<rules>\n    - nested\n</rules>");
		expectRoundTrip(before, result.steps, result.prompt);
	});

	test("is a no-op on a missing node or a non-paragraph", () => {
		const before = rawDoc(bulletList("list1", item("a")), paragraph("p", "p1"));
		expect(convertParagraphToStep(before, "list1", "section")).toBeNull();
		expect(convertParagraphToStep(before, "missing", "section")).toBeNull();
		expect(convertParagraphToStep(before, "p1", "section")).not.toBeNull();
	});

	test("convert then escape returns to the original rendered prompt", () => {
		const before = doc(paragraph("keep"), paragraph(""));
		const id = before.nodes[1]!.id!;
		const converted = convertParagraphToStep(before, id, "bulletList")!;
		const escaped = escapeListStep(converted.prompt, id, 0)!;
		// Ids are re-minted for the fresh paragraph, but the rendered document —
		// the byte-level contract — is unchanged.
		expect(renderXmlMarkdown(escaped.prompt)).toBe(renderXmlMarkdown(before));
		expect(escaped.prompt.nodes.map((node) => node.type)).toEqual([
			"paragraph",
			"paragraph",
		]);
	});
});

/* --------------------------------------------------------------- *
 * Taking a markdown marker back
 * --------------------------------------------------------------- */

describe("convertBlockToParagraphStep", () => {
	test("returns the literal marker a conversion swallowed", () => {
		const before = doc(paragraph(""));
		const id = before.nodes[0]!.id!;
		const converted = convertParagraphToStep(before, id, "bulletList")!;
		const reverted = convertBlockToParagraphStep(converted.prompt, id, "- ")!;

		expect(renderXmlMarkdown(reverted.prompt)).toBe("- ");
		expect(reverted.focusNodeId).toBe(id);
		// The caret sits after the characters that came back.
		expect(reverted.caretOffset).toBe(2);
		expectRoundTrip(converted.prompt, reverted.steps, reverted.prompt);
	});

	test("round-trips a fence back to its three backticks", () => {
		const before = doc(paragraph("keep"), paragraph(""));
		const id = before.nodes[1]!.id!;
		const converted = convertParagraphToStep(before, id, "codeBlock")!;
		const reverted = convertBlockToParagraphStep(converted.prompt, id, "```")!;

		expect(canonicalizePrompt(reverted.prompt)).toBe(
			canonicalizePrompt(
				doc(paragraph("keep"), paragraph("```")),
			),
		);
	});

	test("declines on a paragraph or a missing node", () => {
		const before = doc(paragraph("text"));
		const id = before.nodes[0]!.id!;
		expect(convertBlockToParagraphStep(before, id, "- ")).toBeNull();
		expect(convertBlockToParagraphStep(before, "missing", "- ")).toBeNull();
	});
});

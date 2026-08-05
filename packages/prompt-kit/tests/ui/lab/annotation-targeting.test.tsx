import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import type { PromptDocument } from "../../../src/index";
import {
	createPromptEditorModel,
} from "../../../src/ui/editor/model";
import { PromptFlowXml } from "../../../src/ui/editor/buffer";
import {
	buildXmlLineModel,
	nodeRenderedText,
	type XmlLine,
} from "../../../src/document/render/line-model";
import {
	annotationRowElements,
	annotationScopeChain,
	buildAnnotationParentMap,
	mapDomRangeToPromptRange,
	promptRangeRowElements,
	nodeRowElements,
	rowDisplayRegions,
} from "../../../src/ui/lab/annotation-targeting";

afterEach(() => {
	cleanup();
});

const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "map-doc",
	nodes: [
		{
			type: "section",
			tag: "context",
			id: "sec-1",
			children: [
				{ type: "paragraph", id: "para-1", content: ["Hello world"] },
				{
					type: "bulletList",
					id: "list-1",
					items: [
						{ type: "listItem", id: "item-1", content: ["First item"] },
						{ type: "listItem", id: "item-2", content: ["Second item"] },
					],
				},
				{
					type: "bulletList",
					id: "list-2",
					items: [
						{ type: "listItem", id: "item-3", content: ["Third item"] },
					],
				},
			],
		},
		{
			type: "section",
			tag: "rules",
			id: "sec-2",
			children: [
				{ type: "paragraph", id: "para-2", content: ["Standalone tail"] },
			],
		},
	],
};

function renderSurface(): { container: HTMLElement; lines: readonly XmlLine[] } {
	const model = createPromptEditorModel(prompt, {});
	const { container } = render(
		<PromptFlowXml
			prompt={model.prompt}
			model={model}
			onSelectNode={() => {}}
			onPromptChange={() => {}}
		/>,
	);
	return { container, lines: buildXmlLineModel(model.prompt).lines };
}

/** First text node inside `nodeId`'s text region whose data contains `needle`. */
function findTextNode(
	container: HTMLElement,
	nodeId: string,
	needle: string,
): Text {
	for (const row of nodeRowElements(container, nodeId)) {
		const region = row.querySelector("[data-prompt-row-text]") ?? row;
		const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
		let current: Node | null;
		while ((current = walker.nextNode())) {
			if ((current as Text).data.includes(needle)) return current as Text;
		}
	}
	throw new Error(`No text node containing "${needle}" under node ${nodeId}`);
}

describe("row stamping", () => {
	it("item rows carry the item's own id plus the list as parent", () => {
		const { container } = renderSurface();

		const itemRows = nodeRowElements(container, "item-1");
		expect(itemRows.length).toBe(1);
		expect(itemRows[0].getAttribute("data-prompt-row-role")).toBe("item");
		expect(itemRows[0].getAttribute("data-prompt-parent-node-id")).toBe(
			"list-1",
		);
		// The list itself no longer owns any row directly.
		expect(nodeRowElements(container, "list-1").length).toBe(0);
	});

	it("non-item rows carry their parent block's id (none at top level)", () => {
		const { container } = renderSurface();

		const paragraphRows = nodeRowElements(container, "para-1");
		expect(paragraphRows.length).toBe(1);
		expect(paragraphRows[0].getAttribute("data-prompt-parent-node-id")).toBe(
			"sec-1",
		);

		for (const row of nodeRowElements(container, "sec-1")) {
			expect(row.hasAttribute("data-prompt-parent-node-id")).toBe(false);
		}
	});
});

describe("annotationRowElements", () => {
	it("expands a parent id to its own rows plus its children's rows", () => {
		const { container } = renderSurface();

		// The whole list = every item row (parent-stamp matches).
		expect(
			annotationRowElements(container, "list-1").map((row) =>
				row.getAttribute("data-prompt-node-id"),
			),
		).toEqual(["item-1", "item-2"]);

		// A section = its own open/close rows plus DIRECT children rows (item
		// rows parent to their list, not the section — but the open→close
		// union rect already spans the section's full extent for rings).
		expect(
			annotationRowElements(container, "sec-1").map((row) =>
				row.getAttribute("data-prompt-node-id"),
			),
		).toEqual(["sec-1", "para-1", "sec-1"]);
	});

	it("resolves a leaf id to exactly its own rows", () => {
		const { container } = renderSurface();
		expect(
			annotationRowElements(container, "item-2").map((row) =>
				row.getAttribute("data-prompt-node-id"),
			),
		).toEqual(["item-2"]);
	});
});

describe("rowDisplayRegions", () => {
	it("maps each row to its text region, in order", () => {
		const { container } = renderSurface();

		const rows = annotationRowElements(container, "list-1");
		const regions = rowDisplayRegions(rows);
		expect(regions.length).toBe(rows.length);
		regions.forEach((region, index) => {
			// The display element is the row's own `[data-prompt-row-text]`
			// descendant — rings/anchors measuring these hug the content.
			expect(region.hasAttribute("data-prompt-row-text")).toBe(true);
			expect(rows[index]!.contains(region)).toBe(true);
			expect(region).not.toBe(rows[index]!);
		});
	});

	it("falls back to the row itself when it has no text region", () => {
		const bare = document.createElement("div");
		expect(rowDisplayRegions([bare])).toEqual([bare]);
	});
});

describe("scope chains", () => {
	it("maps every annotatable id to its parent, excluding the document", () => {
		const parents = buildAnnotationParentMap(prompt);
		expect(parents.get("item-1")).toBe("list-1");
		expect(parents.get("item-2")).toBe("list-1");
		expect(parents.get("list-1")).toBe("sec-1");
		expect(parents.get("para-1")).toBe("sec-1");
		// Top-level blocks have no entry — the document is not a scope.
		expect(parents.has("sec-1")).toBe(false);
	});

	it("walks a bullet leaf-first up to the top-level block", () => {
		const parents = buildAnnotationParentMap(prompt);
		expect(annotationScopeChain(parents, "item-1")).toEqual([
			"item-1",
			"list-1",
			"sec-1",
		]);
		expect(annotationScopeChain(parents, "para-1")).toEqual([
			"para-1",
			"sec-1",
		]);
	});

	it("yields single-entry chains for top-level and unknown ids", () => {
		const parents = buildAnnotationParentMap(prompt);
		expect(annotationScopeChain(parents, "sec-1")).toEqual(["sec-1"]);
		expect(annotationScopeChain(parents, "ghost")).toEqual(["ghost"]);
	});
});

describe("mapDomRangeToPromptRange", () => {
	it("maps a drag on a bullet to the ITEM id past the display-trimmed marker", () => {
		const { container, lines } = renderSurface();
		// The item's DOM drops the indent and the space after the marker; the
		// model text keeps both, so offsets must land on the model's "First".
		// The anchor row stamps the item's own id — bullet-level granularity.
		const itemText = nodeRenderedText(lines, "item-1");
		const expectedStart = itemText.indexOf("First");

		const textNode = findTextNode(container, "item-1", "First item");
		const base = textNode.data.indexOf("First");
		const range = document.createRange();
		range.setStart(textNode, base);
		range.setEnd(textNode, base + "First".length);

		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "map-doc",
		});
		expect(target).toEqual({
			kind: "prompt-range",
			docId: "map-doc",
			nodeId: "item-1",
			start: expectedStart,
			end: expectedStart + "First".length,
			quote: "First",
		});
		expect(itemText.slice(target!.start, target!.end)).toBe("First");
	});

	it("clamps a multi-node drag to the anchor node's rendered text", () => {
		const { container, lines } = renderSurface();
		const paragraphText = nodeRenderedText(lines, "para-1");

		const start = findTextNode(container, "para-1", "world");
		const end = findTextNode(container, "item-1", "First item");
		const range = document.createRange();
		range.setStart(start, start.data.indexOf("world"));
		range.setEnd(end, 3);

		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "map-doc",
		});
		// Anchor = the start row's node; the overshoot clamps to its text end.
		expect(target).toEqual({
			kind: "prompt-range",
			docId: "map-doc",
			nodeId: "para-1",
			start: paragraphText.indexOf("world"),
			end: paragraphText.length,
			quote: "world",
		});
	});

	it("maps a multi-bullet drag to the LIST with offsets into the list's rendered text", () => {
		const { container, lines } = renderSurface();
		const parents = buildAnnotationParentMap(prompt);
		const listText = nodeRenderedText(lines, "list-1");

		const start = findTextNode(container, "item-1", "First item");
		const end = findTextNode(container, "item-2", "Second item");
		const range = document.createRange();
		range.setStart(start, start.data.indexOf("First"));
		range.setEnd(end, end.data.indexOf("Second") + "Second".length);

		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "map-doc",
			parents,
		});
		// Start and end rows are DIFFERENT items → nearest common ancestor is
		// their list, and offsets index the LIST's rendered text.
		expect(target).not.toBeNull();
		expect(target!.nodeId).toBe("list-1");
		const expectedStart = listText.indexOf("First");
		const expectedEnd = listText.indexOf("Second") + "Second".length;
		expect(target!.start).toBe(expectedStart);
		expect(target!.end).toBe(expectedEnd);
		// The quote is the model slice of the list text — it spans the newline
		// between the two bullets.
		expect(target!.quote).toBe(listText.slice(expectedStart, expectedEnd));
		expect(target!.quote).toContain("First item");
		expect(target!.quote).toContain("\n");
		expect(target!.quote.endsWith("Second")).toBe(true);
	});

	it("maps a cross-list drag to the SECTION with offsets into its full extent", () => {
		const { container, lines } = renderSurface();
		const parents = buildAnnotationParentMap(prompt);
		const sectionText = nodeRenderedText(lines, "sec-1");
		// The section's rendered text is its whole extent — tags AND children.
		expect(sectionText.startsWith("<context>")).toBe(true);
		expect(sectionText.endsWith("</context>")).toBe(true);
		expect(sectionText).toContain("Second item");
		expect(sectionText).toContain("Third item");

		const start = findTextNode(container, "item-2", "Second item");
		const end = findTextNode(container, "item-3", "Third item");
		const range = document.createRange();
		range.setStart(start, start.data.indexOf("Second"));
		range.setEnd(end, end.data.indexOf("Third") + "Third".length);

		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "map-doc",
			parents,
		});
		// Bullets in two different lists share no list — the section is the
		// nearest common ancestor.
		expect(target).not.toBeNull();
		expect(target!.nodeId).toBe("sec-1");
		const expectedStart = sectionText.indexOf("Second");
		const expectedEnd = sectionText.indexOf("Third") + "Third".length;
		expect(target!.start).toBe(expectedStart);
		expect(target!.end).toBe(expectedEnd);
		expect(target!.quote).toBe(sectionText.slice(expectedStart, expectedEnd));
	});

	it("keeps single-bullet drags on the ITEM id when parents are supplied", () => {
		const { container, lines } = renderSurface();
		const parents = buildAnnotationParentMap(prompt);
		const itemText = nodeRenderedText(lines, "item-1");

		const textNode = findTextNode(container, "item-1", "First item");
		const base = textNode.data.indexOf("First");
		const range = document.createRange();
		range.setStart(textNode, base);
		range.setEnd(textNode, base + "First".length);

		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "map-doc",
			parents,
		});
		// Same start/end row → no widening; identical to the parentless path.
		expect(target).toEqual({
			kind: "prompt-range",
			docId: "map-doc",
			nodeId: "item-1",
			start: itemText.indexOf("First"),
			end: itemText.indexOf("First") + "First".length,
			quote: "First",
		});
	});

	it("rings only the rows the drag bounded, not the common ancestor's full extent", () => {
		const { container, lines } = renderSurface();
		const parents = buildAnnotationParentMap(prompt);

		// Cross-list drag: item-2 (first list) → item-3 (second list). The
		// TARGET widens to the section, but the visual extent must stay the
		// dragged swath.
		const start = findTextNode(container, "item-2", "Second item");
		const end = findTextNode(container, "item-3", "Third item");
		const range = document.createRange();
		range.setStart(start, start.data.indexOf("Second"));
		range.setEnd(end, end.data.indexOf("Third") + "Third".length);
		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "map-doc",
			parents,
		});
		expect(target!.nodeId).toBe("sec-1");

		const spanned = promptRangeRowElements(container, lines, target!);
		const spannedIds = spanned.map((row) =>
			row.getAttribute("data-prompt-node-id"),
		);
		// The dragged rows are included…
		expect(spannedIds).toContain("item-2");
		expect(spannedIds).toContain("item-3");
		// …and the section's OTHER rows are not: no open/close tag rows (they
		// stamp the section id) and no rows before the drag start.
		expect(spannedIds).not.toContain("sec-1");
		expect(spannedIds).not.toContain("item-1");
		// Strictly fewer rows than the whole section extent.
		const sectionRows = annotationRowElements(container, "sec-1");
		expect(spanned.length).toBeLessThan(sectionRows.length);
	});

	it("anchors a cross-SECTION drag to the DOCUMENT and rings only the bounded rows", () => {
		const { container, lines } = renderSurface();
		const parents = buildAnnotationParentMap(prompt);
		const docText = lines
			.filter((line) => line.role !== "gap")
			.map((line) => line.text)
			.join("\n");

		// item-3 lives in sec-1, para-2 in sec-2 — no common ancestor block.
		const start = findTextNode(container, "item-3", "Third item");
		const end = findTextNode(container, "para-2", "Standalone tail");
		const range = document.createRange();
		range.setStart(start, start.data.indexOf("Third"));
		range.setEnd(end, end.data.indexOf("Standalone") + "Standalone".length);
		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "map-doc",
			parents,
		});

		// Document-anchored: nodeId is the doc id, offsets index the full
		// rendered text, quote is exactly the bounded swath.
		expect(target).not.toBeNull();
		expect(target!.nodeId).toBe("map-doc");
		const expectedStart = docText.indexOf("Third");
		expect(target!.start).toBe(expectedStart);
		expect(target!.quote.startsWith("Third item")).toBe(true);
		expect(target!.quote.endsWith("Standalone")).toBe(true);
		expect(docText.slice(target!.start, target!.end)).toBe(target!.quote);

		// Ring/anchor rows: from the dragged item through para-2's row — never
		// rows before the drag start (para-1, item-1…).
		const spanned = promptRangeRowElements(container, lines, target!);
		const spannedIds = spanned.map((row) =>
			row.getAttribute("data-prompt-node-id"),
		);
		expect(spannedIds).toContain("item-3");
		expect(spannedIds).toContain("para-2");
		expect(spannedIds).not.toContain("para-1");
		expect(spannedIds).not.toContain("item-1");
	});

	it("survives stray stamped elements in the container (auxiliary UI must not kill mapping)", () => {
		const { container, lines } = renderSurface();
		const itemText = nodeRenderedText(lines, "item-1");
		// Simulates outline entries / auxiliary UI that also stamp node ids —
		// the old global 1:1 DOM↔model check bailed on these, silently
		// swallowing every Cmd+drag in the real app.
		const stray = document.createElement("div");
		stray.setAttribute("data-prompt-node-id", "item-1");
		container.appendChild(stray);
		const foreign = document.createElement("div");
		foreign.setAttribute("data-prompt-node-id", "outline-entry");
		container.insertBefore(foreign, container.firstChild);
		try {
			const textNode = findTextNode(container, "item-1", "First item");
			const base = textNode.data.indexOf("First");
			const range = document.createRange();
			range.setStart(textNode, base);
			range.setEnd(textNode, base + "First".length);

			const target = mapDomRangeToPromptRange({
				container,
				range,
				lines,
				docId: "map-doc",
			});
			expect(target).toEqual({
				kind: "prompt-range",
				docId: "map-doc",
				nodeId: "item-1",
				start: itemText.indexOf("First"),
				end: itemText.indexOf("First") + "First".length,
				quote: "First",
			});
		} finally {
			stray.remove();
			foreign.remove();
		}
	});

	it("ignores drags that start outside any stamped row", () => {
		const { container, lines } = renderSurface();
		const outside = document.createElement("p");
		outside.textContent = "Outside text";
		document.body.appendChild(outside);
		try {
			const range = document.createRange();
			range.setStart(outside.firstChild as Text, 0);
			range.setEnd(outside.firstChild as Text, 5);
			expect(
				mapDomRangeToPromptRange({
					container,
					range,
					lines,
					docId: "map-doc",
				}),
			).toBeNull();
		} finally {
			outside.remove();
		}
	});
});

/**
 * Escape-aware offset mapping: prose rows DISPLAY entities decoded (`&lt;`
 * shows as `<`), so the DOM→model walk must consume whole entities — while
 * offsets and quotes stay slices of the MODEL text (entities escaped),
 * consistent with `nodeRenderedText`. Verbatim rows (code) keep the literal
 * characters and must keep walking them literally.
 */
describe("mapDomRangeToPromptRange over entity + backtick rows", () => {
	const escapedPrompt: PromptDocument = {
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "escaped-doc",
		nodes: [
			{
				type: "section",
				tag: "notes",
				id: "esc-sec",
				children: [
					{
						type: "paragraph",
						id: "esc-para",
						content: ["Tap <state> then `a<b` & done"],
					},
					{
						type: "bulletList",
						id: "esc-list",
						items: [
							{
								type: "listItem",
								id: "esc-item",
								content: ["Close </view> now"],
							},
						],
					},
					{
						type: "codeBlock",
						id: "esc-code",
						language: "ts",
						code: "x &lt; y",
					},
				],
			},
		],
	};

	function renderEscaped(): {
		container: HTMLElement;
		lines: readonly XmlLine[];
	} {
		const model = createPromptEditorModel(escapedPrompt, {});
		const { container } = render(
			<PromptFlowXml
				prompt={model.prompt}
				model={model}
				onSelectNode={() => {}}
				onPromptChange={() => {}}
			/>,
		);
		return { container, lines: buildXmlLineModel(model.prompt).lines };
	}

	it("selecting a decoded inline tag maps to the WHOLE entity-escaped model slice", () => {
		const { container, lines } = renderEscaped();
		const paraText = nodeRenderedText(lines, "esc-para");
		// The model keeps the serialized escapes.
		expect(paraText).toContain("&lt;state&gt;");

		// The DOM renders the decoded token as "<" + "state" + ">" text nodes.
		const open = findTextNode(container, "esc-para", "<");
		const close = findTextNode(container, "esc-para", ">");
		const range = document.createRange();
		range.setStart(open, 0);
		range.setEnd(close, 1);

		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "escaped-doc",
		});
		const expectedStart = paraText.indexOf("&lt;state&gt;");
		expect(target).toEqual({
			kind: "prompt-range",
			docId: "escaped-doc",
			nodeId: "esc-para",
			start: expectedStart,
			end: expectedStart + "&lt;state&gt;".length,
			quote: "&lt;state&gt;",
		});
	});

	it("maps a mixed swath (entities + backtick code span) with the quote as the model slice", () => {
		const { container, lines } = renderEscaped();
		const paraText = nodeRenderedText(lines, "esc-para");

		const start = findTextNode(container, "esc-para", "then");
		const end = findTextNode(container, "esc-para", "done");
		const range = document.createRange();
		range.setStart(start, start.data.indexOf("then"));
		range.setEnd(end, end.data.indexOf("done") + "done".length);

		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "escaped-doc",
		});
		expect(target).not.toBeNull();
		expect(target!.nodeId).toBe("esc-para");
		const expectedStart = paraText.indexOf("then");
		expect(target!.start).toBe(expectedStart);
		expect(target!.end).toBe(paraText.length);
		// The stored quote is the MODEL text: ticks kept, entities escaped.
		expect(target!.quote).toBe("then `a&lt;b` &amp; done");
		expect(paraText.slice(target!.start, target!.end)).toBe(target!.quote);
	});

	it("a boundary just past a decoded < inside a code span lands after the whole entity", () => {
		const { container, lines } = renderEscaped();
		const paraText = nodeRenderedText(lines, "esc-para");

		// Select "b` & done": the start snaps forward past `a&lt;` — including
		// the FULL entity, never into its middle.
		const start = findTextNode(container, "esc-para", "a<b");
		const end = findTextNode(container, "esc-para", "done");
		const range = document.createRange();
		range.setStart(start, start.data.indexOf("b", start.data.indexOf("<")));
		range.setEnd(end, end.data.indexOf("done") + "done".length);

		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "escaped-doc",
		});
		expect(target).not.toBeNull();
		expect(target!.quote).toBe("b` &amp; done");
		expect(target!.start).toBe(paraText.indexOf("b` &amp;"));
	});

	it("maps a decoded closing tag in an ITEM row past the marker trim", () => {
		const { container, lines } = renderEscaped();
		const itemText = nodeRenderedText(lines, "esc-item");
		expect(itemText).toContain("&lt;/view&gt;");

		const open = findTextNode(container, "esc-item", "<");
		const close = findTextNode(container, "esc-item", ">");
		const range = document.createRange();
		range.setStart(open, 0);
		range.setEnd(close, 1);

		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "escaped-doc",
		});
		const expectedStart = itemText.indexOf("&lt;/view&gt;");
		expect(target).toEqual({
			kind: "prompt-range",
			docId: "escaped-doc",
			nodeId: "esc-item",
			start: expectedStart,
			end: expectedStart + "&lt;/view&gt;".length,
			quote: "&lt;/view&gt;",
		});
	});

	it("a VERBATIM code row still walks literally: a displayed &lt; is four characters", () => {
		const { container, lines } = renderEscaped();
		const codeText = nodeRenderedText(lines, "esc-code");
		expect(codeText).toContain("x &lt; y");

		const textNode = findTextNode(container, "esc-code", "&lt;");
		const base = textNode.data.indexOf("&lt;");
		const range = document.createRange();
		range.setStart(textNode, base);
		range.setEnd(textNode, base + "&lt;".length);

		const target = mapDomRangeToPromptRange({
			container,
			range,
			lines,
			docId: "escaped-doc",
		});
		expect(target).not.toBeNull();
		expect(target!.nodeId).toBe("esc-code");
		expect(target!.quote).toBe("&lt;");
		expect(codeText.slice(target!.start, target!.end)).toBe("&lt;");
	});
});

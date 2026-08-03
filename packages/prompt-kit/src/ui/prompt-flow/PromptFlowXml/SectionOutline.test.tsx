import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { PromptBlockNode } from "../../../index";
import { EDITOR_COLORS } from "../../surface/editor-surface";
import type { XmlLine } from "../xml-line-model";
import {
	SectionOutline,
	outlineSectionLabel,
	type OutlineSection,
} from "./SectionOutline";

const sections: OutlineSection[] = [
	{ row: 0, nodeId: "a", label: "purpose", depth: 0 },
	{ row: 12, nodeId: "b", label: "workflow", depth: 0 },
	{ row: 14, nodeId: "b1", label: "orientate", depth: 1 },
];

function render(activeRow: number | null): string {
	return renderToStaticMarkup(
		<SectionOutline
			sections={sections}
			activeRow={activeRow}
			onSelect={() => {}}
		/>,
	);
}

describe("SectionOutline", () => {
	test("renders section names only — no counts, no size bars", () => {
		const markup = render(null);
		expect(markup).toContain("purpose");
		expect(markup).toContain("workflow");
		expect(markup).toContain("orientate");
		// The column is a map, not a chart: an entry's visible content is
		// exactly its name — no line-count digits, no sparkline chrome.
		const host = document.createElement("div");
		host.innerHTML = markup;
		expect(host.textContent).toBe("purposeworkfloworientate");
		expect(host.textContent).not.toMatch(/\d/);
	});

	test("depth-1 entries indent as children", () => {
		const markup = render(null);
		const child = markup.slice(markup.indexOf("orientate") - 400);
		expect(child).toContain("pl-6");
	});

	test("only the active entry speaks the selection accent", () => {
		expect(render(null)).not.toContain(EDITOR_COLORS.selectionAccent);
		const markup = render(12);
		expect(markup).toContain(EDITOR_COLORS.selectionAccent);
		expect(markup).toContain('aria-current="location"');
	});
});

describe("outlineSectionLabel", () => {
	function openLine(node: PromptBlockNode, text: string): XmlLine {
		return {
			text,
			node,
			nodeId: node.id ?? "",
			depth: 1,
			role: "open",
			editable: false,
		};
	}

	function section(
		tag: string,
		attrs?: Record<string, string | number | boolean | null | undefined>,
	): PromptBlockNode {
		return { id: "s1", type: "section", tag, attrs, children: [] };
	}

	test("named sections label by their name attribute, not the shared tag", () => {
		const line = openLine(
			section("phase", { name: "orientate" }),
			'    <phase name="orientate">',
		);
		expect(outlineSectionLabel(line)).toBe("orientate");
	});

	test("unnamed sections fall back to the bare tag", () => {
		expect(
			outlineSectionLabel(openLine(section("purpose"), "<purpose>")),
		).toBe("purpose");
		// Blank or non-string names are no label either.
		expect(
			outlineSectionLabel(
				openLine(section("phase", { name: "  " }), '<phase name="  ">'),
			),
		).toBe("phase");
		expect(
			outlineSectionLabel(
				openLine(section("phase", { name: null }), "<phase>"),
			),
		).toBe("phase");
	});

	test("non-section containers read the leading word of their tag text", () => {
		const example: PromptBlockNode = {
			id: "e1",
			type: "example",
			children: [],
		};
		expect(
			outlineSectionLabel(
				openLine(example, '    <example title="good">'),
			),
		).toBe("example");
	});
});

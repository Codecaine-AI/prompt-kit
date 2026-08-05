import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { PromptDocument } from "../../../index";
import {
	createPromptEditorModel,
} from "../model";
import { PromptFlowXml } from ".";

afterEach(() => {
	cleanup();
});

/**
 * Read-mode inline rendering of prose rows: the serialized model text escapes
 * entities (`&lt;state&gt;`), but the DISPLAY decodes them — matching what
 * edit mode shows — and gives inline `<tag>` tokens the tag treatment and
 * backtick spans the code-chip treatment (ticks stay visible). Verbatim rows
 * (code blocks) keep the model text byte-for-byte.
 */
const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "read-mode-doc",
	nodes: [
		{
			type: "section",
			tag: "context",
			id: "sec-1",
			children: [
				{
					type: "paragraph",
					id: "para-1",
					content: ["Update <state> via `npm test` & retry"],
				},
				{
					type: "bulletList",
					id: "list-1",
					items: [
						{
							type: "listItem",
							id: "item-1",
							content: ["Close </view> after `a < b`"],
						},
					],
				},
				{
					type: "codeBlock",
					id: "code-1",
					language: "ts",
					code: "if (a &lt; b) { render(); }",
				},
			],
		},
	],
};

function renderFlow() {
	const model = createPromptEditorModel(prompt, {});
	return render(
		<PromptFlowXml
			prompt={model.prompt}
			model={model}
			onSelectNode={() => {}}
			onPromptChange={() => {}}
		/>,
	);
}

function rowTextRegion(nodeId: string): HTMLElement {
	const row = document.querySelector<HTMLElement>(
		`[data-prompt-node-id="${nodeId}"]`,
	)!;
	return row.querySelector<HTMLElement>("[data-prompt-row-text]")!;
}

function spansOf(region: HTMLElement): HTMLElement[] {
	return Array.from(region.querySelectorAll<HTMLElement>("span"));
}

describe("read-mode prose rows decode entities", () => {
	it("a paragraph shows <state>, not &lt;state&gt;", () => {
		renderFlow();
		const region = rowTextRegion("para-1");
		expect(region.textContent).toContain("<state>");
		expect(region.textContent).not.toContain("&lt;");
		// The decoded ampersand too — & displays as itself.
		expect(region.textContent).toContain("& retry");
		expect(region.textContent).not.toContain("&amp;");
	});

	it("an item row shows a decoded closing tag inline", () => {
		renderFlow();
		const region = rowTextRegion("item-1");
		expect(region.textContent).toContain("</view>");
		expect(region.textContent).not.toContain("&lt;");
	});

	it("a code-block row is verbatim: a literal &lt; stays four characters", () => {
		renderFlow();
		// The content row of the code block (between the fences).
		const rows = Array.from(
			document.querySelectorAll<HTMLElement>(
				'[data-prompt-node-id="code-1"] [data-prompt-row-text]',
			),
		);
		const contentRow = rows.find((row) =>
			row.textContent?.includes("render"),
		)!;
		expect(contentRow.textContent).toContain("a &lt; b");
	});
});

// happy-dom drops style declarations whose values are bare var()/color-mix()
// tokens (background, color), so these tests assert the treatments through the
// declarations it KEEPS — the tag name's weight, the chip's radius + padding,
// the ticks' opacity — plus the span structure itself.
describe("read-mode inline tag + code-chip treatments", () => {
	it("an inline <tag> token takes the tag treatment (one token span, bold name)", () => {
		renderFlow();
		const spans = spansOf(rowTextRegion("para-1"));
		// The whole token renders as ONE span ("<" + name + ">")…
		const token = spans.find((span) => span.textContent === "<state>");
		expect(token).toBeTruthy();
		// …with the tag-name span inside carrying the highlight's 500 weight.
		const tagName = spans.find((span) => span.textContent === "state")!;
		expect(tagName).toBeTruthy();
		expect(token!.contains(tagName)).toBe(true);
		expect(tagName.style.fontWeight).toBe("500");
	});

	it("an inline closing tag in an ITEM row takes the same treatment", () => {
		renderFlow();
		const spans = spansOf(rowTextRegion("item-1"));
		const token = spans.find((span) => span.textContent === "</view>");
		expect(token).toBeTruthy();
		const tagName = spans.find((span) => span.textContent === "view")!;
		expect(tagName).toBeTruthy();
		expect(tagName.style.fontWeight).toBe("500");
	});

	it("backtick spans chip with the ticks still visible (muted, not hidden)", () => {
		renderFlow();
		const chip = spansOf(rowTextRegion("para-1")).find((span) =>
			span.textContent === "`npm test`",
		)!;
		expect(chip).toBeTruthy();
		// The chip's paint-only treatment: rounded, padded (margin cancels it).
		expect(chip.style.borderRadius).toBe("4px");
		expect(chip.style.padding).toBe("1px 2px");
		// Both ticks remain in the DOM, dimmed rather than removed.
		const ticks = Array.from(chip.querySelectorAll("span")).filter(
			(span) => span.textContent === "`",
		);
		expect(ticks).toHaveLength(2);
		for (const tick of ticks) expect(tick.style.opacity).not.toBe("");
	});

	it("an item's decoded backtick span chips too — even with a < inside", () => {
		renderFlow();
		const chip = spansOf(rowTextRegion("item-1")).find(
			(span) => span.textContent === "`a < b`",
		)!;
		expect(chip).toBeTruthy();
		expect(chip.style.borderRadius).toBe("4px");
	});
});

describe("edit mode stays raw", () => {
	it("clicking a prose row opens a plain textarea with the editable source text", () => {
		renderFlow();
		const display = rowTextRegion("para-1").querySelector<HTMLElement>(
			"div.whitespace-pre-wrap",
		)!;
		fireEvent.click(display);

		const editor = document.querySelector<HTMLTextAreaElement>("textarea")!;
		expect(editor).toBeTruthy();
		// The editable value is the model's inline text — the same decoded
		// characters the read view now shows, unstyled.
		expect(editor.value).toBe("Update <state> via `npm test` & retry");
	});
});

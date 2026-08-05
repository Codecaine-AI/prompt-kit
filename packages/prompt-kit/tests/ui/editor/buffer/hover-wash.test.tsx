import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { PromptDocument } from "../../../../src/index";
import {
	createPromptEditorModel,
} from "../../../../src/ui/editor/model";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";

afterEach(() => {
	cleanup();
});

/**
 * Unit-scoped hover wash (2026-08-05): hovering a unit washes only the rows
 * that unit owns, never the whole start..end interval of a container's range —
 * a section tag hover must not flood the body rows its children own, and a
 * bullet hover must not wash its sibling bullets (item rows all carry the
 * LIST's nodeId, so the wash resolves the ITEM, whose extent is its marker row
 * plus its nested child rows).
 */
const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "hover-wash-doc",
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
						{
							type: "listItem",
							id: "item-1",
							content: ["First"],
							children: [
								{
									type: "paragraph",
									id: "para-nested",
									content: ["First detail"],
								},
							],
						},
						{ type: "listItem", id: "item-2", content: ["Second"] },
					],
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

/**
 * Rows currently carrying the hover/selection wash div. The wash is the one
 * full-row overlay with `transition-colors` (the landmark tint shares
 * `absolute inset-0` but not that class), so membership is read structurally
 * rather than from inline background styles happy-dom may drop.
 */
function washedRows(): { nodeId: string | null; role: string | null }[] {
	return Array.from(
		document.querySelectorAll<HTMLElement>("[data-row-index]"),
	)
		.filter((row) =>
			row.querySelector(
				".pointer-events-none.absolute.inset-0.transition-colors",
			),
		)
		.map((row) => ({
			nodeId: row.getAttribute("data-prompt-node-id"),
			role: row.getAttribute("data-prompt-row-role"),
		}));
}

function itemRow(itemId: string): HTMLElement {
	return document.querySelector<HTMLElement>(
		`[data-prompt-node-id="${itemId}"][data-prompt-row-role="item"]`,
	)!;
}

describe("PromptFlowXml unit-scoped hover wash", () => {
	it("hovering a section's tag washes its open/close rows only — never the body", () => {
		renderFlow();

		fireEvent.mouseEnter(
			document.querySelector<HTMLElement>(
				'[data-prompt-node-id="sec-1"][data-prompt-row-role="open"]',
			)!,
		);

		expect(washedRows()).toEqual([
			{ nodeId: "sec-1", role: "open" },
			{ nodeId: "sec-1", role: "close" },
		]);
	});

	it("hovering a paragraph washes exactly its own row", () => {
		renderFlow();

		fireEvent.mouseEnter(
			document.querySelector<HTMLElement>('[data-prompt-node-id="para-1"]')!,
		);

		expect(washedRows()).toEqual([{ nodeId: "para-1", role: "content" }]);
	});

	it("hovering a bullet washes that ITEM's rows only — its multi-row extent, no sibling", () => {
		renderFlow();

		// The multi-row item: marker row PLUS its nested child row wash as one
		// unit — and the sibling bullet's marker row stays unwashed.
		fireEvent.mouseEnter(itemRow("item-1"));
		expect(washedRows()).toEqual([
			{ nodeId: "item-1", role: "item" },
			{ nodeId: "para-nested", role: "content" },
		]);

		// The single-row sibling washes exactly its own marker row.
		fireEvent.mouseEnter(itemRow("item-2"));
		expect(washedRows()).toEqual([{ nodeId: "item-2", role: "item" }]);
	});

	it("scrolling clears the hover so no stale wash rides under a stationary pointer", () => {
		renderFlow();

		// An ITEM hover, so the scroll clear is exercised for the item scope
		// (hoverItemId) as well as the node scope.
		fireEvent.mouseEnter(itemRow("item-1"));
		expect(washedRows()).toHaveLength(2);

		fireEvent.scroll(
			document.querySelector<HTMLElement>('[data-prompt-flow-scroll="xml"]')!,
		);
		expect(washedRows()).toEqual([]);
	});
});

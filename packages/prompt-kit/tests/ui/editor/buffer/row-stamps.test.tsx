import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PromptDocument } from "../../../../src/index";
import {
	createPromptEditorModel,
} from "../../../../src/ui/editor/model";
import { buildXmlLineModel } from "../../../../src/document/render/line-model";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";
import { EDITOR_METRICS } from "../../../../src/ui/surface/editor-surface";

afterEach(() => {
	cleanup();
});

const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "stamp-doc",
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
					items: [{ type: "listItem", id: "item-1", content: ["First"] }],
				},
			],
		},
		{ type: "codeBlock", id: "code-1", language: "ts", code: "const a = 1;" },
	],
};

describe("PromptFlowXml row stamps", () => {
	it("stamps every row with its role and non-gap rows with their node id", () => {
		const model = createPromptEditorModel(prompt, {});
		render(
			<PromptFlowXml
				prompt={model.prompt}
				model={model}
				onSelectNode={() => {}}
				onPromptChange={() => {}}
			/>,
		);

		const lines = buildXmlLineModel(model.prompt).lines;
		const rows = Array.from(
			document.querySelectorAll<HTMLElement>("[data-row-index]"),
		);
		expect(rows.length).toBe(lines.length);
		// The fixture exercises every role, including gap separators.
		expect(new Set(lines.map((line) => line.role))).toEqual(
			new Set(["gap", "open", "close", "content", "fence", "item"]),
		);

		rows.forEach((row, index) => {
			const line = lines[index]!;
			expect(row.getAttribute("data-prompt-row-role")).toBe(line.role);
			if (line.role === "gap") {
				// Gap rows belong to no node visually — no node id or parent stamp.
				expect(row.getAttribute("data-prompt-node-id")).toBeNull();
				expect(row.getAttribute("data-prompt-parent-node-id")).toBeNull();
			} else {
				// Item rows stamp the ITEM's own id (bullets are annotation
				// targets in their own right); every other row keeps its node id.
				expect(row.getAttribute("data-prompt-node-id")).toBe(
					line.itemId ?? line.nodeId,
				);
				// The parent stamp names the enclosing block (the list for an
				// item, the section for a nested block; none at the top level).
				expect(row.getAttribute("data-prompt-parent-node-id")).toBe(
					line.parentNodeId ?? null,
				);
				// Every non-gap row exposes its text region for range mapping.
				expect(row.querySelector("[data-prompt-row-text]")).toBeTruthy();
			}
		});
	});

	it("renders an empty affordance gutter — line numbers are retired", () => {
		const model = createPromptEditorModel(prompt, {});
		render(
			<PromptFlowXml
				prompt={model.prompt}
				model={model}
				onSelectNode={() => {}}
				onPromptChange={() => {}}
			/>,
		);
		const gutter = document.querySelector<HTMLElement>(
			'[data-prompt-node-id="para-1"] > div',
		)!;
		// The gutter cell keeps geometry for the grip rail and nothing else.
		expect(gutter.querySelector("span")).toBeNull();
		expect(gutter.textContent).toBe("");
	});

	it("stamps every editor affordance for annotate-mode hiding", () => {
		const model = createPromptEditorModel(prompt, {});
		render(
			<PromptFlowXml
				prompt={model.prompt}
				model={model}
				onSelectNode={() => {}}
				onPromptChange={() => {}}
			/>,
		);

		// Under the one-handle model (see resolveDragHandleUnit) the block
		// grip/menu cluster mounts on the hovered block's anchor row — and it
		// carries the stamp the lab's annotate stylesheet display:none-s.
		const paragraphRow = document.querySelector<HTMLElement>(
			'[data-prompt-node-id="para-1"]',
		)!;
		fireEvent.mouseEnter(paragraphRow);
		const cluster = document.querySelector<HTMLElement>(
			'[data-prompt-affordance="block-cluster"]',
		);
		expect(cluster).toBeTruthy();
		expect(cluster!.querySelector("button")).toBeTruthy();
	});

	it("renders NO per-item remove × in edit mode — item deletion is Backspace / the item menu", () => {
		const model = createPromptEditorModel(prompt, {});
		render(
			<PromptFlowXml
				prompt={model.prompt}
				model={model}
				onSelectNode={() => {}}
				onPromptChange={() => {}}
			/>,
		);

		// The × was removed outright (not annotate-hidden): hovering an item
		// row must mount nothing carrying the retired remove-item stamp. Item
		// deletion lives in the ITEM MENU (the item grip's motionless click —
		// see ItemMenu) and on Backspace; neither mounts per-item chrome at
		// rest.
		const itemRow = document.querySelector<HTMLElement>(
			'[data-prompt-node-id="item-1"]',
		)!;
		fireEvent.mouseOver(itemRow);
		expect(
			document.querySelector('[data-prompt-affordance="remove-item"]'),
		).toBeNull();
		expect(document.querySelector('[aria-label="Remove list item"]')).toBeNull();
	});

	it("gives the drag grip a padded hit area around a large glyph", () => {
		const model = createPromptEditorModel(prompt, {});
		render(
			<PromptFlowXml
				prompt={model.prompt}
				model={model}
				onSelectNode={() => {}}
				onPromptChange={() => {}}
			/>,
		);

		// One-handle model: the grip mounts on hover of a block row.
		fireEvent.mouseEnter(
			document.querySelector<HTMLElement>('[data-prompt-node-id="para-1"]')!,
		);
		const grip = document.querySelector<HTMLElement>(".prompt-editor-grip")!;
		expect(grip).toBeTruthy();
		// Hit area: 28px wide (w-7) by a full line-height tall — meaningfully
		// larger than the glyph it frames, docs-viewer drag-handle style.
		// (happy-dom drops var() height styles from the live DOM, so the
		// metrics the styles feed are asserted directly.)
		expect(grip.className).toContain("w-7");
		expect(EDITOR_METRICS.lineHeight).toContain(
			"var(--prompt-editor-line-height, 22px)",
		);
		// Grab affordance: cursor grab at rest, grabbing while held.
		expect(grip.className).toContain("cursor-grab");
		expect(grip.className).toContain("active:cursor-grabbing");
		// The glyph itself resolves the grip-size variable with a 20px default.
		expect(grip.querySelector("svg")).toBeTruthy();
		expect(EDITOR_METRICS.gripSize).toContain(
			"var(--prompt-editor-grip-size, 20px)",
		);
	});
});

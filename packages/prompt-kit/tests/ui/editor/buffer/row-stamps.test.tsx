import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import type { PromptDocument } from "../../../../src/index";
import {
	createPromptEditorModel,
} from "../../../../src/ui/editor/model";
import { buildXmlLineModel } from "../../../../src/document/render/line-model";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";

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
});

import { afterEach, describe, expect, it } from "bun:test";
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PromptDocument, SectionNode } from "../../../../src/index";
import { createPromptEditorModel } from "../../../../src/ui/editor/model";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";

afterEach(cleanup);

function renderEditor(nodes: PromptDocument["nodes"]) {
	let current: PromptDocument = { kind: "prompt", schemaVersion: "prompt-kit/v1", id: "section-ux", nodes };
	function Editor() {
		const [prompt, setPrompt] = useState(current);
		const [selectedNodeId, setSelectedNodeId] = useState<string>();
		const model = createPromptEditorModel(prompt);
		return <PromptFlowXml prompt={model.prompt} model={model} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} onPromptChange={(next, focusId) => { current = next; setPrompt(next); setSelectedNodeId(focusId); }} />;
	}
	return { ...render(<Editor />), prompt: () => current };
}
function editor() {
	const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
	expect(textarea).not.toBeNull();
	return textarea!;
}
function startEditing(id: string) {
	fireEvent.click(document.querySelector(`[data-prompt-node-id="${id}"] [data-prompt-row-content]`)!);
}
function type(value: string) {
	fireEvent.change(editor(), { target: { value } });
	editor().setSelectionRange(value.length, value.length);
}
const emptySection = (): SectionNode => ({ type: "section", id: "section", tag: "instructions", children: [] });

describe("section authoring paths", () => {
	for (const followingSibling of [false, true]) {
		it(`Enter after naming an empty section creates its body${followingSibling ? " without entering the following sibling" : " at document end"}`, () => {
			const view = renderEditor([emptySection(), ...(followingSibling ? [{ type: "paragraph" as const, id: "after", content: ["Keep sibling"] }] : [])]);
			startEditing("section");
			type("rules");
			fireEvent.keyDown(editor(), { key: "Enter" });
			const section = view.prompt().nodes[0] as SectionNode;
			expect(section.tag).toBe("rules");
			expect(section.children).toHaveLength(1);
			expect(section.children[0]!.type).toBe("paragraph");
			expect(editor().value).toBe("");
			type("Inside");
			expect((view.prompt().nodes[0] as SectionNode).children[0]).toMatchObject({ content: ["Inside"] });
			if (followingSibling) expect(view.prompt().nodes[1]).toMatchObject({ content: ["Keep sibling"] });
		});
	}
	it("Add child opens an empty body editor ready for slash section", () => {
		const view = renderEditor([emptySection()]);
		fireEvent.mouseEnter(document.querySelector('[data-prompt-node-id="section"]')!);
		fireEvent.click(view.getByRole("button", { name: "Block handle and menu" }));
		fireEvent.click(view.getByRole("button", { name: "Add child" }));
		expect((view.prompt().nodes[0] as SectionNode).children).toHaveLength(1);
		expect(document.activeElement).toBe(editor());
		expect(editor().value).toBe("");
		type("/section");
		fireEvent.keyDown(editor(), { key: "Enter" });
		type("details");
		fireEvent.keyDown(editor(), { key: "Enter" });
		type("Nested body");
		expect((view.prompt().nodes[0] as SectionNode).children[0]).toMatchObject({ type: "section", tag: "details", children: [{ type: "paragraph", content: ["Nested body"] }] });
	});
});

it("Add subsection immediately selects its name and Enter moves into its empty body", () => {
	const view = renderEditor([emptySection()]);
	fireEvent.mouseEnter(document.querySelector('[data-prompt-node-id="section"]')!);
	fireEvent.click(view.getByRole("button", {name: "Block handle and menu"}));
	fireEvent.click(view.getByRole("button", {name: "Add subsection"}));
	expect(editor().value).toBe("section");
	expect([editor().selectionStart, editor().selectionEnd]).toEqual([0, 7]);
	type("details");
	fireEvent.keyDown(editor(), {key: "Enter"});
	expect(editor().value).toBe("");
	type("Inside subsection");
	expect((view.prompt().nodes[0] as SectionNode).children[0]).toMatchObject({type: "section", tag: "details", children: [{type: "paragraph", content: ["Inside subsection"]}]});
});

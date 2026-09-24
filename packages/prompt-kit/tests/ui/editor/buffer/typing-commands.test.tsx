import { afterEach, describe, expect, it } from "bun:test";
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { BulletListNode, PromptDocument } from "../../../../src/index";
import { createPromptEditorModel } from "../../../../src/ui/editor/model";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";

afterEach(cleanup);

function renderEditor(text = "", selected = false) {
	let current: PromptDocument = {
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "typing-commands",
		nodes: [{ type: "paragraph", id: "paragraph", content: [text] }],
	};
	function Editor() {
		const [prompt, setPrompt] = useState(current);
		const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(selected ? "paragraph" : undefined);
		const model = createPromptEditorModel(prompt);
		return <PromptFlowXml
			prompt={model.prompt}
			model={model}
			selectedNodeId={selectedNodeId}
			onSelectNode={setSelectedNodeId}
			onPromptChange={(next) => { current = next; setPrompt(next); }}
		/>;
	}
	const view = render(<Editor />);
	return { ...view, prompt: () => current };
}

function editor(): HTMLTextAreaElement {
	const element = document.querySelector<HTMLTextAreaElement>("textarea");
	expect(element).not.toBeNull();
	return element!;
}

function startEditing() {
	fireEvent.click(document.querySelector('[data-prompt-node-id="paragraph"] [data-prompt-row-content]')!);
	editor().setSelectionRange(editor().value.length, editor().value.length);
}

function type(value: string) {
	fireEvent.change(editor(), { target: { value } });
	editor().setSelectionRange(value.length, value.length);
}

describe("PromptFlowXml typing commands", () => {
	it("opens slash on a blank row created by Enter and keeps editing the chosen list", () => {
		const view = renderEditor("Introduction");
		startEditing();
		fireEvent.keyDown(editor(), { key: "Enter" });
		expect(view.prompt().nodes).toHaveLength(2);
		expect(editor().value).toBe("");
		type("/");
		expect(view.getByRole("listbox")).toBeTruthy();
		type("/bul");
		fireEvent.keyDown(editor(), { key: "Enter" });
		expect(view.queryByRole("listbox")).toBeNull();
		expect(view.prompt().nodes[1]!.type).toBe("bulletList");
		type("First");
		fireEvent.keyDown(editor(), { key: "Enter" });
		type("Second");
		const list = view.prompt().nodes[1] as BulletListNode;
		expect(list.items.map((item) => item.content)).toEqual([["First"], ["Second"]]);
		fireEvent.keyDown(editor(), { key: "Tab" });
		const nested = view.prompt().nodes[1] as BulletListNode;
		expect(nested.items).toHaveLength(1);
		expect((nested.items[0]!.children![0] as BulletListNode).items[0]!.content).toEqual(["Second"]);
		expect(editor().value).toBe("Second");
	});

	it("autoformats a typed dash-space after Enter and keeps the new item focused", () => {
		const view = renderEditor("Introduction");
		startEditing();
		fireEvent.keyDown(editor(), { key: "Enter" });
		type("-");
		type("- ");
		expect(view.prompt().nodes[1]!.type).toBe("bulletList");
		expect(editor().value).toBe("");
		expect(document.activeElement).toBe(editor());
		type("First");
		fireEvent.keyDown(editor(), { key: "Enter" });
		type("Second");
		expect((view.prompt().nodes[1] as BulletListNode).items.map((item) => item.content)).toEqual([["First"], ["Second"]]);
	});

	it("opens slash when typing starts on a selected empty paragraph", () => {
		const view = renderEditor("", true);
		fireEvent.keyDown(window, { key: "/" });
		expect(editor().value).toBe("/");
		expect(view.getByRole("listbox")).toBeTruthy();
		type("/bul");
		fireEvent.keyDown(editor(), { key: "Tab" });
		expect(view.prompt().nodes[0]!.type).toBe("bulletList");
		expect(editor().value).toBe("");
	});

	for (const [marker, target] of [["-", "bulletList"], ["1.", "orderedList"]] as const) {
		it(`autoformats ${marker} when Space starts editing a selected paragraph`, () => {
			const view = renderEditor(marker, true);
			fireEvent.keyDown(window, { key: " " });
			expect(view.prompt().nodes[0]!.type).toBe(target);
			expect(editor().value).toBe("");
			expect(document.activeElement).toBe(editor());
		});
	}

	it("keeps the caret in a list chosen by clicking the slash menu", () => {
		const view = renderEditor();
		startEditing();
		type("/");
		const option = view.getByRole("option", { name: "Bullets Unordered list" });
		fireEvent.mouseDown(option);
		fireEvent.click(option);
		expect(view.queryByRole("listbox")).toBeNull();
		expect(view.prompt().nodes[0]!.type).toBe("bulletList");
		expect(document.activeElement).toBe(editor());
		type("First");
		fireEvent.keyDown(editor(), { key: "Enter" });
		type("Second");
		expect((view.prompt().nodes[0] as BulletListNode).items.map((item) => item.content)).toEqual([["First"], ["Second"]]);
	});
});

describe("paragraph and paste authoring", () => {
	it("turns a dash-space on a soft new line into a bullet, preserving surrounding prose", () => {
		const view = renderEditor("Introduction\n-\nConclusion");
		startEditing();
		fireEvent.change(editor(), {target: {value: "Introduction\n- \nConclusion", selectionStart: 15, selectionEnd: 15}});
		expect(view.prompt().nodes.map((node) => node.type)).toEqual(["paragraph", "bulletList", "paragraph"]);
		type("First bullet");
		fireEvent.keyDown(editor(), {key: "Enter"});
		type("Second bullet");
		expect((view.prompt().nodes[1] as BulletListNode).items.map((item) => item.content)).toEqual([["First bullet"], ["Second bullet"]]);
	});

	it("turns existing prose into a bullet by completing a marker before it", () => {
		const view = renderEditor("-Keep this text");
		startEditing();
		fireEvent.change(editor(), {target: {value: "- Keep this text", selectionStart: 2, selectionEnd: 2}});
		expect(view.prompt().nodes[0]!.type).toBe("bulletList");
		expect(editor().value).toBe("Keep this text");
		expect(editor().selectionStart).toBe(0);
	});

	it("converts a paragraph through its menu, with one item per source line", () => {
		const view = renderEditor("First\nSecond");
		const row = document.querySelector('[data-prompt-node-id="paragraph"]')!;
		fireEvent.mouseEnter(row);
		fireEvent.click(view.getByRole("button", {name: "Block handle and menu"}));
		fireEvent.click(view.getByRole("button", {name: "Turn into bullets"}));
		expect((view.prompt().nodes[0] as BulletListNode).items.map((item) => item.content)).toEqual([["First"], ["Second"]]);
		expect(document.activeElement).toBe(editor());
	});

	it("pastes Markdown lines into a real list instead of one multiline item", () => {
		const view = renderEditor();
		startEditing();
		paste("- First\n- Second\n");
		expect((view.prompt().nodes[0] as BulletListNode).items.map((item) => item.content)).toEqual([["First"], ["Second"]]);
		expect(editor().value).toBe("Second");
	});

	it("pastes ordinary lines into separate items when the caret is in a bullet", () => {
		const view = renderEditor();
		startEditing();
		type("- ");
		paste("First\nSecond");
		expect((view.prompt().nodes[0] as BulletListNode).items.map((item) => item.content)).toEqual([["First"], ["Second"]]);
		expect(editor().value).toBe("Second");
		fireEvent.keyDown(editor(), {key: "Enter"});
		expect((view.prompt().nodes[0] as BulletListNode).items).toHaveLength(3);
	});

	it("replaces selected text when pasting into a bullet and retains its suffix", () => {
		const view = renderEditor();
		startEditing();
		type("- ");
		type("prefix OLD suffix");
		editor().setSelectionRange(7, 10);
		paste("- Alpha\n- Beta");
		expect((view.prompt().nodes[0] as BulletListNode).items.map((item) => item.content)).toEqual([["prefix Alpha"], ["Beta suffix"]]);
		expect(editor().selectionStart).toBe(4);
	});

	it("pastes ordinary text as paragraphs that can immediately become bullets", () => {
		const view = renderEditor();
		startEditing();
		paste("First\nSecond");
		expect(view.prompt().nodes.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
		expect(editor().value).toBe("Second");
		fireEvent.keyDown(editor(), {key: "Enter"});
		type("- ");
		expect(view.prompt().nodes[2]!.type).toBe("bulletList");
	});
});

function paste(text: string) {
	fireEvent.paste(editor(), {clipboardData: {getData: (type: string) => type === "text/plain" ? text : ""}});
}

it("pastes new lines after existing prose even when the first paragraph is unchanged", () => {
	const view = renderEditor("Keep this");
	startEditing();
	paste("\n- First\n- Second");
	expect(view.prompt().nodes.map((node) => node.type)).toEqual(["paragraph", "bulletList"]);
	expect((view.prompt().nodes[1] as BulletListNode).items.map((item) => item.content)).toEqual([["First"], ["Second"]]);
	expect(editor().value).toBe("Second");
});

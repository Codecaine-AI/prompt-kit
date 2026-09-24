import { afterEach, describe, expect, it } from "bun:test";
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PromptBlockNode, PromptDocument, SectionNode } from "../../../../src/index";
import { createPromptEditorModel } from "../../../../src/ui/editor/model";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";

import { revertSteps, type PromptStep } from "../../../../src/ui/editor/transactions";

afterEach(cleanup);
const paragraph = (id: string): PromptBlockNode => ({ type: "paragraph", id, content: [id] });
const section = (id: string, children: PromptBlockNode[] = [paragraph(`${id}-body`)]): SectionNode => ({ type: "section", id, tag: id, children });

function setup(nodes: PromptBlockNode[]) {
	const changes: PromptStep[][] = [];
	let current: PromptDocument = { kind: "prompt", schemaVersion: "prompt-kit/v1", id: "insertion-ux", nodes };
	function Editor() {
		const [prompt, setPrompt] = useState(current);
		const [selectedNodeId, onSelectNode] = useState<string>();
		const model = createPromptEditorModel(prompt);
		return <PromptFlowXml prompt={prompt} model={model} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode}
			onPromptChange={(next, selected, steps) => { changes.push(steps ?? []); current = next; setPrompt(next); onSelectNode(selected); }} />;
	}
	return { ...render(<Editor />), prompt: () => current, changes };
}

function typeIntoFocusedParagraph(value: string) {
	const input = document.querySelector<HTMLTextAreaElement>("textarea");
	expect(input).not.toBeNull();
	expect(document.activeElement).toBe(input);
	fireEvent.change(input!, { target: { value } });
}

describe("insertion at visible document boundaries", () => {
	for (const kind of ["paragraph", "section"] as const) {
		it(`clicking between sibling ${kind}s starts a paragraph at that boundary`, () => {
			const nodes = kind === "paragraph" ? [paragraph("first"), paragraph("last")] : [section("first"), section("last")];
			const view = setup(nodes);
			fireEvent.click(view.container.querySelector('[data-prompt-row-role="gap"]')!);
			typeIntoFocusedParagraph("Between");
			expect(view.prompt().nodes.map(node => node.type)).toEqual([kind, "paragraph", kind]);
			expect(view.prompt().nodes[0]).toEqual(nodes[0]);
			expect(view.prompt().nodes[2]).toEqual(nodes[1]);
			expect(view.prompt().nodes[1]).toMatchObject({ content: ["Between"] });
		});
	}

	it("a nested gap inserts inside its parent without changing sibling subsections", () => {
		const children = [section("first"), section("last")];
		const view = setup([section("parent", children)]);
		fireEvent.click(view.container.querySelector('[data-prompt-row-role="gap"]')!);
		typeIntoFocusedParagraph("Between");
		const parent = view.prompt().nodes[0] as SectionNode;
		expect(view.prompt().nodes).toHaveLength(1);
		expect(parent.children).toHaveLength(3);
		expect(parent.children[0]).toEqual(children[0]);
		expect(parent.children[2]).toEqual(children[1]);
		expect(parent.children[1]).toMatchObject({ type: "paragraph", content: ["Between"] });
	});

	it("Enter in an empty section starts its body instead of editing the following section", () => {
		const next = section("next");
		const view = setup([section("empty", []), next]);
		fireEvent.click(view.container.querySelector('[data-prompt-node-id="empty"] [data-prompt-row-content]')!);
		const input = view.container.querySelector<HTMLTextAreaElement>("textarea")!;
		expect(input).not.toBeNull();
		fireEvent.keyDown(input, { key: "Enter" });
		typeIntoFocusedParagraph("New body");
		expect((view.prompt().nodes[0] as SectionNode).children).toMatchObject([{ type: "paragraph", content: ["New body"] }]);
		expect(view.prompt().nodes[1]).toEqual(next);
	});
});

it("adding the first text block immediately gives typing focus", () => {
	const view = setup([]);
	fireEvent.click(view.getByRole("button", { name: /^Text$/ }));
	typeIntoFocusedParagraph("First words");
	expect(view.prompt().nodes).toMatchObject([{ type: "paragraph", content: ["First words"] }]);
});

for (const boundary of ["start", "end"] as const) {
	it(`clicking the ${boundary} boundary starts typing outside the existing sections`, () => {
		const original = section("existing");
		const view = setup([original]);
		fireEvent.click(view.getByRole("button", {name: `Insert text at ${boundary}`}));
		typeIntoFocusedParagraph("Outside");
		const insertedIndex = boundary === "start" ? 0 : 1;
		expect(view.prompt().nodes[insertedIndex]).toMatchObject({type: "paragraph", content: ["Outside"]});
		expect(view.prompt().nodes[1 - insertedIndex]).toEqual(original);
	});
}

it("clicking an insertion button creates only one paragraph", () => {
	const view = setup([section("first"), section("last")]);
	fireEvent.click(view.getByRole("button", {name: "Insert text here"}));
	expect(view.prompt().nodes.map(node => node.type)).toEqual(["section", "section"]);
	expect(view.container.querySelector("textarea")).not.toBeNull();
});

it("clicking a gap in annotation mode does not insert content", () => {
	const nodes = [section("first"), section("last")];
	const view = setup(nodes);
	view.container.setAttribute("data-annotation-targeting", "true");
	fireEvent.click(view.container.querySelector('[data-prompt-row-role="gap"]')!);
	expect(view.prompt().nodes).toEqual(nodes);
	expect(view.container.querySelector("textarea")).toBeNull();
});

it("clicking the blank scroll area below a document appends a typing paragraph", () => {
	const original = section("existing");
	const view = setup([original]);
	fireEvent.click(view.container.querySelector('[data-prompt-flow-scroll="xml"]')!, {clientY: 1000});
	typeIntoFocusedParagraph("At the end");
	expect(view.prompt().nodes[0]).toEqual(original);
	expect(view.prompt().nodes[1]).toMatchObject({type: "paragraph", content: ["At the end"]});
});

for (const boundary of ["start", "end", "below"] as const) {
	it(`repeated ${boundary} clicks reuse the empty paragraph, then insert after typing`, () => {
		const view = setup([section("existing")]);
		const click = () => boundary === "below"
			? fireEvent.click(view.container.querySelector('[data-prompt-flow-scroll="xml"]')!, {clientY: 1000})
			: fireEvent.click(view.getByRole("button", {name: `Insert text at ${boundary}`}));
		click();
		const afterInsert = view.prompt();
		click();
		click();
		expect(view.prompt()).toBe(afterInsert);
		typeIntoFocusedParagraph("Written");
		click();
		expect(view.prompt().nodes).toHaveLength(2);
		expect(document.activeElement).toBe(view.container.querySelector("textarea"));
	});
}

for (const nested of [false, true]) {
	it(`reuses either side of an empty paragraph at ${nested ? "nested" : "root"} gaps`, () => {
		const original = [section("first"), section("last")];
		const view = setup(nested ? [section("parent", original)] : original);
		const clickGap = (index: number) => fireEvent.click(view.container.querySelectorAll('[data-prompt-row-role="gap"]')[index]!);
		clickGap(0);
		const afterInsert = view.prompt();
		clickGap(0);
		clickGap(1);
		clickGap(1);
		expect(view.prompt()).toBe(afterInsert);
		typeIntoFocusedParagraph("Between");
		const siblings = nested ? (view.prompt().nodes[0] as SectionNode).children : view.prompt().nodes;
		expect(siblings).toHaveLength(3);
		expect(siblings[0]).toEqual(original[0]);
		expect(siblings[2]).toEqual(original[1]);
		clickGap(1);
		const updated = nested ? (view.prompt().nodes[0] as SectionNode).children : view.prompt().nodes;
		expect(updated).toHaveLength(3);
	});
}

it("does not reuse a blank paragraph inside the neighboring section", () => {
	const original = section("first", [{type: "paragraph", id: "inside", content: [""]}]);
	const view = setup([original, section("last")]);
	fireEvent.click(view.getByRole("button", {name: "Insert text here"}));
	typeIntoFocusedParagraph("Outside");
	expect(view.prompt().nodes).toHaveLength(3);
	expect(view.prompt().nodes[0]).toEqual(original);
	expect(view.prompt().nodes[1]).toMatchObject({type: "paragraph", content: ["Outside"]});
});

it("abandons an untouched writing position without document changes or undo entries", () => {
	const view = setup([section("first"), section("last")]);
	const original = view.prompt();
	fireEvent.click(view.getByRole("button", {name: "Insert text here"}));
	expect(view.container.querySelector("textarea")).not.toBeNull();
	fireEvent.click(view.container.querySelector("section")!);
	expect(view.container.querySelector("textarea")).toBeNull();
	expect(view.prompt()).toBe(original);
	expect(view.changes).toHaveLength(0);
});

it("moves an untouched writing position to another gap and commits only the new location", () => {
	const originals = [section("first"), section("middle"), section("last")];
	const view = setup(originals);
	fireEvent.click(view.getAllByRole("button", {name: "Insert text here"})[0]!);
	fireEvent.click(view.getAllByRole("button", {name: "Insert text here"}).at(-1)!);
	expect(view.changes).toHaveLength(0);
	typeIntoFocusedParagraph("New location");
	expect(view.prompt().nodes.map(node => node.id)).toEqual(["first", "middle", expect.any(String), "last"]);
	expect(view.changes).toHaveLength(1);
	expect(revertSteps(view.prompt(), view.changes[0]!).nodes).toEqual(originals);
});

it("keeps a paragraph once the user typed, even after deleting all text", () => {
	const view = setup([section("first"), section("last")]);
	fireEvent.click(view.getByRole("button", {name: "Insert text here"}));
	typeIntoFocusedParagraph("Typed");
	typeIntoFocusedParagraph("");
	fireEvent.click(view.container.querySelector("section")!);
	expect(view.prompt().nodes).toHaveLength(3);
	expect(view.prompt().nodes[1]).toMatchObject({type: "paragraph", content: [""]});
});

it("preserves a preexisting empty paragraph when it is focused and abandoned", () => {
	const originals: PromptBlockNode[] = [section("first"), {type: "paragraph", id: "existing-empty", content: [""]}, section("last")];
	const view = setup(originals);
	fireEvent.click(view.getAllByRole("button", {name: "Insert text here"})[0]!);
	fireEvent.click(view.container.querySelector("section")!);
	expect(view.prompt().nodes).toEqual(originals);
	expect(view.changes).toHaveLength(0);
});

it("commits slash typing and keeps the chosen block when focus leaves", () => {
	const view = setup([section("first"), section("last")]);
	fireEvent.click(view.getByRole("button", {name: "Insert text here"}));
	typeIntoFocusedParagraph("/");
	expect(view.getByRole("listbox")).toBeTruthy();
	fireEvent.click(view.getByRole("option", {name: "Bullets Unordered list"}));
	fireEvent.click(view.container.querySelector("section")!);
	expect(view.prompt().nodes.map(node => node.type)).toEqual(["section", "bulletList", "section"]);
});

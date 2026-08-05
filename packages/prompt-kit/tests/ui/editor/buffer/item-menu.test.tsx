import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { BulletListNode, PromptDocument } from "../../../../src/index";
import { canonicalizePrompt } from "../../../../src/index";
import {
	createPromptEditorModel,
} from "../../../../src/ui/editor/model";
import {
	applyStep,
	invertStep,
	type PromptStep,
} from "../../../../src/ui/editor/transactions";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";

afterEach(() => {
	cleanup();
});

/**
 * A top-level list (so Outdent is impossible from it) whose middle item nests a
 * child list (so Outdent IS possible from the nested item), plus a trailing
 * plain item. Covers every disabled/enabled combination the menu shows.
 */
const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "item-menu-doc",
	nodes: [
		{
			type: "bulletList",
			id: "list-1",
			items: [
				{ type: "listItem", id: "item-a", content: ["Alpha"] },
				{
					type: "listItem",
					id: "item-b",
					content: ["Bravo"],
					children: [
						{
							type: "bulletList",
							id: "list-nested",
							items: [
								{ type: "listItem", id: "item-n", content: ["Nested"] },
							],
						},
					],
				},
				{ type: "listItem", id: "item-c", content: ["Charlie"] },
			],
		},
	],
};

function renderFlow(
	onPromptChange: (
		next: PromptDocument,
		focusId?: string,
		steps?: PromptStep[],
	) => void = () => {},
) {
	const model = createPromptEditorModel(prompt, {});
	return render(
		<PromptFlowXml
			prompt={model.prompt}
			model={model}
			onSelectNode={() => {}}
			onPromptChange={(next, focusId, steps) =>
				onPromptChange(next, focusId, steps as PromptStep[] | undefined)
			}
		/>,
	);
}

function itemRow(itemId: string): HTMLElement {
	return document.querySelector<HTMLElement>(
		`[data-prompt-node-id="${itemId}"][data-prompt-row-role="item"]`,
	)!;
}

function gripOf(row: HTMLElement): HTMLElement {
	return row.querySelector<HTMLElement>(
		'[data-prompt-affordance="item-handle"] button',
	)!;
}

/** Reveals the item's handle (hover resolves it), then clicks the grip. */
function openMenuOn(itemId: string): void {
	const row = itemRow(itemId);
	fireEvent.mouseEnter(row);
	fireEvent.click(gripOf(row));
}

function menuButton(label: string): HTMLButtonElement | undefined {
	return Array.from(document.querySelectorAll("button")).find(
		(button) => button.textContent === label,
	) as HTMLButtonElement | undefined;
}

function firstList(next: PromptDocument): BulletListNode {
	return next.nodes[0] as BulletListNode;
}

describe("PromptFlowXml item menu (item grip click)", () => {
	it("a motionless click on the item grip opens the menu with all four entries", () => {
		renderFlow();

		// The press ARMS a drag (pointerdown) but never travels, so the release
		// click stays a click — the menu opener, same model as the block grip.
		const row = itemRow("item-b");
		fireEvent.mouseEnter(row);
		const grip = gripOf(row);
		fireEvent.pointerDown(grip, { button: 0, clientX: 5, clientY: 5 });
		fireEvent.pointerUp(window);
		fireEvent.click(grip);

		for (const label of ["Duplicate", "Indent", "Outdent", "Delete"]) {
			expect(menuButton(label)).toBeTruthy();
		}
		// The handle's affordance names the second gesture.
		expect(grip.getAttribute("title")).toBe("Drag, or click for item menu");
	});

	it("Delete removes the item (subtree included) as ONE invertible step", () => {
		let committed: {
			prompt: PromptDocument;
			steps: PromptStep[] | undefined;
		} | null = null;
		renderFlow((next, _focusId, steps) => {
			committed = { prompt: next, steps };
		});

		openMenuOn("item-b");
		fireEvent.click(menuButton("Delete")!);

		expect(committed).not.toBeNull();
		const { prompt: next, steps } = committed!;
		expect(firstList(next).items.map((item) => item.id)).toEqual([
			"item-a",
			"item-c",
		]);
		expect(steps).toHaveLength(1);
		expect(steps![0]!.op).toBe("update");
		expect(canonicalizePrompt(applyStep(next, invertStep(steps![0]!)))).toBe(
			canonicalizePrompt(prompt),
		);
		// The menu closed with the action.
		expect(menuButton("Delete")).toBeUndefined();
	});

	it("Duplicate inserts a copy right after the item, with a fresh id", () => {
		let committed: PromptDocument | null = null;
		renderFlow((next) => {
			committed = next;
		});

		openMenuOn("item-a");
		fireEvent.click(menuButton("Duplicate")!);

		const items = firstList(committed!).items;
		expect(items.map((item) => item.content)).toEqual([
			["Alpha"],
			["Alpha"],
			["Bravo"],
			["Charlie"],
		]);
		expect(items[1]!.id).toBeDefined();
		expect(items[1]!.id).not.toBe("item-a");
	});

	it("Indent is disabled on a list's first item; Outdent is disabled in a top-level list", () => {
		renderFlow();

		openMenuOn("item-a");
		expect(menuButton("Indent")!.disabled).toBe(true);
		expect(menuButton("Outdent")!.disabled).toBe(true);
		// Disabled entries commit nothing when clicked.
		expect(menuButton("Duplicate")!.disabled).toBe(false);
	});

	it("Indent is enabled with a previous sibling; Outdent is enabled from a nested list", () => {
		renderFlow();

		openMenuOn("item-c");
		expect(menuButton("Indent")!.disabled).toBe(false);
		expect(menuButton("Outdent")!.disabled).toBe(true);

		// Escape closes this menu before opening the next.
		fireEvent.keyDown(window, { key: "Escape" });
		expect(menuButton("Indent")).toBeUndefined();

		openMenuOn("item-n");
		expect(menuButton("Outdent")!.disabled).toBe(false);
		expect(menuButton("Indent")!.disabled).toBe(true);
	});

	it("Indent nests the item under its previous sibling through the keymap's step", () => {
		let committed: PromptDocument | null = null;
		renderFlow((next) => {
			committed = next;
		});

		openMenuOn("item-c");
		fireEvent.click(menuButton("Indent")!);

		const items = firstList(committed!).items;
		expect(items.map((item) => item.id)).toEqual(["item-a", "item-b"]);
		// item-c joined item-b's existing trailing child list.
		const nested = items[1]!.children![0] as BulletListNode;
		expect(nested.items.map((item) => item.id)).toEqual(["item-n", "item-c"]);
	});

	it("Outdent hoists a nested item back into the outer list", () => {
		let committed: PromptDocument | null = null;
		renderFlow((next) => {
			committed = next;
		});

		openMenuOn("item-n");
		fireEvent.click(menuButton("Outdent")!);

		const items = firstList(committed!).items;
		// item-n lands right after its former parent; the emptied nested list
		// is dropped with it.
		expect(items.map((item) => item.id)).toEqual([
			"item-a",
			"item-b",
			"item-n",
			"item-c",
		]);
		expect(items[1]!.children).toBeUndefined();
	});
});

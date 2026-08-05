// Slice: list-item / block mutation helpers used by the interaction layer.
// All mutations route through the *WithStep helpers (directly or via
// list-item-steps) so they commit as invertible transactions.
"use client";

import type {
	CodeBlockNode,
	FieldNode,
	ParagraphNode,
	PromptBlockNode,
	PromptDocument,
	RawNode,
} from "../../../index";
import {
	editableTextToInline,
	getPromptBlockNodeById,
	inlineToEditableText,
	type PromptEditorTreeEntry,
} from "../model";
import {
	insertPromptBlockNodeWithStep,
	removePromptBlockNodeByIdWithStep,
	updatePromptBlockNodeByIdWithStep,
	type PromptStep,
} from "../transactions";

import { concatInline, setListItemContentStep } from "./list-item-steps";
import { updateNode } from "../shared";
import type { PromptFlowViewProps } from "../types";
import type { XmlLine } from "../../../document/render/line-model";

/** The rendered marker prefix for an item ("1." for ordered, "-" for bullet). */
export function listMarker(node: PromptBlockNode, itemIndex: number): string {
	if (node.type === "orderedList") return `${(node.start ?? 1) + itemIndex}.`;
	return "-";
}

/** Editable text of an item, without the marker. */
export function itemContentText(node: PromptBlockNode, itemIndex: number): string {
	if (node.type !== "bulletList" && node.type !== "orderedList") return "";
	const item = node.items[itemIndex];
	return item ? inlineToEditableText(item.content) : "";
}

/**
 * Registers nested lists (those inside list-item children, which the editor
 * tree does not walk) into the id→entry map so their items stay inline-editable
 * and item ops resolve by id. Recurses through any depth of item nesting.
 */
export function registerNestedLists(
	entry: PromptEditorTreeEntry,
	map: Map<string, PromptEditorTreeEntry>,
): void {
	const node = entry.node;
	if (node.type !== "bulletList" && node.type !== "orderedList") return;
	for (const item of node.items) {
		for (const child of item.children ?? []) {
			if (
				(child.type === "bulletList" || child.type === "orderedList") &&
				child.id &&
				!map.has(child.id)
			) {
				const synthetic: PromptEditorTreeEntry = {
					...entry,
					id: child.id,
					node: child,
				};
				map.set(child.id, synthetic);
				registerNestedLists(synthetic, map);
			}
		}
	}
}

/** Renames a section's tag (the "type name as header" menu action). */
export function retagSection(
	prompt: PromptDocument,
	entry: PromptEditorTreeEntry,
	tag: string,
	onPromptChange: PromptFlowViewProps["onPromptChange"],
): void {
	updateNode(prompt, entry, onPromptChange, (current) =>
		current.type === "section" ? { ...current, tag } : current,
	);
}

export interface ParagraphStepsResult {
	prompt: PromptDocument;
	steps: PromptStep[];
	/** Id of the paragraph the caller should focus. */
	focusNodeId?: string;
	/** Caret position (in editable text) the caller should land on. */
	caretOffset?: number;
}

/**
 * Splits a paragraph at a caret: the node keeps `beforeText`, and a NEW
 * paragraph carrying `afterText` is inserted directly after it. Committed as
 * one transaction (update + insert), so a single undo restores the original.
 * Enter-at-end degenerates to inserting an empty paragraph below.
 */
export function splitParagraphSteps(
	prompt: PromptDocument,
	nodeId: string,
	beforeText: string,
	afterText: string,
): ParagraphStepsResult {
	const update = updatePromptBlockNodeByIdWithStep(prompt, nodeId, (current) =>
		current.type === "paragraph"
			? ({
					...current,
					content: editableTextToInline(beforeText),
				} satisfies ParagraphNode)
			: current,
	);
	const paragraph: PromptBlockNode = {
		type: "paragraph",
		content: editableTextToInline(afterText),
	};
	const insert = insertPromptBlockNodeWithStep(
		update.prompt,
		nodeId,
		paragraph,
		"after",
	);
	const steps: PromptStep[] = [];
	if (update.step) steps.push(update.step);
	if (insert.step) steps.push(insert.step);
	const focusNodeId =
		insert.step?.op === "insert" ? insert.step.node.id : undefined;
	return { prompt: insert.prompt, steps, focusNodeId, caretOffset: 0 };
}

/**
 * Merges paragraph `currentId` into its previous sibling `previousId`:
 * inline content concatenates (structured inline survives) and the merged
 * node absorbs the second paragraph, which is removed. The caret lands at
 * the join point. Committed as one transaction (update + remove).
 */
export function mergeParagraphsSteps(
	prompt: PromptDocument,
	previousId: string,
	currentId: string,
): ParagraphStepsResult {
	const previous = getPromptBlockNodeById(prompt, previousId);
	const current = getPromptBlockNodeById(prompt, currentId);
	if (
		!previous ||
		!current ||
		previous.node.type !== "paragraph" ||
		current.node.type !== "paragraph"
	) {
		return { prompt, steps: [] };
	}
	const caretOffset = inlineToEditableText(previous.node.content).length;
	const mergedContent = concatInline(
		previous.node.content,
		current.node.content,
	);
	const update = updatePromptBlockNodeByIdWithStep(
		prompt,
		previousId,
		(node) =>
			node.type === "paragraph"
				? ({ ...node, content: mergedContent } satisfies ParagraphNode)
				: node,
	);
	const remove = removePromptBlockNodeByIdWithStep(update.prompt, currentId);
	const steps: PromptStep[] = [];
	if (update.step) steps.push(update.step);
	if (remove.step) steps.push(remove.step);
	return {
		prompt: remove.prompt,
		steps,
		focusNodeId: previousId,
		caretOffset,
	};
}

/**
 * Removes an empty paragraph (the Backspace-on-empty path). A plain remove
 * step; the caller decides where focus lands next.
 */
export function removeParagraphSteps(
	prompt: PromptDocument,
	nodeId: string,
): ParagraphStepsResult {
	const result = removePromptBlockNodeByIdWithStep(prompt, nodeId);
	return {
		prompt: result.prompt,
		steps: result.step ? [result.step] : [],
	};
}

/**
 * Finds the outer list + parent-item that hold the nested list `nestedListId`,
 * so Shift+Tab can hoist an item out. Returns undefined when `nestedListId` is
 * a top-level list (nothing to un-nest from). Searches only one level of items,
 * which covers the nesting this surface can create.
 */
export function findUnnestLocation(
	prompt: PromptDocument,
	nestedListId: string,
	_itemIndex: number,
): { outerListId: string; parentItemIndex: number } | undefined {
	const walk = (
		nodes: readonly PromptBlockNode[],
	): { outerListId: string; parentItemIndex: number } | undefined => {
		for (const node of nodes) {
			if (node.type === "bulletList" || node.type === "orderedList") {
				for (let i = 0; i < node.items.length; i++) {
					const children = node.items[i]?.children ?? [];
					for (const child of children) {
						if (child.id === nestedListId && node.id) {
							return { outerListId: node.id, parentItemIndex: i };
						}
						if (child.type === "bulletList" || child.type === "orderedList") {
							const deeper = walk([child]);
							if (deeper) return deeper;
						}
					}
				}
			}
			if (node.type === "section" || node.type === "example") {
				const found = walk(node.children);
				if (found) return found;
			}
			if (node.type === "field") {
				const found = walk(node.children ?? []);
				if (found) return found;
			}
			if (node.type === "contextUsage") {
				const found = walk(node.instructions);
				if (found) return found;
			}
		}
		return undefined;
	};
	return walk(prompt.nodes);
}

/**
 * A section's editable value is its TAG — the name between the brackets. The
 * brackets themselves are trim the row draws around the editor, the same way a
 * list item's marker is trim: they must never be typed, deleted, or selected.
 */
export function sectionTagText(node: PromptBlockNode): string {
	return node.type === "section" ? node.tag : "";
}

/**
 * Keeps a typed tag renderable as XML: whitespace becomes `_` (typing two words
 * is the common case) and the characters that would break the tag out of its
 * own brackets are dropped. Everything else is left exactly as typed — an
 * invalid name still reaches validation, which reports it and blocks the save,
 * rather than being silently rewritten under the caret.
 */
export function sanitizeSectionTag(value: string): string {
	return value.replace(/\s+/g, "_").replace(/[<>/"'`]/g, "");
}

export function editorValueForLine(node: PromptBlockNode, line: XmlLine): string {
	switch (node.type) {
		case "section":
			return node.tag;
		case "paragraph":
			return inlineToEditableText(node.content);
		case "field":
			return inlineToEditableText(node.value);
		case "raw":
			return node.value;
		case "codeBlock":
			return node.code;
		case "bulletList":
		case "orderedList": {
			const item = node.items[line.itemIndex ?? 0];
			return item ? inlineToEditableText(item.content) : "";
		}
		default:
			return line.text;
	}
}

export function commitEdit(
	prompt: PromptDocument,
	entry: PromptEditorTreeEntry,
	line: XmlLine,
	nextValue: string,
	onPromptChange: PromptFlowViewProps["onPromptChange"],
): void {
	const node = entry.node;
	switch (node.type) {
		case "section": {
			const tag = sanitizeSectionTag(nextValue);
			updateNode(prompt, entry, onPromptChange, (current) =>
				current.type === "section" ? { ...current, tag } : current,
			);
			return;
		}
		case "paragraph":
			updateNode(prompt, entry, onPromptChange, (current) =>
				current.type === "paragraph"
					? ({ ...current, content: editableTextToInline(nextValue) } satisfies ParagraphNode)
					: current,
			);
			return;
		case "field":
			updateNode(prompt, entry, onPromptChange, (current) =>
				current.type === "field"
					? ({ ...current, value: editableTextToInline(nextValue) } satisfies FieldNode)
					: current,
			);
			return;
		case "raw":
			updateNode(prompt, entry, onPromptChange, (current) =>
				current.type === "raw" ? ({ ...current, value: nextValue } satisfies RawNode) : current,
			);
			return;
		case "codeBlock":
			updateNode(prompt, entry, onPromptChange, (current) =>
				current.type === "codeBlock"
					? ({ ...current, code: nextValue } satisfies CodeBlockNode)
					: current,
			);
			return;
		case "bulletList":
		case "orderedList": {
			// Route through the list-step helper: it resolves nested lists
			// (which are not tree-addressable) via their ancestor list.
			const itemIndex = line.itemIndex ?? 0;
			const result = setListItemContentStep(
				prompt,
				entry.id,
				itemIndex,
				nextValue,
			);
			if (result.step) {
				onPromptChange(result.prompt, entry.id, [result.step]);
			}
			return;
		}
	}
}

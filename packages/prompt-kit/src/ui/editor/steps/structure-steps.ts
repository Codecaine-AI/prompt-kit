// Slice: structure mutations — the block-level shape changes behind Enter, Tab,
// Shift+Tab, the slash menu and markdown autoformat.
//
// Every helper here is pure: it reads a PromptDocument and returns the steps
// that produce the new one, never mutating the input. Steps come from the same
// *WithStep wrappers the rest of the editor uses, so a whole structural gesture
// (which can be two or three steps) commits as ONE transaction and undoes as
// one action.
//
// Moves are expressed as remove + insert rather than a `move` step: removing
// first frees the node's ids, so `prepareBlockForInsert` re-attaches the SAME
// ids instead of minting new ones, and the caller's selection/caret survive the
// reparent.

import type {
	BulletListNode,
	CodeBlockNode,
	ListItemNode,
	OrderedListNode,
	ParagraphNode,
	PromptBlockNode,
	PromptDocument,
	PromptInline,
	SectionNode,
} from "../../../index";
import {
	ensurePromptNodeIds,
	getPromptBlockNodeById,
	inlineToEditableText,
	updatePromptBlockNodeById,
} from "../model";
import {
	insertPromptBlockNodeWithStep,
	removePromptBlockNodeByIdWithStep,
	updatePromptBlockNodeByIdWithStep,
	type PromptStep,
} from "../transactions";

import {
	concatInline,
	emptyInline,
	removeListItemStep,
	unnestListItemStep,
} from "./list-item-steps";
import { findUnnestLocation } from "./node-mutations";

/**
 * What a structural gesture produced: the next document, the steps that make
 * it, and where editing should resume. `focusItemIndex` is set only when the
 * focus target is a list item; `caretOffset` only when the target has editable
 * text (a section header line has none).
 *
 * A gesture that does not apply returns `null` rather than an empty result, so
 * the caller can fall through to its default handling (e.g. Tab moving focus).
 */
export interface StructureStepResult {
	prompt: PromptDocument;
	steps: PromptStep[];
	/** Id of the node the caller should focus. */
	focusNodeId?: string;
	/** Item index within `focusNodeId`, when it is a list. */
	focusItemIndex?: number;
	/** Caret position (in editable text) the caller should land on. */
	caretOffset?: number;
}

type ListNode = BulletListNode | OrderedListNode;

/** Target shapes a paragraph can be converted into. */
export type ConvertParagraphTarget =
	| "bulletList"
	| "orderedList"
	| "codeBlock"
	| "section";

export interface ConvertParagraphOptions {
	/**
	 * Content to carry into the new node, overriding the paragraph's own.
	 * Markdown autoformat passes the text with its marker (`- `, `1. `, ```)
	 * already stripped.
	 */
	content?: readonly PromptInline[];
	/** Fence language for `codeBlock`; omitted renders a bare ``` fence. */
	language?: string;
	/** Tag for `section` (default `"section"`). */
	tag?: string;
}

/* ------------------------------------------------------------------ *
 * 1. Escaping a list
 * ------------------------------------------------------------------ */

/**
 * Enter on an EMPTY list item.
 *
 * - Nested item (the list is a child of a list item): outdents one level,
 *   hoisting the item to sit after its former parent item.
 * - Top-level item: drops the empty item and opens a new empty paragraph
 *   immediately after the list, at the list's own level (document root, or the
 *   section that holds the list).
 * - Only item: the list goes away entirely and the paragraph takes its place.
 *
 * Returns null when the item is not empty or still carries nested children —
 * escaping would silently discard content, so the caller should split instead.
 */
export function escapeListStep(
	prompt: PromptDocument,
	listNodeId: string,
	itemIndex: number,
): StructureStepResult | null {
	const list = findListNodeById(prompt, listNodeId);
	const item = list?.items[itemIndex];
	if (!list || !item) return null;
	if (inlineToEditableText(item.content).length > 0) return null;
	if (item.children && item.children.length > 0) return null;

	const nested = findUnnestLocation(prompt, listNodeId, itemIndex);
	if (nested) return escapeByOutdent(prompt, listNodeId, itemIndex, nested);

	// Block-addressable list: leave it for a paragraph at the list's level.
	if (!getPromptBlockNodeById(prompt, listNodeId)) return null;
	const paragraph: ParagraphNode = { type: "paragraph", content: emptyInline() };
	const steps: PromptStep[] = [];

	if (list.items.length <= 1) {
		// Insert BEFORE removing: the list is the only anchor for the position,
		// and applying insert-then-remove lands the paragraph exactly where the
		// list was.
		const insert = insertPromptBlockNodeWithStep(
			prompt,
			listNodeId,
			paragraph,
			"after",
		);
		if (!insert.step) return null;
		const remove = removePromptBlockNodeByIdWithStep(insert.prompt, listNodeId);
		if (!remove.step) return null;
		steps.push(insert.step, remove.step);
		return {
			prompt: remove.prompt,
			steps,
			focusNodeId: insertedNodeId(insert.step),
			caretOffset: 0,
		};
	}

	const removed = removeListItemStep(prompt, listNodeId, itemIndex);
	if (!removed.step) return null;
	const insert = insertPromptBlockNodeWithStep(
		removed.prompt,
		listNodeId,
		paragraph,
		"after",
	);
	if (!insert.step) return null;
	steps.push(removed.step, insert.step);
	return {
		prompt: insert.prompt,
		steps,
		focusNodeId: insertedNodeId(insert.step),
		caretOffset: 0,
	};
}

function escapeByOutdent(
	prompt: PromptDocument,
	listNodeId: string,
	itemIndex: number,
	nested: { outerListId: string; parentItemIndex: number },
): StructureStepResult | null {
	// `unnestListItemStep` hoists out of the parent item's LAST list child; if
	// this list is not that one the indices would not line up, so decline.
	const outer = findListNodeById(prompt, nested.outerListId);
	const parentItem = outer?.items[nested.parentItemIndex];
	const target = lastListChild(parentItem?.children ?? []);
	if (!target || target.id !== listNodeId) return null;

	const result = unnestListItemStep(
		prompt,
		nested.outerListId,
		nested.parentItemIndex,
		itemIndex,
	);
	if (!result.step) return null;
	return {
		prompt: result.prompt,
		steps: [result.step],
		focusNodeId: nested.outerListId,
		focusItemIndex: nested.parentItemIndex + 1,
		caretOffset: 0,
	};
}

/* ------------------------------------------------------------------ *
 * 2-4. Moving blocks between levels
 * ------------------------------------------------------------------ */

/**
 * Shift+Tab / Enter on a trailing paragraph inside a section: moves the
 * paragraph out to become the section's next sibling. The paragraph keeps its
 * id, so the caller can keep editing it; `caretOffset` defaults to the end of
 * its text (0 for the empty paragraph this gesture usually targets).
 *
 * Returns null when the paragraph sits at the document root or its parent is
 * not a section (a field/example/context body has its own outdent rules).
 */
export function outdentParagraphStep(
	prompt: PromptDocument,
	paragraphNodeId: string,
	caretOffset?: number,
): StructureStepResult | null {
	const entry = getPromptBlockNodeById(prompt, paragraphNodeId);
	if (!entry || entry.node.type !== "paragraph") return null;
	const parent = locateBlock(prompt, paragraphNodeId)?.parent;
	if (!parent || parent.type !== "section" || !parent.id) return null;

	const moved = moveBlockSteps(prompt, paragraphNodeId, parent.id, "after");
	if (!moved) return null;
	return {
		...moved,
		focusNodeId: paragraphNodeId,
		caretOffset: caretOffset ?? inlineToEditableText(entry.node.content).length,
	};
}

/**
 * Tab on a paragraph that directly follows a section: makes it that section's
 * LAST child. The paragraph keeps its id and the caret stays where it was
 * (`caretOffset`, defaulting to the end of the text).
 *
 * Returns null when the previous sibling is not a section — there is nothing to
 * indent into, and Tab should fall through.
 */
export function indentParagraphIntoSectionStep(
	prompt: PromptDocument,
	paragraphNodeId: string,
	caretOffset?: number,
): StructureStepResult | null {
	const entry = getPromptBlockNodeById(prompt, paragraphNodeId);
	if (!entry || entry.node.type !== "paragraph") return null;
	const location = locateBlock(prompt, paragraphNodeId);
	if (!location) return null;
	const previous = location.siblings[location.index - 1];
	if (!previous || previous.type !== "section" || !previous.id) return null;

	const moved = moveBlockSteps(prompt, paragraphNodeId, previous.id, "child");
	if (!moved) return null;
	return {
		...moved,
		focusNodeId: paragraphNodeId,
		caretOffset: caretOffset ?? inlineToEditableText(entry.node.content).length,
	};
}

/**
 * Tab on a section: nests it as the LAST child of the preceding sibling
 * section. Its own children travel with it. Returns null when the previous
 * sibling is not a section (nothing to nest under).
 */
export function demoteSectionStep(
	prompt: PromptDocument,
	sectionNodeId: string,
): StructureStepResult | null {
	const entry = getPromptBlockNodeById(prompt, sectionNodeId);
	if (!entry || entry.node.type !== "section") return null;
	const location = locateBlock(prompt, sectionNodeId);
	if (!location) return null;
	const previous = location.siblings[location.index - 1];
	if (!previous || previous.type !== "section" || !previous.id) return null;

	const moved = moveBlockSteps(prompt, sectionNodeId, previous.id, "child");
	if (!moved) return null;
	return { ...moved, focusNodeId: sectionNodeId };
}

/**
 * Shift+Tab on a section: lifts it out to become its parent section's next
 * sibling, children and all. Returns null at the document root (nothing to
 * climb out of) or when the parent is not a section.
 */
export function promoteSectionStep(
	prompt: PromptDocument,
	sectionNodeId: string,
): StructureStepResult | null {
	const entry = getPromptBlockNodeById(prompt, sectionNodeId);
	if (!entry || entry.node.type !== "section") return null;
	const parent = locateBlock(prompt, sectionNodeId)?.parent;
	if (!parent || parent.type !== "section" || !parent.id) return null;

	const moved = moveBlockSteps(prompt, sectionNodeId, parent.id, "after");
	if (!moved) return null;
	return { ...moved, focusNodeId: sectionNodeId };
}

/* ------------------------------------------------------------------ *
 * 5. Converting a paragraph
 * ------------------------------------------------------------------ */

/**
 * Turns a paragraph into another block IN PLACE, keeping its id and position
 * (one update step). The paragraph's inline content is carried into the new
 * node's first editable slot — the first list item, the code body, or the
 * section's first child paragraph — so this is safe on a paragraph that
 * already holds text, not just an empty one. Structured inline (variables,
 * references) survives; adjacent plain runs are coalesced so the result is
 * byte-identical to typing the same characters.
 *
 * The caret lands at the END of the carried text (offset 0 for the empty
 * paragraph the slash menu and autoformat convert).
 *
 * Returns null when the node is missing or is not a paragraph.
 */
export function convertParagraphToStep(
	prompt: PromptDocument,
	paragraphNodeId: string,
	target: ConvertParagraphTarget,
	options: ConvertParagraphOptions = {},
): StructureStepResult | null {
	const entry = getPromptBlockNodeById(prompt, paragraphNodeId);
	if (!entry || entry.node.type !== "paragraph") return null;

	const content = coalesceInline(options.content ?? entry.node.content);
	const caretOffset = inlineToEditableText(content).length;
	const replacement = buildConverted(paragraphNodeId, target, content, options);
	const result = replaceBlockWithStep(prompt, paragraphNodeId, replacement);
	if (!result.step) return null;

	if (target === "section") {
		const section = getPromptBlockNodeById(result.prompt, paragraphNodeId);
		const child =
			section?.node.type === "section" ? section.node.children[0] : undefined;
		return {
			prompt: result.prompt,
			steps: [result.step],
			focusNodeId: child?.id ?? paragraphNodeId,
			caretOffset,
		};
	}
	const isList = target === "bulletList" || target === "orderedList";
	return {
		prompt: result.prompt,
		steps: [result.step],
		focusNodeId: paragraphNodeId,
		...(isList ? { focusItemIndex: 0 } : {}),
		caretOffset,
	};
}

/**
 * Turns a block back into a paragraph carrying `text`, keeping its id and
 * position — the exact inverse of `convertParagraphToStep` for the blocks
 * markdown autoformat produces.
 *
 * This is what makes Backspace immediately after `- ` mean "I did not want a
 * list, give me my characters back" instead of "delete this block". It is a
 * step like any other, so the marker can also be taken back with undo.
 */
export function convertBlockToParagraphStep(
	prompt: PromptDocument,
	nodeId: string,
	text: string,
): StructureStepResult | null {
	const entry = getPromptBlockNodeById(prompt, nodeId);
	if (!entry || entry.node.type === "paragraph") return null;
	const paragraph: ParagraphNode = {
		type: "paragraph",
		id: nodeId,
		content: [text],
	};
	const result = replaceBlockWithStep(prompt, nodeId, paragraph);
	if (!result.step) return null;
	return {
		prompt: result.prompt,
		steps: [result.step],
		focusNodeId: nodeId,
		caretOffset: text.length,
	};
}

function buildConverted(
	id: string,
	target: ConvertParagraphTarget,
	content: PromptInline[],
	options: ConvertParagraphOptions,
): PromptBlockNode {
	switch (target) {
		case "bulletList":
		case "orderedList": {
			const item: ListItemNode = { type: "listItem", content };
			return { type: target, id, items: [item] } as ListNode;
		}
		case "codeBlock": {
			const code: CodeBlockNode = {
				type: "codeBlock",
				id,
				...(options.language ? { language: options.language } : {}),
				code: inlineToEditableText(content),
			};
			return code;
		}
		case "section": {
			const section: SectionNode = {
				type: "section",
				id,
				tag: options.tag ?? "section",
				children: [{ type: "paragraph", content }],
			};
			return section;
		}
	}
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/**
 * Replaces a block with a differently-shaped one, keeping its id and position.
 * New descendants (a converted section's child paragraph) arrive without ids,
 * so the replacement is run through `ensurePromptNodeIds` first — the same id
 * generator inserts use — and only then diffed into an update step. Ids are
 * part of the canonical document, so they must be settled before the step is
 * recorded or undo/redo would re-mint them.
 */
function replaceBlockWithStep(
	prompt: PromptDocument,
	nodeId: string,
	replacement: PromptBlockNode,
): { prompt: PromptDocument; step?: PromptStep } {
	const ensured = ensurePromptNodeIds(
		updatePromptBlockNodeById(prompt, nodeId, () => replacement),
	);
	const resolved = getPromptBlockNodeById(ensured, nodeId)?.node ?? replacement;
	return updatePromptBlockNodeByIdWithStep(prompt, nodeId, () => resolved);
}

/**
 * Reparents a block: remove, then insert relative to `targetId`. The removal
 * frees the subtree's ids, so the insert restores them unchanged.
 */
function moveBlockSteps(
	prompt: PromptDocument,
	nodeId: string,
	targetId: string,
	position: "before" | "after" | "child",
): { prompt: PromptDocument; steps: PromptStep[] } | null {
	const remove = removePromptBlockNodeByIdWithStep(prompt, nodeId);
	if (!remove.step || remove.step.op !== "remove") return null;
	const insert = insertPromptBlockNodeWithStep(
		remove.prompt,
		targetId,
		remove.step.removed,
		position,
	);
	if (!insert.step) return null;
	return { prompt: insert.prompt, steps: [remove.step, insert.step] };
}

function insertedNodeId(step: PromptStep): string | undefined {
	return step.op === "insert" ? step.node.id : undefined;
}

/** Collapses adjacent plain-text runs; never returns an empty inline array. */
function coalesceInline(content: readonly PromptInline[]): PromptInline[] {
	const joined = concatInline([], content);
	return joined.length > 0 ? joined : emptyInline();
}

interface BlockLocation {
	/** Container holding the block; undefined when it sits at the document root. */
	parent?: PromptBlockNode;
	siblings: readonly PromptBlockNode[];
	index: number;
}

/**
 * Finds a block's container and position. Mirrors the editor tree: it descends
 * through section / example / field / contextUsage bodies but NOT into list
 * items, whose children are addressed through the list-step helpers instead.
 */
function locateBlock(
	prompt: PromptDocument,
	id: string,
): BlockLocation | undefined {
	const walk = (
		nodes: readonly PromptBlockNode[],
		parent: PromptBlockNode | undefined,
	): BlockLocation | undefined => {
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index];
			if (!node) continue;
			if (node.id === id) return { parent, siblings: nodes, index };
			const children = childBlocks(node);
			if (!children) continue;
			const found = walk(children, node);
			if (found) return found;
		}
		return undefined;
	};
	return walk(prompt.nodes, undefined);
}

function childBlocks(
	node: PromptBlockNode,
): readonly PromptBlockNode[] | undefined {
	switch (node.type) {
		case "section":
		case "example":
			return node.children;
		case "field":
			return node.children;
		case "contextUsage":
			return node.instructions;
		default:
			return undefined;
	}
}

function isListNode(node: PromptBlockNode): node is ListNode {
	return node.type === "bulletList" || node.type === "orderedList";
}

/**
 * Finds a list by id anywhere in the document, INCLUDING lists nested inside
 * list items (which the editor tree does not walk) — escaping a list has to
 * inspect the very nesting the tree hides.
 */
function findListNodeById(
	prompt: PromptDocument,
	listId: string,
): ListNode | undefined {
	const walk = (nodes: readonly PromptBlockNode[]): ListNode | undefined => {
		for (const node of nodes) {
			if (isListNode(node)) {
				if (node.id === listId) return node;
				for (const item of node.items) {
					const found = walk(item.children ?? []);
					if (found) return found;
				}
				continue;
			}
			const children = childBlocks(node);
			if (!children) continue;
			const found = walk(children);
			if (found) return found;
		}
		return undefined;
	};
	return walk(prompt.nodes);
}

function lastListChild(
	children: readonly PromptBlockNode[],
): ListNode | undefined {
	for (let index = children.length - 1; index >= 0; index -= 1) {
		const child = children[index];
		if (child && isListNode(child)) return child;
	}
	return undefined;
}

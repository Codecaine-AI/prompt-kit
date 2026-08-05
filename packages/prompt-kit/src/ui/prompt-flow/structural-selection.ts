// Slice: THE canonical structural-selection model — how a marquee's covered
// rows resolve to ONE structural object (a contiguous sibling run), and the
// pure queries the surface needs to validate, paint, move, and delete it.

import type {
	BulletListNode,
	OrderedListNode,
	PromptBlockNode,
	PromptDocument,
} from "../../index";
import type { XmlLine } from "../../document/render/line-model";

/**
 * A structural selection: a CONTIGUOUS run of siblings under one parent,
 * addressed by position so the run reads as one object wherever it lives.
 *
 *   kind "items"   `parentId` is a LIST id; [start, end] are item indexes.
 *                  This keeps the list-scoped semantics the shift-click item
 *                  selection established: an item run can never span lists.
 *   kind "blocks"  `parentId` is a container block id (section / example /
 *                  contextUsage / field), or null for the document's own
 *                  top-level run; [start, end] index the parent's children.
 *
 * Both endpoints are inclusive and normalized (start <= end).
 */
export interface StructuralSelection {
	parentId: string | null;
	kind: "items" | "blocks";
	start: number;
	end: number;
}

type ListNode = BulletListNode | OrderedListNode;

function isListNode(node: PromptBlockNode): node is ListNode {
	return node.type === "bulletList" || node.type === "orderedList";
}

/** Container kinds whose children form a blocks-run level. */
function isBlockContainer(node: PromptBlockNode): boolean {
	return (
		node.type === "section" ||
		node.type === "example" ||
		node.type === "contextUsage" ||
		node.type === "field"
	);
}

function childBlocksOf(node: PromptBlockNode): readonly PromptBlockNode[] {
	switch (node.type) {
		case "section":
		case "example":
			return node.children;
		case "field":
			return node.children ?? [];
		case "contextUsage":
			return node.instructions;
		default:
			return [];
	}
}

/**
 * Structural facts about every addressable unit (block or list item): its
 * parent RUN LEVEL, its index there, and which ids can own a run. The parent
 * chain mirrors `buildAnnotationParentMap` (annotation-targeting.ts): an
 * item's parent is its LIST, blocks nested in an item parent to the ITEM, and
 * top-level blocks parent to the document root (`null`).
 */
interface StructuralIndex {
	parentOf: Map<string, string | null>;
	indexOf: Map<string, number>;
	/** Ids that own an "items" run (list nodes). */
	listIds: Set<string>;
	/** Ids that own a "blocks" run (section-like containers). */
	containerIds: Set<string>;
}

function buildStructuralIndex(prompt: PromptDocument): StructuralIndex {
	const index: StructuralIndex = {
		parentOf: new Map(),
		indexOf: new Map(),
		listIds: new Set(),
		containerIds: new Set(),
	};
	const visitBlocks = (
		nodes: readonly PromptBlockNode[],
		parentId: string | null,
	): void => {
		nodes.forEach((node, position) => {
			if (!node.id) return;
			// First write wins — duplicated ids are invalid but must not corrupt
			// an already-recorded chain.
			if (!index.parentOf.has(node.id)) {
				index.parentOf.set(node.id, parentId);
				index.indexOf.set(node.id, position);
			}
			if (isListNode(node)) {
				index.listIds.add(node.id);
				node.items.forEach((item, itemIndex) => {
					if (!item.id || index.parentOf.has(item.id)) return;
					index.parentOf.set(item.id, node.id!);
					index.indexOf.set(item.id, itemIndex);
					visitBlocks(item.children ?? [], item.id);
				});
				return;
			}
			if (isBlockContainer(node)) {
				index.containerIds.add(node.id);
				visitBlocks(childBlocksOf(node), node.id);
			}
		});
	};
	visitBlocks(prompt.nodes, null);
	return index;
}

/** Root-first ancestor chain `[topLevel, …, id]` (the root itself is implicit). */
function chainFromRoot(
	parentOf: ReadonlyMap<string, string | null>,
	id: string,
): string[] {
	const chain: string[] = [];
	const seen = new Set<string>();
	let current: string | null = id;
	while (current !== null && !seen.has(current)) {
		chain.push(current);
		seen.add(current);
		current = parentOf.get(current) ?? null;
	}
	return chain.reverse();
}

/**
 * THE CANONICAL STRUCTURAL-SELECTION RESOLUTION (docs-system will mirror it).
 *
 * Resolves the rows a marquee's VERTICAL band covers to the SHALLOWEST
 * contiguous sibling run that exactly covers them — the "bounding zone
 * becomes one object" rule:
 *
 * - Rows all within ONE list resolve to that run of list items
 *   (kind "items"), the same unit the shift-click item selection names.
 * - Rows crossing a list boundary into a sibling block resolve to the run of
 *   blocks at their COMMON PARENT — the whole list plus the sibling
 *   (kind "blocks"), partially covered units promoting to their whole unit.
 * - Rows sweeping across top-level sections resolve to the run of top-level
 *   blocks (`parentId: null`).
 *
 * Concretely: take every covered row's target (the item for item rows, the
 * owning block otherwise), find the deepest common ancestor of all targets,
 * then climb until the ancestor can own a run (a list, a section-like
 * container, or the document root) and is not itself covered (a section swept
 * together with its children selects at the SECTION's own level). The run is
 * the ancestor's children the band touches; rows render in document order, so
 * the run is contiguous by construction — every sibling between two covered
 * siblings is itself covered.
 *
 * Pure: no DOM, no React. Returns null when the band covers nothing
 * addressable (gap rows only, ids unknown to this document).
 */
export function resolveMarqueeSelection(
	prompt: PromptDocument,
	lines: readonly XmlLine[],
	startRow: number,
	endRow: number,
): StructuralSelection | null {
	if (lines.length === 0) return null;
	const lo = Math.max(0, Math.min(startRow, endRow));
	const hi = Math.min(lines.length - 1, Math.max(startRow, endRow));
	if (lo > hi) return null;

	const covered = new Set<string>();
	for (let row = lo; row <= hi; row += 1) {
		const line = lines[row];
		if (!line || line.role === "gap") continue;
		const target = line.itemId ?? line.nodeId;
		if (target) covered.add(target);
	}
	if (covered.size === 0) return null;

	const index = buildStructuralIndex(prompt);
	const chains: string[][] = [];
	for (const id of covered) {
		// A covered id the document does not know cannot anchor a selection.
		if (!index.parentOf.has(id)) return null;
		chains.push(chainFromRoot(index.parentOf, id));
	}

	// Deepest common ancestor: the longest shared root-first prefix.
	let common: string | null = null;
	for (let depth = 0; ; depth += 1) {
		const candidate = chains[0]?.[depth];
		if (candidate === undefined) break;
		if (!chains.every((chain) => chain[depth] === candidate)) break;
		common = candidate;
	}

	// Climb to the run level: the parent must be able to OWN a run (list /
	// container / root) and must not itself be covered — a covered ancestor is
	// part of the object, so the run forms at ITS sibling level instead.
	let parent: string | null = common;
	while (
		parent !== null &&
		(covered.has(parent) ||
			!(index.listIds.has(parent) || index.containerIds.has(parent)))
	) {
		parent = index.parentOf.get(parent) ?? null;
	}

	// Each covered target names one unit of the run: its ancestor that is a
	// DIRECT child of the run parent.
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;
	for (const chain of chains) {
		const at = parent === null ? 0 : chain.indexOf(parent) + 1;
		const unit = at > 0 || parent === null ? chain[at] : undefined;
		if (unit === undefined) return null;
		const unitIndex = index.indexOf.get(unit);
		if (unitIndex === undefined) return null;
		start = Math.min(start, unitIndex);
		end = Math.max(end, unitIndex);
	}
	if (end < start) return null;

	return {
		parentId: parent,
		kind: parent !== null && index.listIds.has(parent) ? "items" : "blocks",
		start,
		end,
	};
}

/**
 * A resolved selection, materialized against a document: the run's position,
 * every covered unit's id in sibling order, and the parent's total unit count
 * (so callers can ask "does the run cover everything?" — the all-items rule).
 */
export interface StructuralRun {
	parentId: string | null;
	kind: "items" | "blocks";
	fromIndex: number;
	count: number;
	/** Ids of every unit in the run, in sibling order. */
	unitIds: string[];
	/** How many sibling units exist at the run's level. */
	unitTotal: number;
}

/**
 * Materializes `selection` against `prompt`, or null when the document no
 * longer supports it (parent gone, indexes out of range, units without ids).
 * This IS the selection validity check: hosts rebuild the prompt's identity
 * every render, so surfaces must validate-don't-clear — keep the selection
 * while this returns a run, retire it only on null.
 */
export function structuralSelectionRun(
	prompt: PromptDocument,
	selection: StructuralSelection,
): StructuralRun | null {
	const unitIds = runUnitIds(prompt, selection.parentId, selection.kind);
	if (!unitIds) return null;
	if (
		selection.start < 0 ||
		selection.end < selection.start ||
		selection.end >= unitIds.length
	) {
		return null;
	}
	const ids: string[] = [];
	for (let position = selection.start; position <= selection.end; position += 1) {
		const id = unitIds[position];
		if (id === undefined) return null;
		ids.push(id);
	}
	return {
		parentId: selection.parentId,
		kind: selection.kind,
		fromIndex: selection.start,
		count: selection.end - selection.start + 1,
		unitIds: ids,
		unitTotal: unitIds.length,
	};
}

/**
 * The unit-id array at a run level: item ids for a list parent, child block
 * ids for a container parent, top-level block ids for the root. Units missing
 * ids surface as undefined entries; a parent that does not exist (or whose
 * shape contradicts `kind`) yields null.
 */
function runUnitIds(
	prompt: PromptDocument,
	parentId: string | null,
	kind: StructuralSelection["kind"],
): (string | undefined)[] | null {
	if (parentId === null) {
		if (kind !== "blocks") return null;
		return prompt.nodes.map((node) => node.id);
	}
	const parent = findBlockDeep(prompt.nodes, parentId);
	if (!parent) return null;
	if (isListNode(parent)) {
		if (kind !== "items") return null;
		return parent.items.map((item) => item.id);
	}
	if (!isBlockContainer(parent) || kind !== "blocks") return null;
	return childBlocksOf(parent).map((node) => node.id);
}

/** Finds a block by id anywhere, including blocks nested in list items. */
function findBlockDeep(
	nodes: readonly PromptBlockNode[],
	id: string,
): PromptBlockNode | undefined {
	for (const node of nodes) {
		if (node.id === id) return node;
		if (isListNode(node)) {
			for (const item of node.items) {
				const found = findBlockDeep(item.children ?? [], id);
				if (found) return found;
			}
			continue;
		}
		const found = findBlockDeep(childBlocksOf(node), id);
		if (found) return found;
	}
	return undefined;
}

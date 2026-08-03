import type {
	BulletListNode,
	ListItemNode,
	OrderedListNode,
	PromptBlockNode,
	PromptDocument,
	PromptInline,
} from "../../index";
import {
	editableTextToInline,
	ensurePromptNodeIds,
	inlineToEditableText,
	removePromptBlockNodeByIdWithStep,
	updatePromptBlockNodeByIdWithStep,
	type PromptStep,
} from "../editors";

/**
 * List-item operations compose as UPDATE steps on the *containing list node*,
 * routed through `updatePromptBlockNodeByIdWithStep`. That wrapper diffs the
 * whole node before/after and emits a single invertible `update` step keyed by
 * the list's id, so add / remove / nest / un-nest all undo and redo as one
 * logical action and keep flowing through the same transaction log as every
 * other editor mutation.
 *
 * None of these helpers touch the document directly — they hand a pure updater
 * to the step wrapper and return its `{ prompt, step }` result. A caller with a
 * multi-step logical action (e.g. Notion "Enter": commit text + insert item)
 * collects the returned steps and commits them together as one transaction.
 */

type ListNode = BulletListNode | OrderedListNode;

function isListNode(node: PromptBlockNode): node is ListNode {
	return node.type === "bulletList" || node.type === "orderedList";
}

/** Empty inline content for a freshly created item. */
export function emptyInline(): PromptInline[] {
	return [""];
}

/**
 * Joins two inline runs, coalescing the plain text on either side of the seam.
 * Without this a merge would leave `["hello ", "world"]` where typing the same
 * characters yields `["hello world"]` — identical once rendered, but a
 * different canonical document (and so a different hash), which would make
 * split-then-merge a lossy round trip.
 */
export function concatInline(
	a: readonly PromptInline[],
	b: readonly PromptInline[],
): PromptInline[] {
	const result: PromptInline[] = [...a];
	for (const part of b) {
		const last = result[result.length - 1];
		if (typeof last === "string" && typeof part === "string") {
			result[result.length - 1] = last + part;
			continue;
		}
		result.push(part);
	}
	return result;
}

function withItems(node: ListNode, items: ListItemNode[]): ListNode {
	return { ...node, items } as ListNode;
}

export interface ListItemStepResult {
	prompt: PromptDocument;
	step?: PromptStep;
	/** Index the caller should focus after the edit (when meaningful). */
	focusItemIndex?: number;
	/** Caret position (in editable text) the caller should land on. */
	caretOffset?: number;
	/**
	 * List that holds the focused item, when the edit MOVED it into a different
	 * list node than the one addressed (nesting). Absent means "the same list".
	 */
	focusListId?: string;
}

/**
 * Lists nested inside list items are NOT reachable by prompt-kit's id walkers
 * (the editor tree does not descend into item children), so a mutation
 * addressed at a nested list must be expressed as an update of its nearest
 * tree-addressable ancestor list. `resolveListRootId` finds that ancestor
 * (the list itself when it is directly addressable); `updateListByIdWithStep`
 * routes the updater through it. Either way the emitted step is one
 * invertible update on an addressable node, so undo/redo always works.
 */
export function resolveListRootId(
	prompt: PromptDocument,
	listId: string,
): string | undefined {
	const walkBlocks = (
		nodes: readonly PromptBlockNode[],
	): string | undefined => {
		for (const node of nodes) {
			if (isListNode(node)) {
				if (node.id === listId) return listId;
				if (node.id && listContainsNested(node, listId)) return node.id;
				continue;
			}
			if (node.type === "section" || node.type === "example") {
				const found = walkBlocks(node.children);
				if (found) return found;
			} else if (node.type === "field") {
				const found = walkBlocks(node.children ?? []);
				if (found) return found;
			} else if (node.type === "contextUsage") {
				const found = walkBlocks(node.instructions);
				if (found) return found;
			}
		}
		return undefined;
	};
	return walkBlocks(prompt.nodes);
}

function listContainsNested(list: ListNode, listId: string): boolean {
	for (const item of list.items) {
		for (const child of item.children ?? []) {
			if (!isListNode(child)) continue;
			if (child.id === listId || listContainsNested(child, listId)) {
				return true;
			}
		}
	}
	return false;
}

/** Applies `updater` to the (possibly nested) list `listId` within `node`. */
function replaceListDeep(
	node: PromptBlockNode,
	listId: string,
	updater: (list: ListNode) => ListNode,
): PromptBlockNode {
	if (!isListNode(node)) return node;
	if (node.id === listId) return updater(node);
	let changed = false;
	const items = node.items.map((item) => {
		const children = item.children;
		if (!children || children.length === 0) return item;
		let childChanged = false;
		const nextChildren = children.map((child) => {
			const next = replaceListDeep(child, listId, updater);
			if (next !== child) childChanged = true;
			return next;
		});
		if (!childChanged) return item;
		changed = true;
		return { ...item, children: nextChildren };
	});
	return changed ? withItems(node, items) : node;
}

function updateListByIdWithStep(
	prompt: PromptDocument,
	listId: string,
	updater: (list: ListNode) => ListNode,
): { prompt: PromptDocument; step?: PromptStep } {
	const rootId = resolveListRootId(prompt, listId) ?? listId;
	return updatePromptBlockNodeByIdWithStep(prompt, rootId, (node) =>
		replaceListDeep(node, listId, updater),
	);
}

/**
 * Sets the text content of one item. Kept here (rather than inline in the view)
 * so text-commit and the structural ops below share one update path and one
 * inline-parsing rule.
 */
export function setListItemContentStep(
	prompt: PromptDocument,
	listId: string,
	itemIndex: number,
	text: string,
): ListItemStepResult {
	const result = updateListByIdWithStep(prompt, listId, (node) => {
		const items = node.items.map((item, index) =>
			index === itemIndex
				? { ...item, content: editableTextToInline(text) }
				: item,
		);
		return withItems(node, items);
	});
	return { prompt: result.prompt, step: result.step };
}

/**
 * Inserts a new item at `atIndex` (clamped). `content` defaults to a single
 * empty string so the new row is immediately editable. Returns the index of the
 * inserted item so the caller can focus it.
 */
export function insertListItemStep(
	prompt: PromptDocument,
	listId: string,
	atIndex: number,
	content: PromptInline[] = emptyInline(),
): ListItemStepResult {
	let inserted = atIndex;
	const result = updateListByIdWithStep(prompt, listId, (node) => {
		const items = [...node.items];
		inserted = Math.min(Math.max(atIndex, 0), items.length);
		const newItem: ListItemNode = { type: "listItem", content };
		items.splice(inserted, 0, newItem);
		return withItems(node, items);
	});
	return { prompt: result.prompt, step: result.step, focusItemIndex: inserted };
}

/**
 * Removes the item at `itemIndex`. If it was the only item the list node is
 * left empty (`items: []`); callers that want the whole list gone on last-item
 * removal should special-case that before calling. Returns the index of a
 * sensible neighbour to focus (previous item, else the new item at that slot).
 */
export function removeListItemStep(
	prompt: PromptDocument,
	listId: string,
	itemIndex: number,
): ListItemStepResult {
	let focus = itemIndex;
	const result = updateListByIdWithStep(prompt, listId, (node) => {
		const items = node.items.filter((_, index) => index !== itemIndex);
		focus = Math.max(0, Math.min(itemIndex - 1, items.length - 1));
		return withItems(node, items);
	});
	return { prompt: result.prompt, step: result.step, focusItemIndex: focus };
}

/**
 * Removes the CONTIGUOUS run of `count` items starting at `fromIndex` — the
 * structural-selection delete for an item run, as ONE invertible update step
 * on the containing list. Like `removeListItemStep`, removing every item
 * leaves the list node empty; callers wanting the whole list gone on an
 * all-items removal special-case that with `removeListWithStep` first (the
 * same empty-list rule the keymap applies).
 */
export function removeListItemsStep(
	prompt: PromptDocument,
	listId: string,
	fromIndex: number,
	count: number,
): ListItemStepResult {
	let focus = fromIndex;
	const result = updateListByIdWithStep(prompt, listId, (node) => {
		if (count <= 0) return node;
		if (fromIndex < 0 || fromIndex + count > node.items.length) return node;
		const items = [...node.items];
		items.splice(fromIndex, count);
		focus = Math.max(0, Math.min(fromIndex - 1, items.length - 1));
		return withItems(node, items);
	});
	return { prompt: result.prompt, step: result.step, focusItemIndex: focus };
}

/**
 * Moves the item at `fromIndex` to the insertion slot `toSlot`, both in the
 * list's ORIGINAL indexing: slot `k` means "immediately before the item that
 * currently sits at index k", and slot `items.length` means "after the last
 * item". This matches how the drag layer names drop boundaries, so the caller
 * never has to pre-adjust for the removal shifting later indices.
 *
 * The whole reorder is one update to the containing list node — a single
 * invertible step, so a drag-drop undoes in one action exactly like a block
 * move. The item's nested children ride along untouched (items move as whole
 * subtrees), which is what makes a multi-line item drag as a unit.
 */
export function moveListItemStep(
	prompt: PromptDocument,
	listId: string,
	fromIndex: number,
	toSlot: number,
): ListItemStepResult {
	return moveListItemsStep(prompt, listId, fromIndex, 1, toSlot);
}

/**
 * Moves the CONTIGUOUS run of `count` items starting at `fromIndex` to the
 * insertion slot `toSlot`, preserving their order — the group-drag seam.
 * `toSlot` speaks the same "slot in the list's ORIGINAL indexing" language as
 * `moveListItemStep`; a slot strictly inside the moved run (`fromIndex <
 * toSlot < fromIndex + count`) is not a place the group can land, so it is a
 * no-op (the drag layer never offers those slots).
 *
 * Like the single-item move, the whole reorder is one update to the containing
 * list node — a single invertible step, so a six-bullet drag undoes in one
 * action. Each item's nested children ride along untouched.
 */
export function moveListItemsStep(
	prompt: PromptDocument,
	listId: string,
	fromIndex: number,
	count: number,
	toSlot: number,
): ListItemStepResult {
	let focus = fromIndex;
	const result = updateListByIdWithStep(prompt, listId, (node) => {
		if (count <= 0) return node;
		if (fromIndex < 0 || fromIndex + count > node.items.length) return node;
		let insert = Math.max(0, Math.min(toSlot, node.items.length));
		if (insert > fromIndex) {
			// A slot inside the run has no meaning once the run is lifted out.
			if (insert < fromIndex + count) return node;
			// Removing the run first shifts every later slot left by its length.
			insert -= count;
		}
		if (insert === fromIndex) return node;
		const items = [...node.items];
		const moving = items.splice(fromIndex, count);
		items.splice(insert, 0, ...moving);
		focus = insert;
		return withItems(node, items);
	});
	return {
		prompt: result.prompt,
		step: result.step,
		focusItemIndex: focus,
	};
}

/**
 * Nests the item at `itemIndex` under the previous sibling item, moving it into
 * a child list of the *same list type*. If the previous item already has a
 * trailing child list of that type, the item is appended to it; otherwise a new
 * child list is created. The item cannot be nested when it is the first item
 * (no previous sibling) — that returns a no-op result.
 *
 * The whole reparent is expressed as a single update to the containing list
 * node, so it is one invertible step.
 *
 * The item lands in a DIFFERENT list node than the one addressed, so the result
 * names it: `focusListId` + `focusItemIndex` are where the caret has to follow.
 * A freshly created child list has no id yet, so the ids are settled here with
 * the same generator the editor model uses — running it on this document yields
 * exactly the ids the surface is about to render, which is what lets Tab keep
 * the caret in the item instead of dropping the edit.
 */
export function nestListItemStep(
	prompt: PromptDocument,
	listId: string,
	itemIndex: number,
): ListItemStepResult {
	const result = updateListByIdWithStep(prompt, listId, (node) =>
		nestWithin(node, itemIndex),
	);
	if (!result.step) return { prompt: result.prompt };
	const landing = findNestLanding(
		ensurePromptNodeIds(result.prompt),
		listId,
		itemIndex - 1,
	);
	return {
		prompt: result.prompt,
		step: result.step,
		...(landing ?? {}),
	};
}

/**
 * Where a nested item ended up: the LAST list child of the parent item, and its
 * last position in it — exactly the slot `nestWithin` appends to.
 */
function findNestLanding(
	prompt: PromptDocument,
	listId: string,
	parentItemIndex: number,
): { focusListId: string; focusItemIndex: number } | undefined {
	const list = findListDeep(prompt.nodes, listId);
	const parent = list?.items[parentItemIndex];
	if (!parent) return undefined;
	const children = parent.children ?? [];
	for (let index = children.length - 1; index >= 0; index -= 1) {
		const child = children[index];
		if (!child || !isListNode(child) || !child.id) continue;
		return { focusListId: child.id, focusItemIndex: child.items.length - 1 };
	}
	return undefined;
}

/** Finds a list by id anywhere, including lists nested inside list items. */
function findListDeep(
	nodes: readonly PromptBlockNode[],
	listId: string,
): ListNode | undefined {
	for (const node of nodes) {
		if (isListNode(node)) {
			if (node.id === listId) return node;
			for (const item of node.items) {
				const found = findListDeep(item.children ?? [], listId);
				if (found) return found;
			}
			continue;
		}
		if (node.type === "section" || node.type === "example") {
			const found = findListDeep(node.children, listId);
			if (found) return found;
		} else if (node.type === "field") {
			const found = findListDeep(node.children ?? [], listId);
			if (found) return found;
		} else if (node.type === "contextUsage") {
			const found = findListDeep(node.instructions, listId);
			if (found) return found;
		}
	}
	return undefined;
}

/**
 * Splits the item at `itemIndex` at a caret: the item keeps `beforeText` (and
 * its nested children), and a NEW item carrying `afterText` is inserted
 * directly after it. One invertible update step; the caller focuses the new
 * item at caret 0. Enter-at-end degenerates to a clean "add next item".
 */
export function splitListItemStep(
	prompt: PromptDocument,
	listId: string,
	itemIndex: number,
	beforeText: string,
	afterText: string,
): ListItemStepResult {
	const result = updateListByIdWithStep(prompt, listId, (node) => {
		if (itemIndex < 0 || itemIndex >= node.items.length) return node;
		const items = [...node.items];
		const current = items[itemIndex];
		if (!current) return node;
		items[itemIndex] = {
			...current,
			content: editableTextToInline(beforeText),
		};
		items.splice(itemIndex + 1, 0, {
			type: "listItem",
			content: editableTextToInline(afterText),
		});
		return withItems(node, items);
	});
	return {
		prompt: result.prompt,
		step: result.step,
		focusItemIndex: itemIndex + 1,
		caretOffset: 0,
	};
}

/**
 * Merges the item at `itemIndex` into the previous item of the same list:
 * inline content concatenates (structured inline survives), nested children
 * of both items are preserved in order, and the caret lands at the join
 * point (end of the previous item's original text). No-op for the first item.
 */
export function mergeListItemsStep(
	prompt: PromptDocument,
	listId: string,
	itemIndex: number,
): ListItemStepResult {
	let caret = 0;
	const result = updateListByIdWithStep(prompt, listId, (node) => {
		if (itemIndex <= 0 || itemIndex >= node.items.length) return node;
		const items = [...node.items];
		const previous = items[itemIndex - 1];
		const current = items[itemIndex];
		if (!previous || !current) return node;
		caret = inlineToEditableText(previous.content).length;
		const children = [
			...(previous.children ?? []),
			...(current.children ?? []),
		];
		items[itemIndex - 1] = {
			...previous,
			content: concatInline(previous.content, current.content),
			...(children.length > 0 ? { children } : {}),
		};
		items.splice(itemIndex, 1);
		return withItems(node, items);
	});
	return {
		prompt: result.prompt,
		step: result.step,
		focusItemIndex: itemIndex - 1,
		caretOffset: caret,
	};
}

/**
 * Nests item `itemIndex` under its previous sibling within `list` (one level of
 * items). Pure — returns a new list node, or the original when nesting is not
 * possible (first item / out of range).
 */
function nestWithin(list: ListNode, itemIndex: number): ListNode {
	if (itemIndex <= 0 || itemIndex >= list.items.length) return list;
	const items = [...list.items];
	const moving = items[itemIndex];
	const prev = items[itemIndex - 1];
	if (!moving || !prev) return list;

	const childListType = list.type;
	const prevChildren = prev.children ?? [];
	const lastChild = prevChildren[prevChildren.length - 1];

	let nextChildren: PromptBlockNode[];
	if (
		lastChild &&
		(lastChild.type === "bulletList" || lastChild.type === "orderedList") &&
		lastChild.type === childListType
	) {
		// Append to the existing trailing child list of the same kind.
		const merged = {
			...lastChild,
			items: [...lastChild.items, moving],
		} as ListNode;
		nextChildren = [...prevChildren.slice(0, -1), merged];
	} else {
		const childList = { type: childListType, items: [moving] } as ListNode;
		nextChildren = [...prevChildren, childList];
	}

	items[itemIndex - 1] = { ...prev, children: nextChildren };
	items.splice(itemIndex, 1);
	return withItems(list, items);
}

/**
 * Un-nests the item at `childIndex` of the child list embedded in item
 * `parentItemIndex` of `listId`, hoisting it to sit immediately after that
 * parent item in the outer list. The whole two-level reparent is expressed as
 * a single update to the (top-level) list node, so it is one invertible step.
 *
 * `listId` addresses the OUTER list; `parentItemIndex` is the outer item whose
 * `children` hold the nested list; `childIndex` is the position within that
 * nested list. This mirrors how the line model surfaces a nested list: the
 * nested list is a distinct block node, but its logical parent is an item of
 * the outer list, and un-nesting must edit both levels at once.
 */
export function unnestListItemStep(
	prompt: PromptDocument,
	listId: string,
	parentItemIndex: number,
	childIndex: number,
): ListItemStepResult {
	const result = updateListByIdWithStep(prompt, listId, (node) => {
		if (parentItemIndex < 0 || parentItemIndex >= node.items.length) return node;
		const items = [...node.items];
		const parent = items[parentItemIndex];
		if (!parent) return node;

		const children = parent.children ?? [];
		// Un-nesting hoists out of the LAST child list (the one the surface shows
		// directly beneath the parent item).
		const listChildIndex = findLastListChildIndex(children);
		if (listChildIndex < 0) return node;
		const childList = children[listChildIndex] as ListNode;
		if (childIndex < 0 || childIndex >= childList.items.length) return node;

		const nestedItems = [...childList.items];
		const [moving] = nestedItems.splice(childIndex, 1);
		if (!moving) return node;

		// Rebuild the parent's children: shrink (or drop) the child list.
		const nextChildren = [...children];
		if (nestedItems.length === 0) {
			nextChildren.splice(listChildIndex, 1);
		} else {
			nextChildren[listChildIndex] = {
				...childList,
				items: nestedItems,
			} as ListNode;
		}
		items[parentItemIndex] = {
			...parent,
			children: nextChildren.length > 0 ? nextChildren : undefined,
		};
		// Hoist the item to just after its former parent in the outer list.
		items.splice(parentItemIndex + 1, 0, moving);
		return withItems(node, items);
	});
	// The item lands in the OUTER list, one slot past its former parent.
	return {
		prompt: result.prompt,
		step: result.step,
		focusListId: listId,
		focusItemIndex: parentItemIndex + 1,
	};
}

/**
 * Removes a whole list node. Top-level (tree-addressable) lists are removed
 * with a remove step; a NESTED list is removed by updating its addressable
 * ancestor — the nested list is deleted from whichever item's children hold
 * it, and an emptied children array is dropped entirely.
 */
export function removeListWithStep(
	prompt: PromptDocument,
	listId: string,
): { prompt: PromptDocument; step?: PromptStep } {
	const rootId = resolveListRootId(prompt, listId);
	if (!rootId || rootId === listId) {
		// Directly addressable (or unknown — then this is a no-op anyway).
		const result = removePromptBlockNodeByIdWithStep(prompt, listId);
		return { prompt: result.prompt, step: result.step };
	}
	return updatePromptBlockNodeByIdWithStep(prompt, rootId, (node) =>
		removeNestedListDeep(node, listId),
	);
}

function removeNestedListDeep(
	node: PromptBlockNode,
	listId: string,
): PromptBlockNode {
	if (!isListNode(node)) return node;
	let changed = false;
	const items = node.items.map((item) => {
		const children = item.children;
		if (!children || children.length === 0) return item;
		const nextChildren = children
			.filter((child) => !(isListNode(child) && child.id === listId))
			.map((child) => {
				const next = removeNestedListDeep(child, listId);
				return next;
			});
		const removedHere = nextChildren.length !== children.length;
		const rewrittenHere = nextChildren.some(
			(child, index) => child !== children[index],
		);
		if (!removedHere && !rewrittenHere) return item;
		changed = true;
		if (nextChildren.length === 0) {
			const { children: _dropped, ...rest } = item;
			return rest as ListItemNode;
		}
		return { ...item, children: nextChildren };
	});
	return changed ? withItems(node, items) : node;
}

function findLastListChildIndex(children: readonly PromptBlockNode[]): number {
	for (let i = children.length - 1; i >= 0; i--) {
		const child = children[i];
		if (child && (child.type === "bulletList" || child.type === "orderedList")) {
			return i;
		}
	}
	return -1;
}

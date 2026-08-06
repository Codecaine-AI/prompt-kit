// Slice: THE keyboard model for inline editing. One handler serves every
// editor on the surface (items, paragraphs, fields, raw/code), so Enter,
// Backspace, Delete and the arrows behave identically wherever the caret is.
//
// Every structural key resolves through the pure helpers in edit-navigation
// (which caret targets exist, what a boundary Backspace/Delete may safely do)
// and commits through the *WithStep mutation helpers, so each keystroke is one
// invertible transaction and undo/redo covers the whole model.
"use client";

import type { PromptDocument } from "../../../index";
import type {
	PromptEditorTreeEntry,
} from "../model";

import {
	mergeListItemsStep,
	nestListItemStep,
	removeListItemStep,
	removeListWithStep,
	splitListItemStep,
	unnestListItemStep,
} from "../steps/list-item-steps";
import type { PromptFlowChangeHandler } from "../types";
import type { XmlLine } from "../../../document/render/line-model";
import {
	collectEditPoints,
	findEditPointIndex,
	resolveBackspace,
	resolveDeleteForward,
	type EditPoint,
} from "./edit-navigation";
import {
	findUnnestLocation,
	mergeParagraphsSteps,
	removeParagraphSteps,
	splitParagraphSteps,
} from "../steps/node-mutations";
import {
	demoteSectionStep,
	escapeListStep,
	indentParagraphIntoSectionStep,
	outdentParagraphStep,
	promoteSectionStep,
	type StructureStepResult,
} from "../steps/structure-steps";

/**
 * Where the caret lives, as the surface stores it. `caret` accepts a range so a
 * gesture can hand the user a pre-selected word — naming a fresh section's tag
 * is a type-over, not an append.
 */
export type EditCaret = number | "end" | readonly [number, number];

export interface EditTarget {
	nodeId: string;
	itemIndex?: number;
	caret?: EditCaret;
}

export interface EditorKeyContext {
	lines: readonly XmlLine[];
	entriesById: ReadonlyMap<string, PromptEditorTreeEntry>;
	prompt: PromptDocument;
	onPromptChange: PromptFlowChangeHandler;
	/**
	 * Moves the edit target. The surface remounts the editor for every move, so
	 * `caret` is applied exactly once, on mount, with focus already restored.
	 */
	moveEdit: (target: EditTarget) => void;
	/** Leaves editing entirely (row stays selected). */
	endEdit: () => void;
}

/**
 * Continuous-editing keymap:
 *
 *   Enter          on an EMPTY list item, escape the list — a nested item
 *                  outdents one level, a top-level item leaves the list for a
 *                  new paragraph after it. On an EMPTY paragraph that trails a
 *                  section, climb out of the section. On a section's tag line,
 *                  drop into its body. Otherwise split at the caret: text after
 *                  the caret becomes a new sibling below, caret at its start.
 *                  At end-of-text that is a clean "add next". Raw/code keep
 *                  Enter as a literal newline.
 *   Backspace @0   merge into the previous like-kind sibling (caret at the
 *                  join); empty node → delete it and focus the previous row's
 *                  end; no safe merge → still move focus back/up. Never a dead
 *                  keystroke, never a merge across a container boundary.
 *   Delete @end    the mirror: absorb the next like-kind sibling.
 *   ArrowUp/Down   leave the row at its first/last line (or from anywhere in a
 *                  single-line row) and land on the previous/next editable row.
 *   Tab / ⇧Tab     one "change my level" key, whatever the caret is in: nest /
 *                  un-nest a list item, move a paragraph into / out of the
 *                  section beside it, nest / lift a whole section. The caret
 *                  stays in the moved block at the same offset — a level change
 *                  is never a reason to stop typing. Tab is swallowed when
 *                  nothing applies rather than tabbing focus out of the buffer.
 *
 * Every structural gesture commits as ONE transaction, so ⌘Z takes back the
 * whole move. Modifier chords are deliberately untouched so ⌘Z / ⌘⇧Z reach the
 * lab's history handler and native word-motion keeps working in the textarea.
 */
export function handleEditorKey(
	event: React.KeyboardEvent<HTMLTextAreaElement>,
	line: XmlLine,
	context: EditorKeyContext,
): void {
	if (event.metaKey || event.ctrlKey || event.altKey) return;

	const element = event.currentTarget;
	const value = element.value;
	const start = element.selectionStart ?? 0;
	const end = element.selectionEnd ?? start;
	const collapsed = start === end;
	const node = line.node;
	const multiline = node.type === "raw" || node.type === "codeBlock";

	switch (event.key) {
		case "Enter": {
			// Raw / code edit as one multi-line value: Enter stays literal.
			if (multiline || event.shiftKey) return;
			event.preventDefault();
			// Structure first: an empty row asking to leave its container beats
			// splitting it into two empty rows.
			if (applyStructuralEnter(line, context, value)) return;
			splitAtCaret(line, context, value.slice(0, start), value.slice(end));
			return;
		}
		case "Backspace": {
			if (!collapsed || start !== 0) return;
			// At caret 0 the browser's own Backspace is a no-op, so preventing it
			// costs nothing even when no resolution applies.
			event.preventDefault();
			applyBackspace(line, context, value);
			return;
		}
		case "Delete": {
			if (!collapsed || end !== value.length) return;
			event.preventDefault();
			applyDeleteForward(line, context);
			return;
		}
		case "ArrowUp":
		case "ArrowDown": {
			if (event.shiftKey || !collapsed) return;
			const up = event.key === "ArrowUp";
			const atEdge = up ? start === 0 : end === value.length;
			// A row that renders as a single visual line has no "inner" vertical
			// motion, so the arrow should always step rows — pressing Up from the
			// middle of a short item must not first park the caret at 0.
			if (!atEdge && !(!multiline && isSingleVisualLine(element))) return;
			const points = collectEditPoints(context.lines);
			const index = currentPointIndex(points, line);
			if (index < 0) return;
			const target = points[up ? index - 1 : index + 1];
			if (!target) return;
			event.preventDefault();
			context.moveEdit(pointTarget(target, up ? "end" : 0));
			return;
		}
		case "Tab": {
			// Tab is the level key on this surface, never a focus key: swallow it
			// even where no move applies so the caret can't be tabbed out of the
			// buffer mid-sentence.
			event.preventDefault();
			applyTab(line, context, event.shiftKey, start);
			return;
		}
		default:
			return;
	}
}

function currentPointIndex(
	points: readonly EditPoint[],
	line: XmlLine,
): number {
	return findEditPointIndex(points, {
		nodeId: line.nodeId,
		itemIndex: line.itemIndex,
	});
}

function pointTarget(point: EditPoint, caret: number | "end"): EditTarget {
	return { nodeId: point.nodeId, itemIndex: point.itemIndex, caret };
}

/** True when the textarea currently occupies one line of its own metrics. */
function isSingleVisualLine(element: HTMLTextAreaElement): boolean {
	const lineHeight = Number.parseFloat(
		getComputedStyle(element).lineHeight,
	);
	if (!Number.isFinite(lineHeight) || lineHeight <= 0) return false;
	return element.scrollHeight <= lineHeight * 1.5;
}

function splitAtCaret(
	line: XmlLine,
	context: EditorKeyContext,
	before: string,
	after: string,
): void {
	const { prompt, onPromptChange, moveEdit } = context;

	if (line.role === "item") {
		const itemIndex = line.itemIndex ?? 0;
		const result = splitListItemStep(
			prompt,
			line.nodeId,
			itemIndex,
			before,
			after,
		);
		if (!result.step) return;
		onPromptChange(result.prompt, line.nodeId, [result.step]);
		// A split whose item carries a nested list lands the new item in a
		// DIFFERENT list node (the first child list) — the result names it, and
		// the caret must follow it there (landOnItem's exact contract).
		moveEdit({
			nodeId: result.focusListId ?? line.nodeId,
			itemIndex: result.focusItemIndex ?? itemIndex + 1,
			caret: result.caretOffset ?? 0,
		});
		return;
	}

	if (line.node.type === "paragraph") {
		const result = splitParagraphSteps(prompt, line.nodeId, before, after);
		if (result.steps.length === 0 || !result.focusNodeId) return;
		onPromptChange(result.prompt, result.focusNodeId, result.steps);
		moveEdit({
			nodeId: result.focusNodeId,
			caret: result.caretOffset ?? 0,
		});
		return;
	}

	// Single-line leaves (a field's value) have no sibling to split into:
	// Enter just leaves the editor, with the row still selected.
	context.endEdit();
}

function applyBackspace(
	line: XmlLine,
	context: EditorKeyContext,
	value: string,
): void {
	const { lines, entriesById, prompt, onPromptChange, moveEdit } = context;
	const points = collectEditPoints(lines);
	const index = currentPointIndex(points, line);
	if (index < 0) return;

	const resolution = resolveBackspace(lines, points, index, {
		valueIsEmpty: value.length === 0,
		entriesById,
	});

	switch (resolution.kind) {
		case "none":
			return;

		case "focus-previous":
			moveEdit(pointTarget(resolution.previous, "end"));
			return;

		case "merge-items": {
			const result = mergeListItemsStep(
				prompt,
				resolution.listId,
				resolution.itemIndex,
			);
			if (!result.step) {
				moveEdit(pointTarget(resolution.previous, "end"));
				return;
			}
			onPromptChange(result.prompt, resolution.listId, [result.step]);
			moveEdit({
				nodeId: resolution.listId,
				itemIndex: result.focusItemIndex ?? resolution.itemIndex - 1,
				caret: result.caretOffset ?? "end",
			});
			return;
		}

		case "merge-paragraphs": {
			const result = mergeParagraphsSteps(
				prompt,
				resolution.previousId,
				resolution.currentId,
			);
			if (result.steps.length === 0) {
				moveEdit(pointTarget(resolution.previous, "end"));
				return;
			}
			onPromptChange(result.prompt, resolution.previousId, result.steps);
			moveEdit({
				nodeId: resolution.previousId,
				caret: result.caretOffset ?? "end",
			});
			return;
		}

		case "remove-empty-item": {
			if (resolution.removesWholeList) {
				const removed = removeListWithStep(prompt, resolution.listId);
				if (!removed.step) return;
				onPromptChange(removed.prompt, resolution.previous?.nodeId, [
					removed.step,
				]);
			} else {
				const result = removeListItemStep(
					prompt,
					resolution.listId,
					resolution.itemIndex,
				);
				if (!result.step) return;
				onPromptChange(result.prompt, resolution.listId, [result.step]);
			}
			landAfterRemoval(context, resolution.previous);
			return;
		}

		case "remove-empty-paragraph": {
			const result = removeParagraphSteps(prompt, resolution.nodeId);
			if (result.steps.length === 0) return;
			onPromptChange(
				result.prompt,
				resolution.previous?.nodeId,
				result.steps,
			);
			landAfterRemoval(context, resolution.previous);
			return;
		}
	}
}

function landAfterRemoval(
	context: EditorKeyContext,
	previous: EditPoint | undefined,
): void {
	if (previous) context.moveEdit(pointTarget(previous, "end"));
	else context.endEdit();
}

function applyDeleteForward(line: XmlLine, context: EditorKeyContext): void {
	const { lines, entriesById, prompt, onPromptChange, moveEdit } = context;
	const points = collectEditPoints(lines);
	const index = currentPointIndex(points, line);
	if (index < 0) return;

	const resolution = resolveDeleteForward(lines, points, index, entriesById);

	switch (resolution.kind) {
		case "none":
			return;

		case "merge-items": {
			const result = mergeListItemsStep(
				prompt,
				resolution.listId,
				resolution.nextItemIndex,
			);
			if (!result.step) return;
			onPromptChange(result.prompt, resolution.listId, [result.step]);
			moveEdit({
				nodeId: resolution.listId,
				itemIndex: result.focusItemIndex ?? resolution.nextItemIndex - 1,
				caret: result.caretOffset ?? "end",
			});
			return;
		}

		case "merge-paragraphs": {
			const result = mergeParagraphsSteps(
				prompt,
				resolution.previousId,
				resolution.currentId,
			);
			if (result.steps.length === 0) return;
			onPromptChange(result.prompt, resolution.previousId, result.steps);
			moveEdit({
				nodeId: resolution.previousId,
				caret: result.caretOffset ?? "end",
			});
			return;
		}
	}
}

/**
 * Enter's structural half: the gestures that change a row's container instead
 * of splitting it. Each pure step producer declines (returns null) when it does
 * not apply, and this returns false so Enter falls through to a plain split.
 */
function applyStructuralEnter(
	line: XmlLine,
	context: EditorKeyContext,
	value: string,
): boolean {
	const { prompt } = context;

	// A section's tag line has no text to split — Enter means "now write inside
	// it", so the caret drops to the section's first editable row.
	if (line.node.type === "section" && line.role === "open") {
		return enterSectionBody(line, context);
	}

	// Only an EMPTY row escapes its container; an item or paragraph with text
	// splits, which is what the same keystroke means everywhere else.
	if (value.length > 0) return false;

	if (line.role === "item") {
		// The TEXTAREA is the emptiness authority here: it can be a keystroke
		// ahead of the committed document (a just-emptied row), and re-deriving
		// emptiness from the document would make this decline and fall through
		// to splitting an "empty" item instead of outdenting.
		return commitStructure(
			context,
			escapeListStep(prompt, line.nodeId, line.itemIndex ?? 0, true),
		);
	}

	if (line.node.type === "paragraph" && isLastChild(context, line.nodeId)) {
		return commitStructure(
			context,
			outdentParagraphStep(prompt, line.nodeId, 0),
		);
	}

	return false;
}

/** Moves the caret from a section's tag line into the section's body. */
function enterSectionBody(line: XmlLine, context: EditorKeyContext): boolean {
	const { lines, moveEdit } = context;
	const row = lines.findIndex((candidate) => candidate === line);
	if (row < 0) return false;
	const points = collectEditPoints(lines);
	// The first edit point below the tag line is the section's first editable
	// row (its own child, since children render before the close tag).
	const target = points.find((point) => point.row > row);
	if (!target) return false;
	moveEdit(pointTarget(target, "end"));
	return true;
}

/**
 * Tab / Shift+Tab: ONE level key over every row kind.
 *
 *   list item   nest under the previous item / hoist back out
 *   paragraph   move into the section just above it / climb out of its section
 *   section     nest under the previous section / lift out of its parent
 *
 * The caret follows the block at the same offset. Nesting moves an item into a
 * different list node, so the step result names the list it landed in — without
 * that the caret would point at a list the item no longer belongs to.
 */
function applyTab(
	line: XmlLine,
	context: EditorKeyContext,
	unnest: boolean,
	caret: number,
): void {
	const { prompt, onPromptChange } = context;

	if (line.role === "item") {
		const listId = line.nodeId;
		const itemIndex = line.itemIndex ?? 0;
		if (unnest) {
			const location = findUnnestLocation(prompt, listId, itemIndex);
			if (!location) return;
			const result = unnestListItemStep(
				prompt,
				location.outerListId,
				location.parentItemIndex,
				itemIndex,
				listId,
			);
			if (!result.step) return;
			onPromptChange(result.prompt, location.outerListId, [result.step]);
			landOnItem(context, result, location.outerListId, caret);
			return;
		}
		if (itemIndex <= 0) return;
		const result = nestListItemStep(prompt, listId, itemIndex);
		if (!result.step) return;
		onPromptChange(result.prompt, listId, [result.step]);
		landOnItem(context, result, listId, caret);
		return;
	}

	if (line.node.type === "paragraph") {
		commitStructure(
			context,
			unnest
				? outdentParagraphStep(prompt, line.nodeId, caret)
				: indentParagraphIntoSectionStep(prompt, line.nodeId, caret),
		);
		return;
	}

	if (line.node.type === "section") {
		commitStructure(
			context,
			unnest
				? promoteSectionStep(prompt, line.nodeId)
				: demoteSectionStep(prompt, line.nodeId),
			caret,
		);
	}
}

/**
 * Puts the caret back in an item that a nest / un-nest just moved. A result
 * that cannot say where the item landed ends the edit rather than pointing the
 * caret at a stale slot.
 */
function landOnItem(
	context: EditorKeyContext,
	result: { focusListId?: string; focusItemIndex?: number },
	fallbackListId: string,
	caret: number,
): void {
	const nodeId = result.focusListId ?? fallbackListId;
	if (result.focusItemIndex === undefined) {
		context.endEdit();
		return;
	}
	context.moveEdit({ nodeId, itemIndex: result.focusItemIndex, caret });
}

/**
 * Commits a structural gesture and follows it with the caret. Returns false for
 * a gesture that declined, so callers can fall through to their default.
 */
function commitStructure(
	context: EditorKeyContext,
	result: StructureStepResult | null,
	fallbackCaret: number = 0,
): boolean {
	if (!result || result.steps.length === 0) return false;
	context.onPromptChange(result.prompt, result.focusNodeId, result.steps);
	if (result.focusNodeId) {
		context.moveEdit({
			nodeId: result.focusNodeId,
			itemIndex: result.focusItemIndex,
			caret: result.caretOffset ?? fallbackCaret,
		});
	}
	return true;
}

/** True when the block is the LAST child of its container. */
function isLastChild(context: EditorKeyContext, nodeId: string): boolean {
	const entry = context.entriesById.get(nodeId);
	if (!entry) return false;
	return entry.index === entry.siblingCount - 1;
}

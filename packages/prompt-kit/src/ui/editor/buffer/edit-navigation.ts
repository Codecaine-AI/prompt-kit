// Slice: pure keyboard-model helpers — the ordered list of editable caret
// targets and the structural resolutions for Backspace / Delete at a node
// boundary. No DOM, no React: everything here is unit-testable directly.
import type {
	PromptEditorTreeEntry,
} from "../model";

import type { XmlLine } from "../../../document/render/line-model";

/**
 * One place the caret can live. Items get one point per item line; multi-line
 * leaf nodes (raw / code) get a single point anchored on their first content
 * line because they edit as one textarea.
 */
export interface EditPoint {
	row: number;
	nodeId: string;
	itemIndex?: number;
}

/** Ordered editable caret targets, top to bottom of the buffer. */
export function collectEditPoints(lines: readonly XmlLine[]): EditPoint[] {
	const points: EditPoint[] = [];
	lines.forEach((line, row) => {
		if (!line.editable) return;
		if (line.contentLineIndex !== undefined && line.contentLineIndex !== 0) {
			return;
		}
		points.push({ row, nodeId: line.nodeId, itemIndex: line.itemIndex });
	});
	return points;
}

export function findEditPointIndex(
	points: readonly EditPoint[],
	target: { nodeId: string; itemIndex?: number },
): number {
	return points.findIndex(
		(point) =>
			point.nodeId === target.nodeId && point.itemIndex === target.itemIndex,
	);
}

/** Backspace removes a list level or joins text across a sibling boundary. */
export type BackspaceResolution =
	| { kind: "none" }
	| { kind: "focus-previous"; previous: EditPoint }
	| { kind: "unlist-item"; listId: string; itemIndex: number }
	| { kind: "merge-paragraph-into-list"; listId: string; itemIndex: number; currentId: string }
	| { kind: "merge-paragraphs"; previousId: string; currentId: string; previous: EditPoint }
	| { kind: "remove-empty-paragraph"; nodeId: string; previous?: EditPoint };

export function resolveBackspace(
	lines: readonly XmlLine[],
	points: readonly EditPoint[],
	pointIndex: number,
	options: {
		valueIsEmpty: boolean;
		entriesById: ReadonlyMap<string, PromptEditorTreeEntry>;
	},
): BackspaceResolution {
	const point = points[pointIndex];
	if (!point) return { kind: "none" };
	const line = lines[point.row];
	if (!line) return { kind: "none" };
	const previous = points[pointIndex - 1];
	const node = line.node;

	if (line.role === "item") {
		if (node.type !== "bulletList" && node.type !== "orderedList") {
			return { kind: "none" };
		}
		return { kind: "unlist-item", listId: point.nodeId, itemIndex: point.itemIndex ?? 0 };
	}

	if (node.type === "paragraph") {
		const previousLine = previous ? lines[previous.row] : undefined;
		const previousEntry = previous ? options.entriesById.get(previous.nodeId) : undefined;
		const currentEntry = options.entriesById.get(point.nodeId);
		if (previous && previousLine?.role === "item" && previousEntry && currentEntry &&
			previousEntry.index + 1 === currentEntry.index &&
			samePath(previousEntry.parentPath, currentEntry.parentPath)) {
			return { kind: "merge-paragraph-into-list", listId: previous.nodeId,
				itemIndex: previous.itemIndex ?? 0, currentId: point.nodeId };
		}
		if (options.valueIsEmpty) {
			return {
				kind: "remove-empty-paragraph",
				nodeId: point.nodeId,
				previous,
			};
		}
		if (
			previous &&
			isSiblingParagraph(lines, options.entriesById, previous, point)
		) {
			return {
				kind: "merge-paragraphs",
				previousId: previous.nodeId,
				currentId: point.nodeId,
				previous,
			};
		}
		return previous
			? { kind: "focus-previous", previous }
			: { kind: "none" };
	}

	// Fields / raw / code never merge — caret movement only.
	return previous ? { kind: "focus-previous", previous } : { kind: "none" };
}

/** What forward-Delete at end-of-value should do (mirror of Backspace merges). */
export type DeleteResolution =
	| { kind: "none" }
	| { kind: "merge-items"; listId: string; nextItemIndex: number }
	| { kind: "merge-paragraphs"; previousId: string; currentId: string };

export function resolveDeleteForward(
	lines: readonly XmlLine[],
	points: readonly EditPoint[],
	pointIndex: number,
	entriesById: ReadonlyMap<string, PromptEditorTreeEntry>,
): DeleteResolution {
	const point = points[pointIndex];
	const next = points[pointIndex + 1];
	if (!point || !next) return { kind: "none" };
	const line = lines[point.row];
	if (!line) return { kind: "none" };

	if (line.role === "item" && next.nodeId === point.nodeId) {
		return {
			kind: "merge-items",
			listId: point.nodeId,
			nextItemIndex: next.itemIndex ?? 0,
		};
	}
	if (
		line.node.type === "paragraph" &&
		isSiblingParagraph(lines, entriesById, point, next)
	) {
		return {
			kind: "merge-paragraphs",
			previousId: point.nodeId,
			currentId: next.nodeId,
		};
	}
	return { kind: "none" };
}

/**
 * True when `a` (above) and `b` (below) are BOTH paragraphs sharing the same
 * parent container — the only case where paragraph merging is safe.
 */
function isSiblingParagraph(
	lines: readonly XmlLine[],
	entriesById: ReadonlyMap<string, PromptEditorTreeEntry>,
	a: EditPoint,
	b: EditPoint,
): boolean {
	const lineA = lines[a.row];
	const lineB = lines[b.row];
	if (!lineA || !lineB) return false;
	if (lineA.node.type !== "paragraph" || lineB.node.type !== "paragraph") {
		return false;
	}
	const entryA = entriesById.get(a.nodeId);
	const entryB = entriesById.get(b.nodeId);
	if (!entryA || !entryB) return false;
	return samePath(entryA.parentPath, entryB.parentPath);
}

function samePath(
	a: readonly (string | number)[],
	b: readonly (string | number)[],
): boolean {
	return a.length === b.length && a.every((part, index) => part === b[index]);
}

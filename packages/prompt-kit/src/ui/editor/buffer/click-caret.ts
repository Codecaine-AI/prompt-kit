// Slice: click-point → caret-offset mapping for entering edit mode at the
// clicked character instead of position 0. DOM-only; kept out of the pure
// keyboard-model module.
"use client";

import type { XmlLine } from "../../../document/render/line-model";

/**
 * Plain-text offset of a click within `container` (which may contain nested
 * highlight spans). Returns undefined when the point does not resolve to a
 * text position — callers fall back to caret-at-end.
 */
export function caretOffsetFromPoint(
	container: HTMLElement,
	clientX: number,
	clientY: number,
): number | undefined {
	const doc = container.ownerDocument;
	let node: Node | null = null;
	let offset = 0;

	const withCaretRange = doc as Document & {
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
		caretPositionFromPoint?: (
			x: number,
			y: number,
		) => { offsetNode: Node; offset: number } | null;
	};
	if (typeof withCaretRange.caretRangeFromPoint === "function") {
		const range = withCaretRange.caretRangeFromPoint(clientX, clientY);
		if (range) {
			node = range.startContainer;
			offset = range.startOffset;
		}
	} else if (typeof withCaretRange.caretPositionFromPoint === "function") {
		const position = withCaretRange.caretPositionFromPoint(clientX, clientY);
		if (position) {
			node = position.offsetNode;
			offset = position.offset;
		}
	}
	if (!node || !container.contains(node)) return undefined;
	if (node.nodeType !== Node.TEXT_NODE) return undefined;

	const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let total = 0;
	for (
		let current = walker.nextNode();
		current;
		current = walker.nextNode()
	) {
		if (current === node) return total + offset;
		total += current.textContent?.length ?? 0;
	}
	return undefined;
}

/**
 * Leading characters of `line.text` that the renderer emits as indentation.
 * This is the default display prefix for a row that renders its whole line.
 */
export function lineIndentLength(line: XmlLine): number {
	return line.text.match(/^ */)?.[0].length ?? 0;
}

/**
 * Maps a display-text offset on `line` to a caret offset in the node's
 * EDITABLE value.
 *
 * `displayPrefix` is how many leading characters the clicked container renders
 * that are NOT part of that value: a plain row renders the line's indent, a
 * list-item row renders only the item's content (its marker is a separate,
 * non-editable span), so the prefix is 0 there.
 *
 * Raw / code nodes edit as one multi-line textarea, so a click on content line
 * k lands after the preceding k lines of the value. The mapping is an
 * approximation when rendered text and editable text diverge (escapes), so the
 * editor clamps on mount — a caret near the click always beats caret-at-zero.
 */
export function caretForLineClick(
	line: XmlLine,
	displayOffset: number,
	displayPrefix: number,
): number {
	const local = Math.max(0, displayOffset - displayPrefix);
	const node = line.node;
	if (node.type === "raw" || node.type === "codeBlock") {
		const content = node.type === "raw" ? node.value : node.code;
		const contentLines = content.split("\n");
		const lineIndex = line.contentLineIndex ?? 0;
		let base = 0;
		for (let index = 0; index < lineIndex; index += 1) {
			base += (contentLines[index]?.length ?? 0) + 1;
		}
		return base + Math.min(local, contentLines[lineIndex]?.length ?? 0);
	}
	return local;
}

/**
 * ONE click → ONE caret, shared by every editable row: paragraphs, fields,
 * raw / code lines and list items all resolve a click through this function, so
 * there is a single definition of "start editing where I clicked". A point that
 * resolves to no text position falls back to caret-at-end (clicking past the
 * end of a line), never to caret-at-zero.
 */
export function caretForRowClick(
	line: XmlLine,
	container: HTMLElement,
	clientX: number,
	clientY: number,
	displayPrefix: number,
): number | "end" {
	const offset = caretOffsetFromPoint(container, clientX, clientY);
	if (offset === undefined) return "end";
	return caretForLineClick(line, offset, displayPrefix);
}

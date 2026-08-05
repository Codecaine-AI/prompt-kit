// Slice: where the caret is on screen. DOM-only, kept out of the pure modules.
"use client";

import type { SlashMenuAnchor } from "./SlashMenu";

/**
 * Viewport box of the caret in a monospace textarea.
 *
 * Every editor on this surface is one monospace line with no padding, so the
 * caret's x is simply "how many characters precede it" — no mirror element, no
 * second layout pass. The menu it anchors only ever opens on a line the user
 * just emptied, so a single-line assumption is the whole story.
 */
export function caretAnchor(
	element: HTMLTextAreaElement,
	column: number,
): SlashMenuAnchor {
	const rect = element.getBoundingClientRect();
	const style = getComputedStyle(element);
	const advance = characterAdvance(style);
	const lineHeight = Number.parseFloat(style.lineHeight);
	const height = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : rect.height;
	return {
		top: rect.top,
		left: rect.left + column * advance,
		bottom: rect.top + height,
		height,
	};
}

/** Width of one character, including the surface's tracking. */
function characterAdvance(style: CSSStyleDeclaration): number {
	const font = style.font || `${style.fontSize} ${style.fontFamily}`;
	const spacing = Number.parseFloat(style.letterSpacing);
	const tracking = Number.isFinite(spacing) ? spacing : 0;
	return measureCharacter(font) + tracking;
}

let measureContext: CanvasRenderingContext2D | null | undefined;
const advanceByFont = new Map<string, number>();

/**
 * Advance width of "0" in `font`, memoized per font string. A 2D canvas is the
 * cheapest text metric available and needs nothing in the document.
 */
function measureCharacter(font: string): number {
	const cached = advanceByFont.get(font);
	if (cached !== undefined) return cached;
	measureContext ??= document.createElement("canvas").getContext("2d");
	if (!measureContext) return FALLBACK_ADVANCE;
	measureContext.font = font;
	const width = measureContext.measureText("0").width || FALLBACK_ADVANCE;
	advanceByFont.set(font, width);
	return width;
}

/** Roughly one character of the 13px default; only used when canvas is absent. */
const FALLBACK_ADVANCE = 7.8;

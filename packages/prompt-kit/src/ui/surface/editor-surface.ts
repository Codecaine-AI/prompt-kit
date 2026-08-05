import type { CSSProperties } from "react";

/**
 * Shared presentation contract for every XML-shaped prompt surface.
 *
 * A host may set any `--prompt-editor-*` property on this element or one of
 * its ancestors. Compatibility `--editor-*` tokens and literal fallbacks keep
 * viewer-ui useful without the prompt style rail.
 */
export const PROMPT_EDITOR_ROOT_CLASS = "prompt-editor-surface";

/** Compatibility numeric defaults for direct consumers. */
export const EDITOR_FONT_PX = 13;
export const LINE_HEIGHT_PX = 22;

const MONO_FONT_FALLBACK =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

/**
 * Gutter width when line numbers are off — the surface's default. The prompt
 * flow renders a structured document, not source code: node ids, targeting
 * rings, and quoted ranges are the address system, so the left edge keeps only
 * what the block affordances need — the 28px grip/menu hit area plus clearance
 * from the body text. Hosts that enable line numbers (the one legitimate use:
 * correlating with the Raw view line-for-line) widen the gutter via
 * `--prompt-editor-gutter-width`.
 */
export const PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH = "36px";

/** Runtime type/layout metrics. Values are CSS expressions, not frozen pixels. */
export const EDITOR_METRICS = {
	fontFamily: `var(--prompt-editor-font-family, ${MONO_FONT_FALLBACK})`,
	fontSize: `var(--prompt-editor-font-size, ${EDITOR_FONT_PX}px)`,
	lineHeight: `var(--prompt-editor-line-height, ${LINE_HEIGHT_PX}px)`,
	letterSpacing: "var(--prompt-editor-letter-spacing, 0em)",
	indentWidth: "var(--prompt-editor-indent-width, 2ch)",
	contentWidth: "var(--prompt-editor-content-width, 136ch)",
	gutterWidth: `var(--prompt-editor-gutter-width, ${PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH})`,
	gripSize: "var(--prompt-editor-grip-size, 20px)",
	/**
	 * Glyph size of the per-ITEM drag handle — deliberately smaller than the
	 * block grip so the affordance hierarchy reads at a glance: big grip in the
	 * gutter moves the block, small grip at the marker moves that item.
	 */
	itemGripSize: "var(--prompt-editor-item-grip-size, 14px)",
	dropLineWidth: "var(--prompt-editor-drop-line-width, 2px)",
	landmarkFontScale: "var(--prompt-editor-landmark-font-scale, 1.08)",
	landmarkPad: "var(--prompt-editor-landmark-pad, 8px)",
	gapHeightBase: `var(--prompt-editor-gap-height-base, var(--prompt-editor-line-height, ${LINE_HEIGHT_PX}px))`,
	gapHeightSub: `var(--prompt-editor-gap-height-sub, calc(var(--prompt-editor-line-height, ${LINE_HEIGHT_PX}px) + 32px))`,
	gapHeightTop: `var(--prompt-editor-gap-height-top, calc(var(--prompt-editor-line-height, ${LINE_HEIGHT_PX}px) + 64px))`,
} as const;

/** Editor-surface palette with compatibility host tokens and literal fallbacks. */
export const EDITOR_COLORS = {
	bg: "var(--prompt-editor-bg, var(--editor-bg, #1E1E1E))",
	fg: "var(--prompt-editor-fg, var(--editor-fg, #E4E4E2))",
	lineNumber:
		"var(--prompt-editor-line-number, var(--editor-line-number, #5F6672))",
	lineNumberActive:
		"var(--prompt-editor-line-number-active, var(--editor-line-number-active, #C6CCD2))",
	gutterBg:
		"var(--prompt-editor-gutter-bg, var(--editor-gutter-bg, #1E1E1E))",
	rule:
		"var(--prompt-editor-rule, var(--editor-rule, rgb(255 255 255 / 0.025)))",
	guide:
		"var(--prompt-editor-guide, var(--editor-guide, rgb(255 255 255 / 0.10)))",
	landmark:
		"var(--prompt-editor-landmark, var(--editor-landmark, rgb(255 255 255 / 0.06)))",
	syntaxPunctuation:
		"var(--prompt-editor-syntax-punctuation, #6E7681)",
	syntaxTag: "var(--prompt-editor-syntax-tag, #B48EC7)",
	syntaxTagLandmark:
		"var(--prompt-editor-syntax-tag-landmark, #BC9AD3)",
	syntaxTagSublandmark:
		"var(--prompt-editor-syntax-tag-sublandmark, #A992BE)",
	inlineCode: "var(--prompt-editor-inline-code, #5FBCA5)",
	inlineChipBg:
		"var(--prompt-editor-inline-chip-bg, rgb(95 188 165 / 0.08))",
	syntaxAttribute:
		"var(--prompt-editor-syntax-attribute, #85AECB)",
	syntaxValue: "var(--prompt-editor-syntax-value, #C09A78)",
	syntaxVariable: "var(--prompt-editor-syntax-variable, #D9C578)",
	syntaxReference: "var(--prompt-editor-syntax-reference, #5FBCA5)",
	syntaxListMarker:
		"var(--prompt-editor-syntax-list-marker, var(--editor-line-number, #7E8590))",
	hoverBg: "var(--prompt-editor-hover-bg, rgb(255 255 255 / 0.05))",
	selectionBg:
		"var(--prompt-editor-selection-bg, rgb(61 123 191 / 0.16))",
	selectionAccent:
		"var(--prompt-editor-selection-accent, #4D9DE0)",
	activeLineBg:
		"var(--prompt-editor-active-line-bg, rgb(255 255 255 / 0.035))",
	grip: "var(--prompt-editor-grip-color, #8A919C)",
	dropLine: "var(--prompt-editor-drop-line-color, #4D9DE0)",
	/** Inline staged-diff rows (git-diff palette on the VS Code Dark+ family). */
	diffDelBg: "var(--prompt-editor-diff-del-bg, rgb(248 81 73 / 0.13))",
	diffDelFg: "var(--prompt-editor-diff-del-fg, #F85149)",
	diffAddBg: "var(--prompt-editor-diff-add-bg, rgb(63 185 80 / 0.13))",
	diffAddFg: "var(--prompt-editor-diff-add-fg, #3FB950)",
	/** Waiting-on-human inline thread bars. */
	threadAccent: "var(--prompt-editor-thread-accent, #D29922)",
} as const;

/** Base type metrics applied to editable and read-only line containers. */
export const editorTypeStyle: CSSProperties = {
	fontFamily: EDITOR_METRICS.fontFamily,
	fontSize: EDITOR_METRICS.fontSize,
	lineHeight: EDITOR_METRICS.lineHeight,
	letterSpacing: EDITOR_METRICS.letterSpacing,
};

/** Resolve a host-controlled gutter width while retaining a content-aware fallback. */
export function promptEditorGutterWidth(fallback: string): string {
	return `var(--prompt-editor-gutter-width, ${fallback})`;
}

/**
 * Visual width for a renderer indentation prefix. Prompt-kit emits two spaces
 * per level. Repeating the variable avoids relying on unsupported CSS
 * length-by-number multiplication and also handles an odd trailing space.
 */
export function promptEditorIndentForSpaces(spaceCount: number): string {
	if (spaceCount <= 0) return "0px";
	const levels = Math.floor(spaceCount / 2);
	const terms: string[] = Array.from(
		{ length: levels },
		() => EDITOR_METRICS.indentWidth,
	);
	if (spaceCount % 2 === 1) terms.push("1ch");
	return terms.length === 1 ? terms[0] : `calc(${terms.join(" + ")})`;
}

/** Visual width for a known prompt nesting depth. */
export function promptEditorIndentForDepth(depth: number): string {
	if (depth <= 0) return "0px";
	const terms: string[] = Array.from(
		{ length: depth },
		() => EDITOR_METRICS.indentWidth,
	);
	return terms.length === 1 ? terms[0] : `calc(${terms.join(" + ")})`;
}

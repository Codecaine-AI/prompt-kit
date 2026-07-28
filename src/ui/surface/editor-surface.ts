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

/** Runtime type/layout metrics. Values are CSS expressions, not frozen pixels. */
export const EDITOR_METRICS = {
	fontFamily: `var(--prompt-editor-font-family, ${MONO_FONT_FALLBACK})`,
	fontSize: `var(--prompt-editor-font-size, ${EDITOR_FONT_PX}px)`,
	lineHeight: `var(--prompt-editor-line-height, ${LINE_HEIGHT_PX}px)`,
	letterSpacing: "var(--prompt-editor-letter-spacing, 0em)",
	indentWidth: "var(--prompt-editor-indent-width, 2ch)",
	contentWidth: "var(--prompt-editor-content-width, 136ch)",
	gutterWidth: "var(--prompt-editor-gutter-width, 5ch)",
	gripSize: "var(--prompt-editor-grip-size, 14px)",
	dropLineWidth: "var(--prompt-editor-drop-line-width, 2px)",
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
} as const;

/** Base type metrics applied to editable and read-only line containers. */
export const editorTypeStyle: CSSProperties = {
	fontFamily: EDITOR_METRICS.fontFamily,
	fontSize: EDITOR_METRICS.fontSize,
	lineHeight: EDITOR_METRICS.lineHeight,
	letterSpacing: EDITOR_METRICS.letterSpacing,
};

/**
 * Ruled-paper background: one zero-layout-cost hairline per runtime line row.
 * The numeric visibility token lets the rail hide rules without changing row
 * geometry or the rendered prompt text.
 */
export const editorRuleBackground: CSSProperties = {
	backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent calc(${EDITOR_METRICS.lineHeight} - 1px), color-mix(in srgb, ${EDITOR_COLORS.rule} calc(var(--prompt-editor-show-rules, 0) * 100%), transparent) calc(${EDITOR_METRICS.lineHeight} - 1px), color-mix(in srgb, ${EDITOR_COLORS.rule} calc(var(--prompt-editor-show-rules, 0) * 100%), transparent) ${EDITOR_METRICS.lineHeight})`,
	backgroundPosition: "0 0",
};

/**
 * Tint zero-based odd logical rows without affecting their geometry. Both
 * prompt surfaces use this expression so zebra mode shares rule color and
 * intensity and responds to host variable changes without rendering again.
 */
export function promptEditorZebraBackground(
	lineIndex: number,
): string | undefined {
	if (lineIndex % 2 === 0) return undefined;
	return `color-mix(in srgb, ${EDITOR_COLORS.rule} calc(var(--prompt-editor-show-zebra, 1) * 100%), transparent)`;
}

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

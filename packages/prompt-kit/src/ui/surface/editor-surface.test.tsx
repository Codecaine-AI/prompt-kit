import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
	EDITOR_COLORS,
	EDITOR_FONT_PX,
	EDITOR_METRICS,
	LINE_HEIGHT_PX,
	editorRuleBackground,
	promptEditorIndentForDepth,
	promptEditorIndentForSpaces,
	promptEditorZebraBackground,
} from "./editor-surface";
import { highlightXmlLine } from "./xml-highlight";

describe("prompt editor surface contract", () => {
	test("uses runtime indentation without changing rendered prompt text", () => {
		const line =
			'  <purpose audience="engineer">Use {{topic}} and {{tool:search}}</purpose>';
		const markup = renderToStaticMarkup(<>{highlightXmlLine(line)}</>);

		expect(textFromMarkup(markup)).toBe(line);
		expect(markup).toContain("--prompt-editor-syntax-punctuation");
		expect(markup).toContain("--prompt-editor-syntax-tag");
		expect(markup).toContain("--prompt-editor-syntax-attribute");
		expect(markup).toContain("--prompt-editor-syntax-value");
		expect(markup).toContain("--prompt-editor-syntax-variable");
		expect(markup).toContain("--prompt-editor-syntax-reference");
		expect(markup).toContain(
			`<span style="color:${EDITOR_COLORS.syntaxPunctuation}">=</span>`,
		);
		expect(markup).not.toContain("text-syntax-");
	});

	test("uses the balanced standalone fallbacks", () => {
		expect(EDITOR_FONT_PX).toBe(13);
		expect(LINE_HEIGHT_PX).toBe(22);
		expect(EDITOR_METRICS).toEqual({
			fontFamily:
				'var(--prompt-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace)',
			fontSize: "var(--prompt-editor-font-size, 13px)",
			lineHeight: "var(--prompt-editor-line-height, 22px)",
			letterSpacing: "var(--prompt-editor-letter-spacing, 0em)",
			indentWidth: "var(--prompt-editor-indent-width, 2ch)",
			contentWidth: "var(--prompt-editor-content-width, 136ch)",
			gutterWidth: "var(--prompt-editor-gutter-width, 36px)",
			gripSize: "var(--prompt-editor-grip-size, 20px)",
			itemGripSize: "var(--prompt-editor-item-grip-size, 14px)",
			dropLineWidth: "var(--prompt-editor-drop-line-width, 2px)",
			landmarkFontScale: "var(--prompt-editor-landmark-font-scale, 1.08)",
			landmarkPad: "var(--prompt-editor-landmark-pad, 8px)",
			gapHeightBase:
				"var(--prompt-editor-gap-height-base, var(--prompt-editor-line-height, 22px))",
			gapHeightSub:
				"var(--prompt-editor-gap-height-sub, calc(var(--prompt-editor-line-height, 22px) + 32px))",
			gapHeightTop:
				"var(--prompt-editor-gap-height-top, calc(var(--prompt-editor-line-height, 22px) + 64px))",
		});
		expect(EDITOR_COLORS).toEqual({
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
			syntaxReference:
				"var(--prompt-editor-syntax-reference, #5FBCA5)",
			syntaxListMarker:
				"var(--prompt-editor-syntax-list-marker, var(--editor-line-number, #7E8590))",
			hoverBg:
				"var(--prompt-editor-hover-bg, rgb(255 255 255 / 0.05))",
			selectionBg:
				"var(--prompt-editor-selection-bg, rgb(61 123 191 / 0.16))",
			selectionAccent:
				"var(--prompt-editor-selection-accent, #4D9DE0)",
			activeLineBg:
				"var(--prompt-editor-active-line-bg, rgb(255 255 255 / 0.035))",
			grip: "var(--prompt-editor-grip-color, #8A919C)",
			dropLine: "var(--prompt-editor-drop-line-color, #4D9DE0)",
			diffDelBg: "var(--prompt-editor-diff-del-bg, rgb(248 81 73 / 0.13))",
			diffDelFg: "var(--prompt-editor-diff-del-fg, #F85149)",
			diffAddBg: "var(--prompt-editor-diff-add-bg, rgb(63 185 80 / 0.13))",
			diffAddFg: "var(--prompt-editor-diff-add-fg, #3FB950)",
			threadAccent: "var(--prompt-editor-thread-accent, #D29922)",
		});
		expect(editorRuleBackground.backgroundImage).toContain(
			"var(--prompt-editor-show-rules, 0)",
		);
	});

	test("tints only zero-based odd rows with the shared zebra expression", () => {
		expect(promptEditorZebraBackground(0)).toBeUndefined();
		expect(promptEditorZebraBackground(1)).toBe(
			`color-mix(in srgb, ${EDITOR_COLORS.rule} calc(var(--prompt-editor-show-zebra, 1) * 100%), transparent)`,
		);
		expect(promptEditorZebraBackground(2)).toBeUndefined();
		expect(promptEditorZebraBackground(3)).toBe(
			promptEditorZebraBackground(1),
		);
	});

	test("builds indentation expressions without CSS length multiplication", () => {
		expect(promptEditorIndentForSpaces(0)).toBe("0px");
		expect(promptEditorIndentForSpaces(2)).toBe(
			"var(--prompt-editor-indent-width, 2ch)",
		);
		expect(promptEditorIndentForSpaces(5)).toBe(
			"calc(var(--prompt-editor-indent-width, 2ch) + var(--prompt-editor-indent-width, 2ch) + 1ch)",
		);
		expect(promptEditorIndentForDepth(2)).toBe(
			"calc(var(--prompt-editor-indent-width, 2ch) + var(--prompt-editor-indent-width, 2ch))",
		);
	});
});

function textFromMarkup(markup: string): string {
	return markup
		.replace(/<[^>]+>/g, "")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&");
}

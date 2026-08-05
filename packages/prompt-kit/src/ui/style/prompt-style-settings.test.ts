import { describe, expect, test } from "bun:test";

import {
	loadPromptStyleSettings,
	normalizePromptStyleSettings,
	PROMPT_STYLE_DEFAULTS,
	PROMPT_STYLE_STORAGE_KEY,
	promptStyleVars,
	savePromptStyleSettings,
	type PromptStyleStorage,
} from "./prompt-style-settings";

function memoryStorage(
	initial: Record<string, string> = {},
): PromptStyleStorage & { entries: Map<string, string> } {
	const entries = new Map(Object.entries(initial));
	return {
		entries,
		getItem: (key) => entries.get(key) ?? null,
		setItem: (key, value) => {
			entries.set(key, value);
		},
		removeItem: (key) => {
			entries.delete(key);
		},
	};
}

describe("prompt style defaults", () => {
	// ONE global theme (2026-08-04 audit): the painted palette over the
	// balanced metrics. Presets are gone — there is nothing to switch to,
	// so a stray click can never reset the look.
	test("exports the frozen painted baseline", () => {
		expect(PROMPT_STYLE_DEFAULTS).toEqual({
			fontFamily: "system",
			fontSize: 13,
			lineHeight: 22,
			letterSpacing: 0,
			indentWidth: 20,
			contentWidth: 136,
			marginLeft: 48,
			marginTop: 24,
			panelInset: 24,
			panelTopInset: 12,
			composerWidth: 640,
			landmarkFontScale: 1.08,
			gapRamp: 0.5,
			showGuides: true,
			surfaceColor: "#1E1E1E",
			foregroundColor: "#D4D6D3",
			gutterColor: "#1E1E1E",
			lineNumberColor: "#5F6672",
			activeLineNumberColor: "#C6CCD2",
			tagPunctuationColor: "#6E7681",
			tagNameColor: "#9A7CAC",
			tagLandmarkColor: "#CBA6DE",
			tagSublandmarkColor: "#B48EC7",
			attributeNameColor: "#85AECB",
			attributeValueColor: "#C09A78",
			variableColor: "#CFBC74",
			referenceColor: "#58A794",
			inlineCodeColor: "#5FBCA5",
			inlineChipOpacity: 0.08,
			listMarkerColor: "#6C737B",
			guideColor: "#FFFFFF",
			guideOpacity: 0.1,
			landmarkColor: "#FFFFFF",
			landmarkOpacity: 0,
			selectionColor: "#3D7BBF",
			selectionOpacity: 0.16,
			selectionAccentColor: "#4D9DE0",
			activeLineColor: "#FFFFFF",
			activeLineOpacity: 0.035,
			hoverColor: "#FFFFFF",
			hoverOpacity: 0.05,
			gripColor: "#8A919C",
			gripSize: 20,
			gripOpacity: 0.5,
			dropIndicatorColor: "#4D9DE0",
			dropIndicatorWidth: 2,
			dropIndicatorOpacity: 0.95,
		});
	});
});

describe("normalizePromptStyleSettings", () => {
	test("fills defaults, clamps numbers, validates enums, and canonicalizes colors", () => {
		const normalized = normalizePromptStyleSettings({
			fontFamily: "comic-sans",
			fontSize: 999,
			lineHeight: Number.NaN,
			letterSpacing: -4,
			indentWidth: 17.7,
			contentWidth: 10,
			showGuides: false,
			surfaceColor: "#abc",
			foregroundColor: "red",
			dropIndicatorWidth: 99,
			dropIndicatorOpacity: -1,
		});

		expect(normalized.fontFamily).toBe(PROMPT_STYLE_DEFAULTS.fontFamily);
		expect(normalized.fontSize).toBe(24);
		expect(normalized.lineHeight).toBe(PROMPT_STYLE_DEFAULTS.lineHeight);
		expect(normalized.letterSpacing).toBe(-0.05);
		expect(normalized.indentWidth).toBe(18);
		expect(normalized.contentWidth).toBe(60);
		expect(
			normalizePromptStyleSettings({ contentWidth: 999 }).contentWidth,
		).toBe(180);
		expect(normalized.showGuides).toBe(false);
		expect(normalized.surfaceColor).toBe("#AABBCC");
		expect(normalized.foregroundColor).toBe(
			PROMPT_STYLE_DEFAULTS.foregroundColor,
		);
		expect(normalized.dropIndicatorWidth).toBe(6);
		expect(normalized.dropIndicatorOpacity).toBe(0);
	});

	test("ignores retired fields (presets, line numbers, row shading)", () => {
		// Payloads persisted before the one-theme cleanup carry retired keys —
		// they normalize away without leaking into the result.
		const normalized = normalizePromptStyleSettings({
			gutterWidth: 96,
			showLineNumbers: true,
			rowShading: "zebra",
			ruleColor: "#102030",
			ruleOpacity: 0.2,
			showRules: true,
		});
		expect(normalized).toEqual(PROMPT_STYLE_DEFAULTS);
		expect("rowShading" in normalized).toBe(false);
		expect("showLineNumbers" in normalized).toBe(false);
		expect("gutterWidth" in normalized).toBe(false);
	});

	test("rejects non-object and non-finite input without sharing defaults", () => {
		const first = normalizePromptStyleSettings(null);
		const second = normalizePromptStyleSettings({
			fontSize: Number.POSITIVE_INFINITY,
		});

		expect(first).toEqual(PROMPT_STYLE_DEFAULTS);
		expect(second).toEqual(PROMPT_STYLE_DEFAULTS);
		expect(first).not.toBe(PROMPT_STYLE_DEFAULTS);
	});
});

describe("prompt style persistence", () => {
	test("round-trips a normalized, versioned payload", () => {
		const storage = memoryStorage();
		const settings = normalizePromptStyleSettings({
			...PROMPT_STYLE_DEFAULTS,
			fontFamily: "jetbrains-mono",
			fontSize: 14.5,
			tagNameColor: "#abc",
		});

		savePromptStyleSettings(settings, storage);
		const raw = storage.entries.get(PROMPT_STYLE_STORAGE_KEY);
		expect(raw).toBeDefined();
		expect(JSON.parse(raw!).version).toBe(2);
		expect(loadPromptStyleSettings(storage)).toEqual(settings);
	});

	test("removes storage when reset to defaults", () => {
		const storage = memoryStorage({
			[PROMPT_STYLE_STORAGE_KEY]: '{"version":2,"settings":{"fontSize":19}}',
		});

		savePromptStyleSettings({ ...PROMPT_STYLE_DEFAULTS }, storage);

		expect(storage.entries.has(PROMPT_STYLE_STORAGE_KEY)).toBe(false);
		expect(loadPromptStyleSettings(storage)).toEqual(PROMPT_STYLE_DEFAULTS);
	});

	test("falls back safely for corrupt and wrong-version payloads", () => {
		const corrupt = memoryStorage({
			[PROMPT_STYLE_STORAGE_KEY]: "{",
		});
		const future = memoryStorage({
			[PROMPT_STYLE_STORAGE_KEY]: '{"version":3,"settings":{"fontSize":20}}',
		});

		expect(loadPromptStyleSettings(corrupt)).toEqual(PROMPT_STYLE_DEFAULTS);
		expect(loadPromptStyleSettings(future)).toEqual(PROMPT_STYLE_DEFAULTS);
	});

	test("tolerates storage access failures", () => {
		const broken: PromptStyleStorage = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		};

		expect(loadPromptStyleSettings(broken)).toEqual(PROMPT_STYLE_DEFAULTS);
		expect(() =>
			savePromptStyleSettings(
				{
					...PROMPT_STYLE_DEFAULTS,
					fontSize: 17,
				},
				broken,
			),
		).not.toThrow();
	});
});

describe("promptStyleVars", () => {
	test("emits prompt-scoped metrics, toggles, palette, and alpha colors", () => {
		const vars = promptStyleVars({
			...PROMPT_STYLE_DEFAULTS,
			fontFamily: "ibm-plex-mono",
			fontSize: 16,
			guideColor: "#102030",
			guideOpacity: 0.25,
			dropIndicatorWidth: 3,
		}) as Record<string, string>;

		expect(vars["--prompt-editor-font-family"]).toContain("IBM Plex Mono");
		expect(vars["--prompt-editor-font-size"]).toBe("16px");
		expect(vars["--prompt-editor-line-height"]).toBe("22px");
		// Line numbers, rules, and zebra retired: the gutter is always the
		// collapsed affordance strip and their toggles no longer exist.
		expect(vars["--prompt-editor-gutter-width"]).toBe("36px");
		expect("--prompt-editor-show-line-numbers" in vars).toBe(false);
		expect("--prompt-editor-show-rules" in vars).toBe(false);
		expect("--prompt-editor-show-zebra" in vars).toBe(false);
		expect("--prompt-editor-rule" in vars).toBe(false);
		expect(vars["--prompt-editor-guide"]).toBe("rgb(16 32 48 / 0.25)");
		expect(vars["--prompt-editor-syntax-tag"]).toBe(
			PROMPT_STYLE_DEFAULTS.tagNameColor,
		);
		expect(vars["--prompt-editor-drop-line-width"]).toBe("3px");
		expect(vars["--prompt-editor-selection-accent"]).toBe(
			PROMPT_STYLE_DEFAULTS.selectionAccentColor,
		);
	});

	test("emits landmark, gap, and inline-chip tokens", () => {
		const vars = promptStyleVars({
			...PROMPT_STYLE_DEFAULTS,
			lineHeight: 20,
			landmarkFontScale: 1.1,
			gapRamp: 0.5,
			inlineCodeColor: "#5FBCA5",
			inlineChipOpacity: 0.1,
		}) as Record<string, string>;

		expect(vars["--prompt-editor-landmark-font-scale"]).toBe("1.1");
		expect(vars["--prompt-editor-gap-height-base"]).toBe("20px");
		expect(vars["--prompt-editor-gap-height-sub"]).toBe("36px");
		expect(vars["--prompt-editor-gap-height-top"]).toBe("52px");
		expect(vars["--prompt-editor-syntax-tag-landmark"]).toBe(
			PROMPT_STYLE_DEFAULTS.tagLandmarkColor,
		);
		expect(vars["--prompt-editor-syntax-tag-sublandmark"]).toBe(
			PROMPT_STYLE_DEFAULTS.tagSublandmarkColor,
		);
		expect(vars["--prompt-editor-landmark-pad"]).toBe("4px");
		expect(vars["--prompt-editor-inline-code"]).toBe("#5FBCA5");
		expect(vars["--prompt-editor-inline-chip-opacity"]).toBe("0.1");
		expect(vars["--prompt-editor-inline-chip-bg"]).toBe(
			"rgb(95 188 165 / 0.1)",
		);

		const flat = promptStyleVars({
			...PROMPT_STYLE_DEFAULTS,
			gapRamp: 0,
		}) as Record<string, string>;
		expect(flat["--prompt-editor-gap-height-base"]).toBe("22px");
		expect(flat["--prompt-editor-gap-height-sub"]).toBe("22px");
		expect(flat["--prompt-editor-gap-height-top"]).toBe("22px");
	});
});

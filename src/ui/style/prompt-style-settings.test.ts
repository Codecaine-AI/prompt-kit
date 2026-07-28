import { describe, expect, test } from "bun:test";

import {
	loadPromptStyleSettings,
	normalizePromptStyleSettings,
	PROMPT_STYLE_DEFAULTS,
	PROMPT_STYLE_PRESETS,
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

describe("prompt style presets", () => {
	test("exports the frozen balanced defaults", () => {
		expect(PROMPT_STYLE_DEFAULTS).toEqual({
			fontFamily: "system",
			fontSize: 13,
			lineHeight: 22,
			letterSpacing: 0,
			indentWidth: 20,
			contentWidth: 136,
			gutterWidth: 56,
			showLineNumbers: true,
			showGuides: true,
			rowShading: "zebra",
			surfaceColor: "#1E1E1E",
			foregroundColor: "#E4E4E2",
			gutterColor: "#1E1E1E",
			lineNumberColor: "#5F6672",
			activeLineNumberColor: "#C6CCD2",
			tagPunctuationColor: "#6E7681",
			tagNameColor: "#B48EC7",
			attributeNameColor: "#85AECB",
			attributeValueColor: "#C09A78",
			variableColor: "#D9C578",
			referenceColor: "#5FBCA5",
			listMarkerColor: "#7E8590",
			guideColor: "#FFFFFF",
			guideOpacity: 0.1,
			ruleColor: "#FFFFFF",
			ruleOpacity: 0.025,
			landmarkColor: "#FFFFFF",
			landmarkOpacity: 0.06,
			selectionColor: "#3D7BBF",
			selectionOpacity: 0.16,
			selectionAccentColor: "#4D9DE0",
			activeLineColor: "#FFFFFF",
			activeLineOpacity: 0.035,
			hoverColor: "#FFFFFF",
			hoverOpacity: 0.05,
			gripColor: "#8A919C",
			gripSize: 14,
			gripOpacity: 0.5,
			dropIndicatorColor: "#4D9DE0",
			dropIndicatorWidth: 2,
			dropIndicatorOpacity: 0.95,
		});
		expect(PROMPT_STYLE_DEFAULTS).toEqual(PROMPT_STYLE_PRESETS.balanced);
	});

	test("exports three complete, independently normalizable presets", () => {
		expect(Object.keys(PROMPT_STYLE_PRESETS)).toEqual([
			"dense",
			"balanced",
			"reading",
		]);
		expect(PROMPT_STYLE_PRESETS.dense).toEqual({
			...PROMPT_STYLE_DEFAULTS,
			fontSize: 12,
			lineHeight: 18,
			letterSpacing: -0.01,
			indentWidth: 16,
			contentWidth: 148,
			gutterWidth: 48,
			rowShading: "rules",
			ruleOpacity: 0.05,
		});
		expect(PROMPT_STYLE_PRESETS.reading).toEqual({
			...PROMPT_STYLE_DEFAULTS,
			fontSize: 14.5,
			lineHeight: 25,
			letterSpacing: 0.01,
			indentWidth: 24,
			contentWidth: 88,
			gutterWidth: 60,
			rowShading: "none",
		});

		const expectedKeys = Object.keys(PROMPT_STYLE_DEFAULTS).sort();
		for (const preset of Object.values(PROMPT_STYLE_PRESETS)) {
			expect(Object.keys(preset).sort()).toEqual(expectedKeys);
			expect(normalizePromptStyleSettings(preset)).toEqual(preset);
		}
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
			gutterWidth: 200,
			showLineNumbers: "yes",
			showGuides: false,
			rowShading: "bands",
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
		expect(normalized.gutterWidth).toBe(96);
		expect(normalized.showLineNumbers).toBe(true);
		expect(normalized.showGuides).toBe(false);
		expect(normalized.rowShading).toBe("zebra");
		expect(normalized.surfaceColor).toBe("#AABBCC");
		expect(normalized.foregroundColor).toBe(
			PROMPT_STYLE_DEFAULTS.foregroundColor,
		);
		expect(normalized.dropIndicatorWidth).toBe(6);
		expect(normalized.dropIndicatorOpacity).toBe(0);
	});

	test("normalizes row shading and migrates legacy line-rule booleans", () => {
		expect(
			normalizePromptStyleSettings({
				rowShading: "none",
				showRules: true,
			}).rowShading,
		).toBe("none");
		expect(
			normalizePromptStyleSettings({ showRules: true }).rowShading,
		).toBe("rules");
		expect(
			normalizePromptStyleSettings({ showRules: false }).rowShading,
		).toBe("none");
		expect(
			normalizePromptStyleSettings({
				rowShading: "invalid",
				showRules: true,
			}).rowShading,
		).toBe("rules");
		expect(
			normalizePromptStyleSettings({ rowShading: "invalid" }).rowShading,
		).toBe(PROMPT_STYLE_DEFAULTS.rowShading);
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
			rowShading: "none",
			tagNameColor: "#abc",
		});

		savePromptStyleSettings(settings, storage);
		const raw = storage.entries.get(PROMPT_STYLE_STORAGE_KEY);
		expect(raw).toBeDefined();
		expect(JSON.parse(raw!).version).toBe(1);
		expect(loadPromptStyleSettings(storage)).toEqual(settings);
	});

	test("removes storage when reset to defaults", () => {
		const storage = memoryStorage({
			[PROMPT_STYLE_STORAGE_KEY]: '{"version":1,"settings":{"fontSize":19}}',
		});

		savePromptStyleSettings(
			{ ...PROMPT_STYLE_DEFAULTS },
			storage,
		);

		expect(storage.entries.has(PROMPT_STYLE_STORAGE_KEY)).toBe(false);
		expect(loadPromptStyleSettings(storage)).toEqual(PROMPT_STYLE_DEFAULTS);
	});

	test("falls back safely for corrupt and wrong-version payloads", () => {
		const corrupt = memoryStorage({
			[PROMPT_STYLE_STORAGE_KEY]: "{",
		});
		const future = memoryStorage({
			[PROMPT_STYLE_STORAGE_KEY]: '{"version":2,"settings":{"fontSize":20}}',
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
			showLineNumbers: false,
			rowShading: "rules",
			guideColor: "#102030",
			guideOpacity: 0.25,
			dropIndicatorWidth: 3,
		}) as Record<string, string>;

		expect(vars["--prompt-editor-font-family"]).toContain("IBM Plex Mono");
		expect(vars["--prompt-editor-font-size"]).toBe("16px");
		expect(vars["--prompt-editor-line-height"]).toBe("22px");
		expect(vars["--prompt-editor-line-numbers-display"]).toBe("none");
		expect(vars["--prompt-editor-line-number-visibility"]).toBe("hidden");
		expect(vars["--prompt-editor-show-line-numbers"]).toBe("0");
		expect(vars["--prompt-editor-show-rules"]).toBe("1");
		expect(vars["--prompt-editor-show-zebra"]).toBe("0");
		expect(vars["--prompt-editor-rules-display"]).toBe("block");
		expect(vars["--prompt-editor-zebra-display"]).toBe("none");
		expect(vars["--prompt-editor-guide"]).toBe("rgb(16 32 48 / 0.25)");
		expect(vars["--prompt-editor-syntax-tag"]).toBe(
			PROMPT_STYLE_DEFAULTS.tagNameColor,
		);
		expect(vars["--prompt-editor-drop-line-width"]).toBe("3px");
		expect(vars["--prompt-editor-selection-accent"]).toBe(
			PROMPT_STYLE_DEFAULTS.selectionAccentColor,
		);
	});

	test("emits the zebra toggles and shared shading tokens", () => {
		const vars = promptStyleVars({
			...PROMPT_STYLE_DEFAULTS,
			rowShading: "zebra",
			ruleColor: "#102030",
			ruleOpacity: 0.2,
		}) as Record<string, string>;

		expect(vars["--prompt-editor-show-rules"]).toBe("0");
		expect(vars["--prompt-editor-show-zebra"]).toBe("1");
		expect(vars["--prompt-editor-rules-display"]).toBe("none");
		expect(vars["--prompt-editor-zebra-display"]).toBe("block");
		expect(vars["--prompt-editor-rule-color"]).toBe("#102030");
		expect(vars["--prompt-editor-rule-opacity"]).toBe("0.2");
		expect(vars["--prompt-editor-rule"]).toBe("rgb(16 32 48 / 0.2)");
	});
});

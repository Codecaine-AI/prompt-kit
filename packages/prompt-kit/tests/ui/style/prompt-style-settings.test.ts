import { describe, expect, test } from "bun:test";

import {
	loadPromptStyleSettings,
	normalizePromptStyleSettings,
	PROMPT_STYLE_COLOR_TOKENS,
	PROMPT_STYLE_DEFAULTS,
	PROMPT_STYLE_LEGACY_STORAGE_KEY,
	PROMPT_STYLE_STORAGE_KEY,
	promptStyleStorageKey,
	promptStyleVars,
	savePromptStyleSettings,
	SHOW_COLOR_CONTROLS,
	type PromptStyleStorage,
} from "../../../src/ui/style/prompt-style-settings";

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
	// ONE global theme (2026-08-04 audit): the balanced metrics. Presets are
	// gone — there is nothing to switch to, so a stray click can never reset
	// the look. Colors follow the host theme (design-system tokens): "" means
	// "the token", so no hex default can override the shared look.
	test("exports the token-seeded baseline", () => {
		expect(PROMPT_STYLE_DEFAULTS).toEqual({
			fontFamily: "sans",
			fontSize: 15,
			lineHeight: 26,
			letterSpacing: 0,
			indentWidth: 20,
			contentWidth: 88,
			marginLeft: 48,
			marginTop: 24,
			panelInset: 24,
			panelTopInset: 12,
			composerWidth: 640,
			landmarkFontScale: 1.08,
			gapRamp: 0.5,
			showGuides: true,
			surfaceColor: "",
			foregroundColor: "",
			gutterColor: "",
			lineNumberColor: "",
			activeLineNumberColor: "",
			tagPunctuationColor: "",
			tagNameColor: "",
			tagLandmarkColor: "",
			tagSublandmarkColor: "",
			attributeNameColor: "",
			attributeValueColor: "",
			variableColor: "",
			referenceColor: "",
			inlineCodeColor: "",
			inlineChipOpacity: 0.08,
			listMarkerColor: "",
			guideColor: "",
			guideOpacity: 0.18,
			landmarkColor: "",
			landmarkOpacity: 0,
			selectionColor: "",
			selectionOpacity: 0.16,
			selectionAccentColor: "",
			activeLineColor: "",
			activeLineOpacity: 0.035,
			hoverColor: "",
			hoverOpacity: 0.05,
			gripColor: "",
			gripSize: 20,
			gripOpacity: 0.5,
			dropIndicatorColor: "",
			dropIndicatorWidth: 2,
			dropIndicatorOpacity: 0.95,
		});
	});

	test("maps every color setting to a design-system token", () => {
		const colorKeys = Object.keys(PROMPT_STYLE_DEFAULTS).filter((key) =>
			key.endsWith("Color"),
		);
		expect(Object.keys(PROMPT_STYLE_COLOR_TOKENS).sort()).toEqual(
			colorKeys.sort(),
		);
		for (const value of Object.values(PROMPT_STYLE_COLOR_TOKENS)) {
			expect(value).toMatch(/^var\(--editor-[\w-]+, var\(--ds-color-[\w-]+\)\)$/);
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

	test("keeps an empty color as follow-the-theme and maps retired fonts to token families", () => {
		const normalized = normalizePromptStyleSettings({
			surfaceColor: "",
			tagNameColor: "  ",
			fontFamily: "sf-mono",
		});
		expect(normalized.surfaceColor).toBe("");
		expect(normalized.tagNameColor).toBe("");
		expect(normalized.fontFamily).toBe("system");
		expect(
			normalizePromptStyleSettings({ fontFamily: "jetbrains-mono" }).fontFamily,
		).toBe("ibm-plex-mono");
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
		expect(JSON.parse(raw!).version).toBe(3);
		expect(loadPromptStyleSettings(storage)).toEqual(settings);
	});

	test("stores under the legacy key raised by one", () => {
		expect(PROMPT_STYLE_LEGACY_STORAGE_KEY).toBe("agentKernel.promptEditorStyle.v2");
		expect(PROMPT_STYLE_STORAGE_KEY).toBe("agentKernel.promptEditorStyle.v3");
		expect(promptStyleStorageKey("observatory.style.v9")).toBe("observatory.style.v10");
		expect(promptStyleStorageKey("unversioned")).toBe("unversioned.v2");
	});

	test("migrates the old reading defaults and preserves custom geometry", () => {
		const storage = memoryStorage({
			[PROMPT_STYLE_LEGACY_STORAGE_KEY]: JSON.stringify({version: 2, settings: {
				fontFamily: "system", fontSize: 13, lineHeight: 22, contentWidth: 136,
				marginLeft: 72, guideOpacity: 0.25,
			}}),
		});
		expect(loadPromptStyleSettings(storage)).toMatchObject({
			fontFamily: "sans", fontSize: 15, lineHeight: 26, contentWidth: 88,
			marginLeft: 72, guideOpacity: 0.25,
		});
	});

	test("carries non-color settings over from the legacy key and drops its colors", () => {
		const legacy = JSON.stringify({
			version: 3,
			settings: {
				...PROMPT_STYLE_DEFAULTS,
				surfaceColor: "#FAFAFA",
				tagNameColor: "#FF0000",
				hoverColor: "#102030",
				fontSize: 18,
				marginLeft: 96,
				showGuides: false,
				gripSize: 24,
				hoverOpacity: 0.2,
				selectionOpacity: 0.4,
			},
		});
		const storage = memoryStorage({ [PROMPT_STYLE_LEGACY_STORAGE_KEY]: legacy });

		const loaded = loadPromptStyleSettings(storage);

		expect(loaded).toEqual({
			...PROMPT_STYLE_DEFAULTS,
			fontSize: 18,
			marginLeft: 96,
			showGuides: false,
			gripSize: 24,
			hoverOpacity: 0.2,
			selectionOpacity: 0.4,
		});
		// Loading writes nothing; the legacy entry is never deleted or rewritten.
		expect(storage.entries.has(PROMPT_STYLE_STORAGE_KEY)).toBe(false);
		expect(storage.entries.get(PROMPT_STYLE_LEGACY_STORAGE_KEY)).toBe(legacy);
	});

	test("reads only the raised key once it exists", () => {
		const storage = memoryStorage({
			[PROMPT_STYLE_LEGACY_STORAGE_KEY]: '{"version":3,"settings":{"fontSize":19}}',
			[PROMPT_STYLE_STORAGE_KEY]: '{"version":3,"settings":{"fontSize":12}}',
		});
		expect(loadPromptStyleSettings(storage).fontSize).toBe(12);
	});

	test("a reset sticks while a legacy entry exists, which stays untouched", () => {
		const legacy = '{"version":3,"settings":{"fontSize":19}}';
		const storage = memoryStorage({ [PROMPT_STYLE_LEGACY_STORAGE_KEY]: legacy });
		expect(loadPromptStyleSettings(storage).fontSize).toBe(19);

		savePromptStyleSettings({ ...PROMPT_STYLE_DEFAULTS }, storage);

		expect(JSON.parse(storage.entries.get(PROMPT_STYLE_STORAGE_KEY)!)).toEqual({
			version: 3,
			settings: {},
		});
		expect(loadPromptStyleSettings(storage)).toEqual(PROMPT_STYLE_DEFAULTS);
		expect(storage.entries.get(PROMPT_STYLE_LEGACY_STORAGE_KEY)).toBe(legacy);
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
			[PROMPT_STYLE_STORAGE_KEY]: '{"version":99,"settings":{"fontSize":20}}',
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
	test("paints every color from the theme and ignores saved picks while color controls are hidden", () => {
		expect(SHOW_COLOR_CONTROLS).toBe(false);
		const settings = { ...PROMPT_STYLE_DEFAULTS, surfaceColor: "#222222", hoverColor: "#334455", fontSize: 17 };
		for (const options of [{}, { followTheme: true }]) {
			const vars = promptStyleVars(settings, options) as Record<string, string>;
			expect(vars["--prompt-editor-bg"]).toBe("var(--editor-bg, var(--ds-color-code-gutter-bg))");
			expect(vars["--prompt-editor-hover-bg"]).toBe(
				"color-mix(in srgb, var(--editor-hover-color, var(--ds-color-text-ink)) 5%, transparent)",
			);
			expect(vars["--prompt-editor-font-size"]).toBe("17px");
		}
		expect(settings.surfaceColor).toBe("#222222");
	});

	test("emits no literal color: every color variable reads a design-system token", () => {
		const vars = promptStyleVars(PROMPT_STYLE_DEFAULTS) as Record<string, string>;
		for (const [name, value] of Object.entries(vars)) {
			expect(`${name}: ${value}`).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
		}
		for (const name of [
			"--prompt-editor-bg",
			"--prompt-editor-syntax-tag",
			"--prompt-editor-selection-bg",
			"--prompt-editor-panel-bg",
			"--prompt-editor-panel-border",
			"--prompt-editor-diff-add-fg",
			"--prompt-editor-thread-accent",
			"--prompt-annotate-accent",
			"--prompt-annotate-line",
		]) {
			expect(vars[name]).toContain("var(--ds-");
		}
		expect(vars["--prompt-editor-font-family"]).toBe("var(--ds-font-family-sans)");
		// The landmark wash is off by default (opacity 0): plainly transparent.
		expect(vars["--prompt-editor-landmark"]).toBe("transparent");
	});

	test("emits prompt-scoped metrics, toggles, palette, and alpha colors", () => {
		const vars = promptStyleVars({
			...PROMPT_STYLE_DEFAULTS,
			fontFamily: "ibm-plex-mono",
			fontSize: 16,
			guideColor: "#102030",
			guideOpacity: 0.25,
			dropIndicatorWidth: 3,
		}) as Record<string, string>;

		expect(vars["--prompt-editor-font-family"]).toBe("var(--ds-font-family-mono)");
		expect(vars["--prompt-editor-font-size"]).toBe("16px");
		expect(vars["--prompt-editor-line-height"]).toBe("26px");
		// Line numbers, rules, and zebra retired: the gutter is always the
		// collapsed affordance strip and their toggles no longer exist.
		expect(vars["--prompt-editor-gutter-width"]).toBe("36px");
		expect("--prompt-editor-show-line-numbers" in vars).toBe(false);
		expect("--prompt-editor-show-rules" in vars).toBe(false);
		expect("--prompt-editor-show-zebra" in vars).toBe(false);
		expect("--prompt-editor-rule" in vars).toBe(false);
		// The opacity knob applies; the saved guide color does not.
		expect(vars["--prompt-editor-guide"]).toBe(
			`color-mix(in srgb, ${PROMPT_STYLE_COLOR_TOKENS.guideColor} 25%, transparent)`,
		);
		expect(vars["--prompt-editor-syntax-tag"]).toBe(
			"var(--editor-syntax-tag, var(--ds-color-syntax-tag))",
		);
		expect(vars["--prompt-editor-drop-line-width"]).toBe("3px");
		expect(vars["--prompt-editor-selection-accent"]).toBe(
			"var(--editor-selection-accent, var(--ds-color-accent))",
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
			"var(--editor-syntax-tag-landmark, var(--ds-color-syntax-tag))",
		);
		expect(vars["--prompt-editor-syntax-tag-sublandmark"]).toBe(
			"var(--editor-syntax-tag-sublandmark, var(--ds-color-syntax-tag))",
		);
		expect(vars["--prompt-editor-landmark-pad"]).toBe("4px");
		expect(vars["--prompt-editor-inline-code"]).toBe(
			"var(--editor-inline-code, var(--ds-color-syntax-string))",
		);
		expect(vars["--prompt-editor-inline-chip-opacity"]).toBe("0.1");
		expect(vars["--prompt-editor-inline-chip-bg"]).toBe(
			"color-mix(in srgb, var(--editor-inline-code, var(--ds-color-syntax-string)) 10%, transparent)",
		);

		const flat = promptStyleVars({
			...PROMPT_STYLE_DEFAULTS,
			gapRamp: 0,
		}) as Record<string, string>;
		expect(flat["--prompt-editor-gap-height-base"]).toBe("26px");
		expect(flat["--prompt-editor-gap-height-sub"]).toBe("26px");
		expect(flat["--prompt-editor-gap-height-top"]).toBe("26px");
	});
});

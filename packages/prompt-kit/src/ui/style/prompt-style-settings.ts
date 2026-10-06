import type { CSSProperties } from "react";

import {
	EDITOR_FONT_PX,
	LINE_HEIGHT_PX,
	PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH,
} from "../surface/editor-surface";

export type PromptMonoFontFamily =
	| "sans"
	| "system"
	| "sf-mono"
	| "jetbrains-mono"
	| "ibm-plex-mono";


/**
 * Viewer-only presentation preferences for the XML-shaped prompt surfaces.
 *
 * This intentionally has no dependency on PromptDocument: changing these
 * values must never change prompt serialization, hashes, or revision history.
 */
export interface PromptStyleSettings {
	fontFamily: PromptMonoFontFamily;
	fontSize: number;
	lineHeight: number;
	letterSpacing: number;
	indentWidth: number;
	contentWidth: number;
	/** Left-justified layout: the fixed gap between the region's left edge and
	 * the content column (the column no longer centers). */
	marginLeft: number;
	/** Breathing room above the document's first line. */
	marginTop: number;
	/** Gap between the glass panel and the region's right edge — breathing
	 * room around the scrollbar. */
	panelInset: number;
	/** Gap between the glass panel's pinned corner and the region's top. */
	panelTopInset: number;
	/** The inline composer's width. Left edge stays pinned to the targeting
	 * ring; this caps how far right the box reaches (never past the ring). */
	composerWidth: number;
	landmarkFontScale: number;
	gapRamp: number;

	showGuides: boolean;

	// Colors: "" follows the host theme (the design-system token named in
	// PROMPT_STYLE_COLOR_TOKENS); "#RRGGBB" is a saved pick. Saved picks paint
	// only while SHOW_COLOR_CONTROLS is on.
	surfaceColor: string;
	foregroundColor: string;
	gutterColor: string;
	lineNumberColor: string;
	activeLineNumberColor: string;

	tagPunctuationColor: string;
	tagNameColor: string;
	tagLandmarkColor: string;
	tagSublandmarkColor: string;
	attributeNameColor: string;
	attributeValueColor: string;
	variableColor: string;
	referenceColor: string;
	inlineCodeColor: string;
	inlineChipOpacity: number;
	listMarkerColor: string;

	guideColor: string;
	guideOpacity: number;
	landmarkColor: string;
	landmarkOpacity: number;

	selectionColor: string;
	selectionOpacity: number;
	selectionAccentColor: string;
	activeLineColor: string;
	activeLineOpacity: number;
	hoverColor: string;
	hoverOpacity: number;

	gripColor: string;
	gripSize: number;
	gripOpacity: number;
	dropIndicatorColor: string;
	dropIndicatorWidth: number;
	dropIndicatorOpacity: number;
}

export interface PromptStyleStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/**
 * Owner decision for style engines (design-system rollout): the color pickers
 * are hidden and saved colors stop overriding the shared look; the code stays.
 * Off: the rail shows no color picker and promptStyleVars paints every color
 * from the design-system tokens, ignoring saved picks. On: the pickers come
 * back and saved picks paint again. Size, density and opacity controls are
 * always on.
 */
export const SHOW_COLOR_CONTROLS = false;

/** The key the settings lived under before the token migration. Read once, never written or deleted. */
export const PROMPT_STYLE_LEGACY_STORAGE_KEY = "agentKernel.promptEditorStyle.v2";

/** `key` with its trailing `.v<N>` raised by one (`.v2` appended when it has none). */
export function promptStyleStorageKey(key: string): string {
	const match = /^(.*)\.v(\d+)$/.exec(key);
	return match ? `${match[1]}.v${Number(match[2]) + 1}` : `${key}.v2`;
}

/**
 * Where settings are stored: the legacy key raised by one (`.v3`). The raise
 * makes saved colors stop overriding the tokens; the first load without a v3
 * entry carries the non-color settings over from the legacy key.
 */
export const PROMPT_STYLE_STORAGE_KEY = promptStyleStorageKey(
	PROMPT_STYLE_LEGACY_STORAGE_KEY,
);

const STORAGE_VERSION = 3;

/**
 * Font choices read the design-system families. SF Mono and JetBrains Mono
 * were never loaded by a host; they resolve to the platform mono and to the
 * package mono (IBM Plex Mono) by role, and normalize to those choices.
 */
const FONT_STACKS: Record<PromptMonoFontFamily, string> = {
	sans: "var(--ds-font-family-sans)",
	system: "var(--ds-font-family-mono-system)",
	"sf-mono": "var(--ds-font-family-mono-system)",
	"jetbrains-mono": "var(--ds-font-family-mono)",
	"ibm-plex-mono": "var(--ds-font-family-mono)",
};

/** Retired font choices and the token-backed choice each one now reads. */
const FONT_FAMILY_ALIASES: Partial<Record<PromptMonoFontFamily, PromptMonoFontFamily>> = {
	"sf-mono": "system",
	"jetbrains-mono": "ibm-plex-mono",
};

const DEFAULT_FONT_FAMILY: PromptMonoFontFamily = "sans";

type ColorKey = {
	[K in keyof PromptStyleSettings]: K extends `${string}Color` ? K : never;
}[keyof PromptStyleSettings];

/**
 * The theme value of every color setting: the host's `--editor-*` contract
 * name first (host-contract.css maps the ones it defines to these same
 * roles), then the design-system token. Roles follow the code panels'
 * syntax mapping (docs-viewer code.css): tag marks and list markers are
 * punctuation, tag names are tags, attributes and template variables are
 * keys, attribute values and inline code are strings, namespaced references
 * are types. The four washes (guide, landmark, active line, hover) are the
 * ink at the setting's opacity, the recipe of color.fill.hover.
 */
export const PROMPT_STYLE_COLOR_TOKENS: Readonly<Record<ColorKey, string>> = {
	surfaceColor: "var(--editor-bg, var(--ds-color-code-gutter-bg))",
	foregroundColor: "var(--editor-fg, var(--ds-color-code-chip-ink))",
	gutterColor: "var(--editor-gutter-bg, var(--ds-color-code-gutter-bg))",
	lineNumberColor: "var(--editor-line-number, var(--ds-color-code-gutter-fg))",
	activeLineNumberColor:
		"var(--editor-line-number-active, var(--ds-color-code-header-fg))",
	tagPunctuationColor:
		"var(--editor-syntax-punctuation, var(--ds-color-syntax-punctuation))",
	tagNameColor: "var(--editor-syntax-tag, var(--ds-color-syntax-tag))",
	tagLandmarkColor: "var(--editor-syntax-tag-landmark, var(--ds-color-syntax-tag))",
	tagSublandmarkColor:
		"var(--editor-syntax-tag-sublandmark, var(--ds-color-syntax-tag))",
	attributeNameColor: "var(--editor-syntax-attribute, var(--ds-color-syntax-key))",
	attributeValueColor: "var(--editor-syntax-value, var(--ds-color-syntax-string))",
	variableColor: "var(--editor-syntax-variable, var(--ds-color-syntax-key))",
	referenceColor: "var(--editor-syntax-reference, var(--ds-color-syntax-type))",
	inlineCodeColor: "var(--editor-inline-code, var(--ds-color-syntax-string))",
	listMarkerColor:
		"var(--editor-syntax-list-marker, var(--ds-color-syntax-punctuation))",
	guideColor: "var(--editor-guide-color, var(--ds-color-text-ink))",
	landmarkColor: "var(--editor-landmark-color, var(--ds-color-text-ink))",
	selectionColor: "var(--editor-selection-color, var(--ds-color-accent))",
	selectionAccentColor: "var(--editor-selection-accent, var(--ds-color-accent))",
	activeLineColor: "var(--editor-active-line-color, var(--ds-color-text-ink))",
	hoverColor: "var(--editor-hover-color, var(--ds-color-text-ink))",
	gripColor: "var(--editor-grip-color, var(--ds-color-text-muted))",
	dropIndicatorColor: "var(--editor-drop-line-color, var(--ds-color-accent))",
};

const COLOR_KEYS = Object.keys(PROMPT_STYLE_COLOR_TOKENS) as ColorKey[];

/**
 * Lab chrome and staged-diff paint with no setting of its own. Every lab and
 * PromptView root carries these, so the existing `var(--prompt-…, literal)`
 * reads in the lab resolve to tokens and their literals stay a fallback for a
 * surface rendered outside a root.
 */
const PROMPT_THEME_VARS = {
	"--prompt-editor-panel-bg": "var(--ds-color-surface-panel)",
	// Raised bars inside the editor sit one step ABOVE the editor surface (the
	// fill.hover recipe over --prompt-editor-bg), never below it (decision 64:
	// no inverted depth). Without tokens.css the value is invalid and the
	// consumer's literal fallback paints.
	"--prompt-editor-panel-raise":
		"color-mix(in srgb, var(--ds-color-text-ink) 3%, var(--prompt-editor-bg))",
	"--prompt-editor-panel-border": "var(--ds-color-border-default)",
	"--prompt-editor-panel-input-bg": "var(--ds-color-surface-page)",
	"--prompt-editor-panel-shadow": "var(--ds-shadow-glass)",
	"--prompt-editor-muted": "var(--ds-color-text-muted)",
	"--prompt-editor-diff-del-bg": "var(--editor-diff-del-bg, var(--ds-color-diff-del-bg))",
	"--prompt-editor-diff-del-fg": "var(--editor-diff-del-fg, var(--ds-color-diff-del))",
	"--prompt-editor-diff-add-bg": "var(--editor-diff-add-bg, var(--ds-color-diff-add-bg))",
	"--prompt-editor-diff-add-fg": "var(--editor-diff-add-fg, var(--ds-color-diff-add))",
	"--prompt-editor-thread-accent":
		"var(--editor-thread-accent, var(--ds-color-status-warning-text))",
	"--prompt-annotate-accent": "var(--ds-color-annotation-accent)",
	"--prompt-annotate-accent-lit": "var(--ds-color-annotation-accent-lit)",
	"--prompt-annotate-accent-dim": "var(--ds-color-annotation-accent-dim)",
	"--prompt-annotate-line": "var(--ds-color-annotation-border)",
	"--prompt-annotate-wash": "var(--ds-color-annotation-wash)",
	"--prompt-annotate-fill": "var(--ds-color-annotation-wash)",
} as const;

// Document typography follows Docs System: sans-serif prose, larger text,
// generous leading, and a shorter reading measure. Colors follow the host
// theme through PROMPT_STYLE_COLOR_TOKENS. The numbers are the rail's own
// size, density and opacity knobs (kept as numbers: the sliders read them).
const BASE_SETTINGS: PromptStyleSettings = {
	fontFamily: DEFAULT_FONT_FAMILY,
	fontSize: EDITOR_FONT_PX,
	lineHeight: LINE_HEIGHT_PX,
	letterSpacing: 0,
	indentWidth: 20,
	// Limit long lines so the eye can return to the next line comfortably.
	contentWidth: 88,
	marginLeft: 48,
	marginTop: 24,
	panelInset: 24,
	panelTopInset: 12,
	composerWidth: 640,
	landmarkFontScale: 1.08,
	// Half ramp: the full 64px chapter break read as too much air between
	// top-level sections once the landmark wash came off. The rail's slider
	// still walks the whole 0–1 range.
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
	// Off by default: landmark rows already read as landmarks from the larger
	// tag type and band padding; the full-width wash competes with selection
	// and hover paint. The slider keeps the wash available.
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
};

/**
 * The application default is a complete value, not a patch. Resetting means
 * removing persisted overrides and returning this object.
 */
export const PROMPT_STYLE_DEFAULTS: Readonly<PromptStyleSettings> =
	BASE_SETTINGS;

const FONT_FAMILIES = new Set<PromptMonoFontFamily>([
	"sans",
	"system",
	"sf-mono",
	"jetbrains-mono",
	"ibm-plex-mono",
]);
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberInRange(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(maximum, Math.max(minimum, value));
}

function integerInRange(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	return Math.round(numberInRange(value, fallback, minimum, maximum));
}

function booleanOr(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function fontFamilyOr(
	value: unknown,
	fallback: PromptMonoFontFamily,
): PromptMonoFontFamily {
	if (
		typeof value !== "string" ||
		!FONT_FAMILIES.has(value as PromptMonoFontFamily)
	) {
		return fallback;
	}
	const family = value as PromptMonoFontFamily;
	return FONT_FAMILY_ALIASES[family] ?? family;
}

/**
 * Accept "" (follow the theme), #RGB and #RRGGBB, and return "" or canonical
 * uppercase #RRGGBB. Alpha is kept in separate numeric settings so color
 * pickers can round-trip every color value.
 */
function colorOr(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	if (trimmed === "") return "";
	const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(trimmed);
	if (!match) return fallback;
	const hex = match[1]!;
	const expanded =
		hex.length === 3
			? hex
					.split("")
					.map((character) => `${character}${character}`)
					.join("")
			: hex;
	return `#${expanded.toUpperCase()}`;
}

export function normalizePromptStyleSettings(
	input: unknown,
): PromptStyleSettings {
	const source = isRecord(input) ? input : {};
	const defaults = PROMPT_STYLE_DEFAULTS;

	return {
		fontFamily: fontFamilyOr(source.fontFamily, defaults.fontFamily),
		fontSize: numberInRange(source.fontSize, defaults.fontSize, 10, 24),
		lineHeight: numberInRange(source.lineHeight, defaults.lineHeight, 14, 40),
		letterSpacing: numberInRange(
			source.letterSpacing,
			defaults.letterSpacing,
			-0.05,
			0.15,
		),
		indentWidth: integerInRange(
			source.indentWidth,
			defaults.indentWidth,
			12,
			48,
		),
		contentWidth: integerInRange(
			source.contentWidth,
			defaults.contentWidth,
			60,
			180,
		),
		marginLeft: integerInRange(
			source.marginLeft,
			defaults.marginLeft,
			0,
			240,
		),
		marginTop: integerInRange(
			source.marginTop,
			defaults.marginTop,
			0,
			160,
		),
		panelInset: integerInRange(
			source.panelInset,
			defaults.panelInset,
			8,
			96,
		),
		panelTopInset: integerInRange(
			source.panelTopInset,
			defaults.panelTopInset,
			0,
			120,
		),
		composerWidth: integerInRange(
			source.composerWidth,
			defaults.composerWidth,
			320,
			1600,
		),
		landmarkFontScale: numberInRange(
			source.landmarkFontScale,
			defaults.landmarkFontScale,
			1,
			1.2,
		),
		gapRamp: numberInRange(source.gapRamp, defaults.gapRamp, 0, 1),

		showGuides: booleanOr(source.showGuides, defaults.showGuides),

		surfaceColor: colorOr(source.surfaceColor, defaults.surfaceColor),
		foregroundColor: colorOr(
			source.foregroundColor,
			defaults.foregroundColor,
		),
		gutterColor: colorOr(source.gutterColor, defaults.gutterColor),
		lineNumberColor: colorOr(
			source.lineNumberColor,
			defaults.lineNumberColor,
		),
		activeLineNumberColor: colorOr(
			source.activeLineNumberColor,
			defaults.activeLineNumberColor,
		),

		tagPunctuationColor: colorOr(
			source.tagPunctuationColor,
			defaults.tagPunctuationColor,
		),
		tagNameColor: colorOr(source.tagNameColor, defaults.tagNameColor),
		tagLandmarkColor: colorOr(
			source.tagLandmarkColor,
			defaults.tagLandmarkColor,
		),
		tagSublandmarkColor: colorOr(
			source.tagSublandmarkColor,
			defaults.tagSublandmarkColor,
		),
		attributeNameColor: colorOr(
			source.attributeNameColor,
			defaults.attributeNameColor,
		),
		attributeValueColor: colorOr(
			source.attributeValueColor,
			defaults.attributeValueColor,
		),
		variableColor: colorOr(source.variableColor, defaults.variableColor),
		referenceColor: colorOr(source.referenceColor, defaults.referenceColor),
		inlineCodeColor: colorOr(
			source.inlineCodeColor,
			defaults.inlineCodeColor,
		),
		inlineChipOpacity: numberInRange(
			source.inlineChipOpacity,
			defaults.inlineChipOpacity,
			0,
			0.3,
		),
		listMarkerColor: colorOr(
			source.listMarkerColor,
			defaults.listMarkerColor,
		),

		guideColor: colorOr(source.guideColor, defaults.guideColor),
		guideOpacity: numberInRange(
			source.guideOpacity,
			defaults.guideOpacity,
			0,
			1,
		),
		landmarkColor: colorOr(source.landmarkColor, defaults.landmarkColor),
		landmarkOpacity: numberInRange(
			source.landmarkOpacity,
			defaults.landmarkOpacity,
			0,
			1,
		),

		selectionColor: colorOr(source.selectionColor, defaults.selectionColor),
		selectionOpacity: numberInRange(
			source.selectionOpacity,
			defaults.selectionOpacity,
			0,
			1,
		),
		selectionAccentColor: colorOr(
			source.selectionAccentColor,
			defaults.selectionAccentColor,
		),
		activeLineColor: colorOr(
			source.activeLineColor,
			defaults.activeLineColor,
		),
		activeLineOpacity: numberInRange(
			source.activeLineOpacity,
			defaults.activeLineOpacity,
			0,
			1,
		),
		hoverColor: colorOr(source.hoverColor, defaults.hoverColor),
		hoverOpacity: numberInRange(
			source.hoverOpacity,
			defaults.hoverOpacity,
			0,
			1,
		),

		gripColor: colorOr(source.gripColor, defaults.gripColor),
		gripSize: integerInRange(source.gripSize, defaults.gripSize, 8, 32),
		gripOpacity: numberInRange(
			source.gripOpacity,
			defaults.gripOpacity,
			0,
			1,
		),
		dropIndicatorColor: colorOr(
			source.dropIndicatorColor,
			defaults.dropIndicatorColor,
		),
		dropIndicatorWidth: integerInRange(
			source.dropIndicatorWidth,
			defaults.dropIndicatorWidth,
			1,
			6,
		),
		dropIndicatorOpacity: numberInRange(
			source.dropIndicatorOpacity,
			defaults.dropIndicatorOpacity,
			0,
			1,
		),
	};
}

function resolveStorage(
	storage?: PromptStyleStorage,
): PromptStyleStorage | undefined {
	if (storage) return storage;
	try {
		const candidate = globalThis.localStorage;
		return candidate ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * Parse one stored payload (versions 2 and 3) into raw settings, applying the
 * version-2 reading-default migration. Null when the payload is unusable.
 */
function readPayload(raw: string | null): Record<string, unknown> | null {
	if (!raw) return null;
	const payload: unknown = JSON.parse(raw);
	if (
		!isRecord(payload) ||
		(payload.version !== 2 && payload.version !== STORAGE_VERSION) ||
		!("settings" in payload)
	) {
		return null;
	}
	// Older saves contain a full snapshot, including the former defaults.
	// Migrate those defaults without discarding unrelated custom settings.
	const settings = isRecord(payload.settings) ? { ...payload.settings } : {};
	if (payload.version === 2) {
		if (settings.fontFamily === "system") settings.fontFamily = DEFAULT_FONT_FAMILY;
		if (settings.fontSize === 13) settings.fontSize = EDITOR_FONT_PX;
		if (settings.lineHeight === 22) settings.lineHeight = LINE_HEIGHT_PX;
		if (settings.contentWidth === 136) settings.contentWidth = 88;
	}
	return settings;
}

/**
 * Load the saved settings. Without an entry under PROMPT_STYLE_STORAGE_KEY,
 * the first load carries the size, density and opacity settings over from
 * PROMPT_STYLE_LEGACY_STORAGE_KEY and drops its colors, so a saved hex never
 * overrides the tokens. The legacy entry is never written or deleted.
 */
export function loadPromptStyleSettings(
	storage?: PromptStyleStorage,
): PromptStyleSettings {
	const target = resolveStorage(storage);
	if (!target) return { ...PROMPT_STYLE_DEFAULTS };

	try {
		const current = target.getItem(PROMPT_STYLE_STORAGE_KEY);
		if (current) {
			return normalizePromptStyleSettings(readPayload(current) ?? {});
		}
		const legacy = readPayload(target.getItem(PROMPT_STYLE_LEGACY_STORAGE_KEY));
		if (!legacy) return { ...PROMPT_STYLE_DEFAULTS };
		for (const key of COLOR_KEYS) delete legacy[key];
		return normalizePromptStyleSettings(legacy);
	} catch {
		return { ...PROMPT_STYLE_DEFAULTS };
	}
}

export function savePromptStyleSettings(
	settings: PromptStyleSettings,
	storage?: PromptStyleStorage,
): void {
	const target = resolveStorage(storage);
	if (!target) return;

	try {
		const normalized = normalizePromptStyleSettings(settings);
		if (
			JSON.stringify(normalized) ===
			JSON.stringify(PROMPT_STYLE_DEFAULTS)
		) {
			// Reset removes the override so application defaults remain the
			// source of truth. While a legacy entry exists, an empty payload
			// stands in for the removal: without it the next load would carry
			// the legacy settings over again and undo the reset.
			if (target.getItem(PROMPT_STYLE_LEGACY_STORAGE_KEY) === null) {
				target.removeItem(PROMPT_STYLE_STORAGE_KEY);
			} else {
				target.setItem(
					PROMPT_STYLE_STORAGE_KEY,
					JSON.stringify({ version: STORAGE_VERSION, settings: {} }),
				);
			}
			return;
		}
		target.setItem(
			PROMPT_STYLE_STORAGE_KEY,
			JSON.stringify({ version: STORAGE_VERSION, settings: normalized }),
		);
	} catch {
		// Private browsing/security settings can reject storage writes. Styling
		// remains usable for the current session, so persistence is best-effort.
	}
}

/** Graded blank-line height: ramp 0 collapses every gap to one line-height. */
function gapHeight(
	lineHeight: number,
	extraPx: number,
	ramp: number,
): number {
	return Math.round((lineHeight + extraPx * ramp) * 2) / 2;
}

function hexWithOpacity(color: string, opacity: number): string {
	const red = Number.parseInt(color.slice(1, 3), 16);
	const green = Number.parseInt(color.slice(3, 5), 16);
	const blue = Number.parseInt(color.slice(5, 7), 16);
	return `rgb(${red} ${green} ${blue} / ${opacity})`;
}

/**
 * Project a complete settings value onto a prompt-surface root. Every color
 * is emitted as its theme value (PROMPT_STYLE_COLOR_TOKENS): a host-contract
 * `--editor-*` name, then the design-system token. While SHOW_COLOR_CONTROLS
 * is off, saved picks never paint. With it on, a saved pick overrides the
 * theme value unless followTheme is set; following the theme leaves saved
 * colors untouched and retains layout settings. Opacity settings always
 * apply: a wash is its theme color at the setting's opacity.
 */
export function promptStyleVars(
	settings: PromptStyleSettings,
	options: { followTheme?: boolean } = {},
): CSSProperties {
	const value = normalizePromptStyleSettings(settings);
	const picked = (key: ColorKey): string | null =>
		SHOW_COLOR_CONTROLS && !options.followTheme && value[key] !== ""
			? value[key]
			: null;
	const color = (key: ColorKey): string =>
		picked(key) ?? PROMPT_STYLE_COLOR_TOKENS[key];
	const alpha = (
		key: ColorKey,
		opacityKey: keyof PromptStyleSettings,
	): string => {
		const opacity = Number(value[opacityKey]);
		// A zero-opacity wash is transparent whatever its color, also in a host
		// that has not loaded tokens.css yet (where the mix would be invalid and
		// the consumer's literal fallback would paint instead).
		if (opacity === 0) return "transparent";
		const pick = picked(key);
		return pick === null
			? `color-mix(in srgb, ${PROMPT_STYLE_COLOR_TOKENS[key]} ${opacity * 100}%, transparent)`
			: hexWithOpacity(pick, opacity);
	};

	return {
		"--prompt-editor-font-family": FONT_STACKS[value.fontFamily],
		"--prompt-editor-font-size": `${value.fontSize}px`,
		"--prompt-editor-line-height": `${value.lineHeight}px`,
		"--prompt-editor-letter-spacing": `${value.letterSpacing}em`,
		"--prompt-editor-indent-width": `${value.indentWidth}px`,
		"--prompt-editor-content-width": `${value.contentWidth}ch`,
		"--prompt-editor-margin-left": `${value.marginLeft}px`,
		"--prompt-editor-margin-top": `${value.marginTop}px`,
		"--prompt-editor-panel-right": `${value.panelInset}px`,
		"--prompt-editor-composer-width": `${value.composerWidth}px`,
		// The gutter is the collapsed affordance rail — line numbers retired
		// with the preset system (2026-08-04 audit). Every gutter consumer
		// (row gutter, indent guides, drop indicator, grip cluster) reads this
		// one variable, so geometry stays consistent.
		"--prompt-editor-gutter-width": PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH,
		"--prompt-editor-show-guides": value.showGuides ? "1" : "0",
		"--prompt-editor-guides-display": value.showGuides ? "block" : "none",

		"--prompt-editor-bg": color("surfaceColor"),
		"--prompt-editor-fg": color("foregroundColor"),
		"--prompt-editor-gutter-bg": color("gutterColor"),
		"--prompt-editor-line-number": color("lineNumberColor"),
		"--prompt-editor-line-number-active": color("activeLineNumberColor"),

		"--prompt-editor-syntax-punctuation": color("tagPunctuationColor"),
		"--prompt-editor-syntax-tag": color("tagNameColor"),
		"--prompt-editor-syntax-tag-landmark": color("tagLandmarkColor"),
		"--prompt-editor-syntax-tag-sublandmark": color("tagSublandmarkColor"),
		"--prompt-editor-syntax-attribute": color("attributeNameColor"),
		"--prompt-editor-syntax-value": color("attributeValueColor"),
		"--prompt-editor-syntax-variable": color("variableColor"),
		"--prompt-editor-syntax-reference": color("referenceColor"),
		"--prompt-editor-syntax-list-marker": color("listMarkerColor"),
		"--prompt-editor-inline-code": color("inlineCodeColor"),
		"--prompt-editor-inline-chip-opacity": String(value.inlineChipOpacity),
		"--prompt-editor-inline-chip-bg": alpha("inlineCodeColor", "inlineChipOpacity"),
		"--prompt-editor-landmark-font-scale": String(value.landmarkFontScale),
		"--prompt-editor-gap-height-base": `${value.lineHeight}px`,
		"--prompt-editor-gap-height-sub": `${gapHeight(
			value.lineHeight,
			32,
			value.gapRamp,
		)}px`,
		"--prompt-editor-gap-height-top": `${gapHeight(
			value.lineHeight,
			64,
			value.gapRamp,
		)}px`,
		"--prompt-editor-landmark-pad": `${Math.round(8 * value.gapRamp)}px`,

		"--prompt-editor-guide-color": color("guideColor"),
		"--prompt-editor-guide-opacity": String(value.guideOpacity),
		"--prompt-editor-guide": alpha("guideColor", "guideOpacity"),
		"--prompt-editor-landmark-color": color("landmarkColor"),
		"--prompt-editor-landmark-opacity": String(value.landmarkOpacity),
		"--prompt-editor-landmark": alpha("landmarkColor", "landmarkOpacity"),

		"--prompt-editor-selection-color": color("selectionColor"),
		"--prompt-editor-selection-opacity": String(value.selectionOpacity),
		"--prompt-editor-selection-bg": alpha("selectionColor", "selectionOpacity"),
		"--prompt-editor-selection-accent": color("selectionAccentColor"),
		"--prompt-editor-active-line-color": color("activeLineColor"),
		"--prompt-editor-active-line-opacity": String(value.activeLineOpacity),
		"--prompt-editor-active-line-bg": alpha("activeLineColor", "activeLineOpacity"),
		"--prompt-editor-hover-color": color("hoverColor"),
		"--prompt-editor-hover-opacity": String(value.hoverOpacity),
		"--prompt-editor-hover-bg": alpha("hoverColor", "hoverOpacity"),

		"--prompt-editor-grip-color": color("gripColor"),
		"--prompt-editor-grip-size": `${value.gripSize}px`,
		"--prompt-editor-grip-opacity": String(value.gripOpacity),
		"--prompt-editor-grip": alpha("gripColor", "gripOpacity"),
		"--prompt-editor-drop-line-color": color("dropIndicatorColor"),
		"--prompt-editor-drop-line-width": `${value.dropIndicatorWidth}px`,
		"--prompt-editor-drop-line-opacity": String(
			value.dropIndicatorOpacity,
		),
		"--prompt-editor-drop-line": alpha("dropIndicatorColor", "dropIndicatorOpacity"),

		...PROMPT_THEME_VARS,
	} as CSSProperties;
}

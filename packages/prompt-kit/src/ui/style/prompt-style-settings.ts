import type { CSSProperties } from "react";

import { PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH } from "../surface/editor-surface";

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

export const PROMPT_STYLE_STORAGE_KEY = "agentKernel.promptEditorStyle.v2";

const STORAGE_VERSION = 3;

const FONT_STACKS: Record<PromptMonoFontFamily, string> = {
	sans: "ui-sans-serif, system-ui, sans-serif",
	system:
		'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
	"sf-mono":
		'"SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace',
	"jetbrains-mono":
		'"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
	"ibm-plex-mono":
		'"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};

// Document typography follows Docs System: sans-serif prose, larger text,
// generous leading, and a shorter reading measure. Hosts supply theme colors.
const BASE_SETTINGS: PromptStyleSettings = {
	fontFamily: "sans",
	fontSize: 15,
	lineHeight: 26,
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

	surfaceColor: "#1E1E1E",
	foregroundColor: "#D4D6D3",
	gutterColor: "#1E1E1E",
	lineNumberColor: "#5F6672",
	activeLineNumberColor: "#C6CCD2",

	// The "painted landmarks" palette: one purple family for structure, with
	// hierarchy carried by brightness.
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
	guideOpacity: 0.18,
	landmarkColor: "#FFFFFF",
	// Off by default: landmark rows already read as landmarks from the larger
	// tag type and band padding; the full-width wash competes with selection
	// and hover paint. The slider keeps the wash available.
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
	return typeof value === "string" &&
		FONT_FAMILIES.has(value as PromptMonoFontFamily)
		? (value as PromptMonoFontFamily)
		: fallback;
}

/**
 * Accept #RGB and #RRGGBB input and always return canonical uppercase
 * #RRGGBB. Alpha is kept in separate numeric settings so color pickers can
 * round-trip every color value.
 */
function colorOr(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
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

export function loadPromptStyleSettings(
	storage?: PromptStyleStorage,
): PromptStyleSettings {
	const target = resolveStorage(storage);
	if (!target) return { ...PROMPT_STYLE_DEFAULTS };

	try {
		const raw = target.getItem(PROMPT_STYLE_STORAGE_KEY);
		if (!raw) return { ...PROMPT_STYLE_DEFAULTS };
		const payload: unknown = JSON.parse(raw);
		if (
			!isRecord(payload) ||
			(payload.version !== 2 && payload.version !== STORAGE_VERSION) ||
			!("settings" in payload)
		) {
			return { ...PROMPT_STYLE_DEFAULTS };
		}
		// Older saves contain a full snapshot, including the former defaults.
		// Migrate those defaults without discarding unrelated custom settings.
		const settings = isRecord(payload.settings) ? { ...payload.settings } : {};
		if (payload.version === 2) {
			if (settings.fontFamily === "system") settings.fontFamily = "sans";
			if (settings.fontSize === 13) settings.fontSize = 15;
			if (settings.lineHeight === 22) settings.lineHeight = 26;
			if (settings.contentWidth === 136) settings.contentWidth = 88;
		}
		return normalizePromptStyleSettings(settings);
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
			// source of truth.
			target.removeItem(PROMPT_STYLE_STORAGE_KEY);
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
 * Project a complete settings value onto a prompt-surface root. Defaults are
 * emitted as host-theme references with dark fallbacks. Customized colors stay
 * local to this editor and override the host theme unless followTheme is set.
 * Following the theme leaves saved colors untouched and retains layout settings.
 */
export function promptStyleVars(
	settings: PromptStyleSettings,
	options: { followTheme?: boolean } = {},
): CSSProperties {
	const value = normalizePromptStyleSettings(settings);
	const color = (key: keyof PromptStyleSettings, token: string): string =>
		options.followTheme || value[key] === PROMPT_STYLE_DEFAULTS[key]
			? `var(--editor-${token}, ${PROMPT_STYLE_DEFAULTS[key]})`
			: String(value[key]);
	const alpha = (
		key: keyof PromptStyleSettings,
		opacityKey: keyof PromptStyleSettings,
		token: string,
	): string => {
		const fallback = hexWithOpacity(String(value[key]), Number(value[opacityKey]));
		return options.followTheme || value[key] === PROMPT_STYLE_DEFAULTS[key]
			? `color-mix(in srgb, ${color(key, token)} ${Number(value[opacityKey]) * 100}%, transparent)`
			: fallback;
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

		"--prompt-editor-bg": color("surfaceColor", "bg"),
		"--prompt-editor-fg": color("foregroundColor", "fg"),
		"--prompt-editor-gutter-bg": color("gutterColor", "gutter-bg"),
		"--prompt-editor-line-number": color("lineNumberColor", "line-number"),
		"--prompt-editor-line-number-active": color("activeLineNumberColor", "line-number-active"),

		"--prompt-editor-syntax-punctuation": color("tagPunctuationColor", "syntax-punctuation"),
		"--prompt-editor-syntax-tag": color("tagNameColor", "syntax-tag"),
		"--prompt-editor-syntax-tag-landmark": color("tagLandmarkColor", "syntax-tag-landmark"),
		"--prompt-editor-syntax-tag-sublandmark": color("tagSublandmarkColor", "syntax-tag-sublandmark"),
		"--prompt-editor-syntax-attribute": color("attributeNameColor", "syntax-attribute"),
		"--prompt-editor-syntax-value": color("attributeValueColor", "syntax-value"),
		"--prompt-editor-syntax-variable": color("variableColor", "syntax-variable"),
		"--prompt-editor-syntax-reference": color("referenceColor", "syntax-reference"),
		"--prompt-editor-syntax-list-marker": color("listMarkerColor", "syntax-list-marker"),
		"--prompt-editor-inline-code": color("inlineCodeColor", "inline-code"),
		"--prompt-editor-inline-chip-opacity": String(value.inlineChipOpacity),
		"--prompt-editor-inline-chip-bg": alpha("inlineCodeColor", "inlineChipOpacity", "inline-code"),
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

		"--prompt-editor-guide-color": color("guideColor", "guide-color"),
		"--prompt-editor-guide-opacity": String(value.guideOpacity),
		"--prompt-editor-guide": alpha("guideColor", "guideOpacity", "guide-color"),
		"--prompt-editor-landmark-color": color("landmarkColor", "landmark-color"),
		"--prompt-editor-landmark-opacity": String(value.landmarkOpacity),
		"--prompt-editor-landmark": alpha("landmarkColor", "landmarkOpacity", "landmark-color"),

		"--prompt-editor-selection-color": color("selectionColor", "selection-color"),
		"--prompt-editor-selection-opacity": String(value.selectionOpacity),
		"--prompt-editor-selection-bg": alpha("selectionColor", "selectionOpacity", "selection-color"),
		"--prompt-editor-selection-accent": color("selectionAccentColor", "selection-accent"),
		"--prompt-editor-active-line-color": color("activeLineColor", "active-line-color"),
		"--prompt-editor-active-line-opacity": String(value.activeLineOpacity),
		"--prompt-editor-active-line-bg": alpha("activeLineColor", "activeLineOpacity", "active-line-color"),
		"--prompt-editor-hover-color": color("hoverColor", "hover-color"),
		"--prompt-editor-hover-opacity": String(value.hoverOpacity),
		"--prompt-editor-hover-bg": alpha("hoverColor", "hoverOpacity", "hover-color"),

		"--prompt-editor-grip-color": color("gripColor", "grip-color"),
		"--prompt-editor-grip-size": `${value.gripSize}px`,
		"--prompt-editor-grip-opacity": String(value.gripOpacity),
		"--prompt-editor-grip": alpha("gripColor", "gripOpacity", "grip-color"),
		"--prompt-editor-drop-line-color": color("dropIndicatorColor", "drop-line-color"),
		"--prompt-editor-drop-line-width": `${value.dropIndicatorWidth}px`,
		"--prompt-editor-drop-line-opacity": String(
			value.dropIndicatorOpacity,
		),
		"--prompt-editor-drop-line": alpha("dropIndicatorColor", "dropIndicatorOpacity", "drop-line-color"),
	} as CSSProperties;
}

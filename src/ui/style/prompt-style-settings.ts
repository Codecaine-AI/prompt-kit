import type { CSSProperties } from "react";

import { PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH } from "../surface/editor-surface";

export type PromptMonoFontFamily =
	| "system"
	| "sf-mono"
	| "jetbrains-mono"
	| "ibm-plex-mono";

export type PromptStylePresetId =
	| "dense"
	| "balanced"
	| "reading"
	| "painted"
	| "classic";
export type PromptRowShading = "none" | "rules" | "zebra";

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
	gutterWidth: number;
	landmarkFontScale: number;
	gapRamp: number;

	showLineNumbers: boolean;
	showGuides: boolean;
	rowShading: PromptRowShading;

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
	ruleColor: string;
	ruleOpacity: number;
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

export const PROMPT_STYLE_STORAGE_KEY = "agentKernel.promptEditorStyle.v1";

const STORAGE_VERSION = 2;

const FONT_STACKS: Record<PromptMonoFontFamily, string> = {
	system:
		'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
	"sf-mono":
		'"SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace',
	"jetbrains-mono":
		'"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
	"ibm-plex-mono":
		'"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};

const BALANCED_SETTINGS: PromptStyleSettings = {
	fontFamily: "system",
	fontSize: 13,
	lineHeight: 22,
	letterSpacing: 0,
	indentWidth: 20,
	// Wide enough to use the pane at large window sizes: at ~2000px the text
	// column would otherwise stop well short of the inspector and the prose
	// would wrap far more than it needs to.
	contentWidth: 136,
	gutterWidth: 56,
	landmarkFontScale: 1.08,
	gapRamp: 1,

	// Off by default: the flow renders a structured document, not source code.
	// Node ids, targeting rings, and quoted ranges are the address system;
	// numbers are a competing code-editor affordance that eats the left edge
	// and crowds the drag grip. Their one legitimate use — correlating with
	// the Raw view line-for-line (the xml-line-model invariant) — stays
	// available behind this toggle.
	showLineNumbers: false,
	showGuides: true,
	rowShading: "none",

	surfaceColor: "#1E1E1E",
	foregroundColor: "#D4D6D3",
	gutterColor: "#1E1E1E",
	lineNumberColor: "#454A51",
	activeLineNumberColor: "#C6CCD2",

	tagPunctuationColor: "#4B5057",
	tagNameColor: "#9D8AAF",
	tagLandmarkColor: "#BC9AD3",
	tagSublandmarkColor: "#A992BE",
	attributeNameColor: "#85AECB",
	attributeValueColor: "#AB8E70",
	variableColor: "#D9C578",
	referenceColor: "#58A794",
	inlineCodeColor: "#5FBCA5",
	inlineChipOpacity: 0.08,
	listMarkerColor: "#565C64",

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
	gripSize: 20,
	gripOpacity: 0.5,
	dropIndicatorColor: "#4D9DE0",
	dropIndicatorWidth: 2,
	dropIndicatorOpacity: 0.95,
};

function withPresetOverrides(
	overrides: Partial<PromptStyleSettings>,
): PromptStyleSettings {
	return { ...BALANCED_SETTINGS, ...overrides };
}

/**
 * Complete presets let consumers switch atomically with every presentation
 * field defined by the selected preset.
 */
export const PROMPT_STYLE_PRESETS: Readonly<
	Record<PromptStylePresetId, Readonly<PromptStyleSettings>>
> = {
	dense: withPresetOverrides({
		fontSize: 12,
		lineHeight: 18,
		letterSpacing: -0.01,
		indentWidth: 16,
		// `ch` scales with font size, so dense needs proportionally MORE columns
		// than balanced to stay at least as wide on screen (136 × 13/12).
		contentWidth: 148,
		gutterWidth: 48,
		rowShading: "rules",
		ruleOpacity: 0.05,
	}),
	balanced: { ...BALANCED_SETTINGS },
	reading: withPresetOverrides({
		fontSize: 14.5,
		lineHeight: 25,
		letterSpacing: 0.01,
		indentWidth: 24,
		contentWidth: 88,
		gutterWidth: 60,
		rowShading: "none",
		ruleOpacity: 0.025,
	}),
	// The full syntax palette from the "painted landmarks" exploration: one
	// purple family for structure with hierarchy carried by brightness.
	painted: withPresetOverrides({
		foregroundColor: "#D4D6D3",
		tagPunctuationColor: "#6E7681",
		tagNameColor: "#9A7CAC",
		tagLandmarkColor: "#CBA6DE",
		tagSublandmarkColor: "#B48EC7",
		attributeNameColor: "#85AECB",
		attributeValueColor: "#C09A78",
		variableColor: "#CFBC74",
		listMarkerColor: "#6C737B",
		lineNumberColor: "#5F6672",
	}),
	// The surface exactly as it looked before the landmark redesign: every
	// new capability sits at its neutral value — including the code-editor
	// line-number gutter, which the classic look always carried.
	classic: withPresetOverrides({
		showLineNumbers: true,
		rowShading: "zebra",
		foregroundColor: "#E4E4E2",
		lineNumberColor: "#5F6672",
		tagPunctuationColor: "#6E7681",
		tagNameColor: "#B48EC7",
		tagLandmarkColor: "#B48EC7",
		tagSublandmarkColor: "#B48EC7",
		attributeValueColor: "#C09A78",
		referenceColor: "#5FBCA5",
		inlineCodeColor: "#E4E4E2",
		inlineChipOpacity: 0,
		listMarkerColor: "#7E8590",
		landmarkFontScale: 1,
		gapRamp: 0,
	}),
};

/**
 * The application default is a complete value, not a patch. Resetting means
 * removing persisted overrides and returning this object.
 */
export const PROMPT_STYLE_DEFAULTS: Readonly<PromptStyleSettings> =
	PROMPT_STYLE_PRESETS.balanced;

const FONT_FAMILIES = new Set<PromptMonoFontFamily>([
	"system",
	"sf-mono",
	"jetbrains-mono",
	"ibm-plex-mono",
]);
const ROW_SHADING_MODES = new Set<PromptRowShading>([
	"none",
	"rules",
	"zebra",
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

function rowShadingOr(
	value: unknown,
	legacyShowRules: unknown,
	fallback: PromptRowShading,
): PromptRowShading {
	if (
		typeof value === "string" &&
		ROW_SHADING_MODES.has(value as PromptRowShading)
	) {
		return value as PromptRowShading;
	}
	if (typeof legacyShowRules === "boolean") {
		return legacyShowRules ? "rules" : "none";
	}
	return fallback;
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
		gutterWidth: integerInRange(
			source.gutterWidth,
			defaults.gutterWidth,
			36,
			96,
		),
		landmarkFontScale: numberInRange(
			source.landmarkFontScale,
			defaults.landmarkFontScale,
			1,
			1.2,
		),
		gapRamp: numberInRange(source.gapRamp, defaults.gapRamp, 0, 1),

		showLineNumbers: booleanOr(
			source.showLineNumbers,
			defaults.showLineNumbers,
		),
		showGuides: booleanOr(source.showGuides, defaults.showGuides),
		rowShading: rowShadingOr(
			source.rowShading,
			source.showRules,
			defaults.rowShading,
		),

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
		ruleColor: colorOr(source.ruleColor, defaults.ruleColor),
		ruleOpacity: numberInRange(
			source.ruleOpacity,
			defaults.ruleOpacity,
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
			payload.version !== STORAGE_VERSION ||
			!("settings" in payload)
		) {
			return { ...PROMPT_STYLE_DEFAULTS };
		}
		return normalizePromptStyleSettings(payload.settings);
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
 * deliberately emitted too: the settings contract is the single source of
 * truth, while the variables stay scoped to the prompt editor rather than
 * recoloring the entire host application.
 */
export function promptStyleVars(settings: PromptStyleSettings): CSSProperties {
	const value = normalizePromptStyleSettings(settings);

	return {
		"--prompt-editor-font-family": FONT_STACKS[value.fontFamily],
		"--prompt-editor-font-size": `${value.fontSize}px`,
		"--prompt-editor-line-height": `${value.lineHeight}px`,
		"--prompt-editor-letter-spacing": `${value.letterSpacing}em`,
		"--prompt-editor-indent-width": `${value.indentWidth}px`,
		"--prompt-editor-content-width": `${value.contentWidth}ch`,
		// With numbers off the gutter collapses to what the drag grip and block
		// affordances actually need; the content's left edge moves left with it.
		// Every gutter consumer (row gutter, indent guides, drop indicator,
		// grip cluster) reads this one variable, so geometry stays consistent.
		"--prompt-editor-gutter-width": value.showLineNumbers
			? `${value.gutterWidth}px`
			: PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH,
		"--prompt-editor-show-line-numbers": value.showLineNumbers ? "1" : "0",
		"--prompt-editor-show-guides": value.showGuides ? "1" : "0",
		"--prompt-editor-show-rules": value.rowShading === "rules" ? "1" : "0",
		"--prompt-editor-show-zebra": value.rowShading === "zebra" ? "1" : "0",
		"--prompt-editor-line-number-visibility": value.showLineNumbers
			? "visible"
			: "hidden",
		"--prompt-editor-line-numbers-display": value.showLineNumbers
			? "block"
			: "none",
		"--prompt-editor-guides-display": value.showGuides ? "block" : "none",
		"--prompt-editor-rules-display":
			value.rowShading === "rules" ? "block" : "none",
		"--prompt-editor-zebra-display":
			value.rowShading === "zebra" ? "block" : "none",

		"--prompt-editor-bg": value.surfaceColor,
		"--prompt-editor-fg": value.foregroundColor,
		"--prompt-editor-gutter-bg": value.gutterColor,
		"--prompt-editor-line-number": value.lineNumberColor,
		"--prompt-editor-line-number-active": value.activeLineNumberColor,

		"--prompt-editor-syntax-punctuation": value.tagPunctuationColor,
		"--prompt-editor-syntax-tag": value.tagNameColor,
		"--prompt-editor-syntax-tag-landmark": value.tagLandmarkColor,
		"--prompt-editor-syntax-tag-sublandmark": value.tagSublandmarkColor,
		"--prompt-editor-syntax-attribute": value.attributeNameColor,
		"--prompt-editor-syntax-value": value.attributeValueColor,
		"--prompt-editor-syntax-variable": value.variableColor,
		"--prompt-editor-syntax-reference": value.referenceColor,
		"--prompt-editor-syntax-list-marker": value.listMarkerColor,
		"--prompt-editor-inline-code": value.inlineCodeColor,
		"--prompt-editor-inline-chip-opacity": String(value.inlineChipOpacity),
		"--prompt-editor-inline-chip-bg": hexWithOpacity(
			value.inlineCodeColor,
			value.inlineChipOpacity,
		),
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

		"--prompt-editor-guide-color": value.guideColor,
		"--prompt-editor-guide-opacity": String(value.guideOpacity),
		"--prompt-editor-guide": hexWithOpacity(
			value.guideColor,
			value.guideOpacity,
		),
		"--prompt-editor-rule-color": value.ruleColor,
		"--prompt-editor-rule-opacity": String(value.ruleOpacity),
		"--prompt-editor-rule": hexWithOpacity(
			value.ruleColor,
			value.ruleOpacity,
		),
		"--prompt-editor-landmark-color": value.landmarkColor,
		"--prompt-editor-landmark-opacity": String(value.landmarkOpacity),
		"--prompt-editor-landmark": hexWithOpacity(
			value.landmarkColor,
			value.landmarkOpacity,
		),

		"--prompt-editor-selection-color": value.selectionColor,
		"--prompt-editor-selection-opacity": String(value.selectionOpacity),
		"--prompt-editor-selection-bg": hexWithOpacity(
			value.selectionColor,
			value.selectionOpacity,
		),
		"--prompt-editor-selection-accent": value.selectionAccentColor,
		"--prompt-editor-active-line-color": value.activeLineColor,
		"--prompt-editor-active-line-opacity": String(value.activeLineOpacity),
		"--prompt-editor-active-line-bg": hexWithOpacity(
			value.activeLineColor,
			value.activeLineOpacity,
		),
		"--prompt-editor-hover-color": value.hoverColor,
		"--prompt-editor-hover-opacity": String(value.hoverOpacity),
		"--prompt-editor-hover-bg": hexWithOpacity(
			value.hoverColor,
			value.hoverOpacity,
		),

		"--prompt-editor-grip-color": value.gripColor,
		"--prompt-editor-grip-size": `${value.gripSize}px`,
		"--prompt-editor-grip-opacity": String(value.gripOpacity),
		"--prompt-editor-grip": hexWithOpacity(
			value.gripColor,
			value.gripOpacity,
		),
		"--prompt-editor-drop-line-color": value.dropIndicatorColor,
		"--prompt-editor-drop-line-width": `${value.dropIndicatorWidth}px`,
		"--prompt-editor-drop-line-opacity": String(
			value.dropIndicatorOpacity,
		),
		"--prompt-editor-drop-line": hexWithOpacity(
			value.dropIndicatorColor,
			value.dropIndicatorOpacity,
		),
	} as CSSProperties;
}

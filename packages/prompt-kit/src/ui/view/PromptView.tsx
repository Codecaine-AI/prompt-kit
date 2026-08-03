"use client";

import { useMemo } from "react";
import cn from "classnames";

import {
	loadPromptStyleSettings,
	promptStyleVars,
} from "../style/prompt-style-settings";
import {
	EDITOR_COLORS,
	EDITOR_METRICS,
	PROMPT_EDITOR_ROOT_CLASS,
	editorRuleBackground,
	promptEditorGutterWidth,
	promptEditorIndentForDepth,
	promptEditorIndentForSpaces,
	promptEditorZebraBackground,
} from "../surface/editor-surface";
import { highlightXmlLine } from "../surface/xml-highlight";
import {
	classifyRenderedLines,
	type RenderedLineInfo,
} from "./rendered-line-model";

export type PromptViewSize = "sm" | "md" | "lg";

/** Visual width of a line's leading whitespace (0px when none). */
function lineIndent(line: string): string {
	const leading = line.match(/^ */)?.[0].length ?? 0;
	return promptEditorIndentForSpaces(leading);
}

/** Base padding before the indent area of a content cell. */
const CONTENT_CELL_PAD = "0.75rem";

/**
 * Guide stripe ink, gated by the same numeric show-guides token the style
 * rail projects (defaults on, matching the editable surface's guides).
 */
const GUIDE_STRIPE = `color-mix(in srgb, ${EDITOR_COLORS.guide} calc(var(--prompt-editor-show-guides, 1) * 100%), transparent)`;

/**
 * Indent guides for one row: a 1px vertical stripe per ENCLOSING container,
 * painted as background layers on the content cell. Rendered prompts indent
 * four spaces per level and the surface maps two spaces to one indent width,
 * so the container at level k opened its tag — and owns its guide — at
 * k × 2 × indentWidth into the indent area. A row at depth d sits inside the
 * containers at levels 0..d-1, so its stripes land at those columns: the
 * first guide runs under the top-level tag itself, and no stripe ever touches
 * the row's own first glyph.
 */
function guideBackground(depth: number): React.CSSProperties | undefined {
	if (depth <= 0) return undefined;
	const images: string[] = [];
	const positions: string[] = [];
	for (let level = 0; level < depth; level++) {
		images.push(`linear-gradient(${GUIDE_STRIPE}, ${GUIDE_STRIPE})`);
		positions.push(
			`calc(${CONTENT_CELL_PAD} + ${promptEditorIndentForDepth(2 * level)}) 0`,
		);
	}
	return {
		backgroundImage: images.join(", "),
		backgroundPosition: positions.join(", "),
		backgroundSize: "1px 100%",
		backgroundRepeat: "no-repeat",
	};
}

/**
 * Blank-line row height. Big seams mark where a SECTION starts, nothing else:
 * only a gap that directly precedes an open tag takes a tiered height — the
 * full chapter break before a top-level open, roughly half before a depth-1
 * one. Every other blank line (paragraph breaks, gaps before closes or
 * deeper opens) stays one line tall.
 */
function gapRowHeight(info: RenderedLineInfo): string {
	if (info.gapBeforeOpenDepth === 0) return EDITOR_METRICS.gapHeightTop;
	if (info.gapBeforeOpenDepth === 1) return EDITOR_METRICS.gapHeightSub;
	return EDITOR_METRICS.gapHeightBase;
}

/**
 * Row-scoped variable overrides for structural roles. Top-level open tags
 * read as landmarks (tint plus the clearest purple) and second-level ones as
 * sub-landmarks; each close tag mirrors its opener's tier color — brackets
 * included — so a section ends in the same ink it started with. Overriding
 * the syntax vars on the row keeps xml-highlight untouched — its spans
 * consume the same variables.
 */
function rowRoleStyle(
	info: RenderedLineInfo | undefined,
): React.CSSProperties | undefined {
	if (!info) return undefined;
	if (info.role === "close") {
		if (info.depth === 0) {
			return {
				"--prompt-editor-syntax-tag": EDITOR_COLORS.syntaxTagLandmark,
				"--prompt-editor-syntax-punctuation":
					EDITOR_COLORS.syntaxTagLandmark,
			} as React.CSSProperties;
		}
		if (info.depth === 1) {
			return {
				"--prompt-editor-syntax-tag": EDITOR_COLORS.syntaxTagSublandmark,
				"--prompt-editor-syntax-punctuation":
					EDITOR_COLORS.syntaxTagSublandmark,
			} as React.CSSProperties;
		}
		// Deeper closes match their openers by simply using the stock tag ink.
		return undefined;
	}
	if (info.role === "open" && info.depth === 0) {
		return {
			"--prompt-editor-syntax-tag": EDITOR_COLORS.syntaxTagLandmark,
			// The landmark wash the editable surface paints on section starts.
			backgroundColor: EDITOR_COLORS.landmark,
		} as React.CSSProperties;
	}
	if (info.role === "open" && info.depth === 1) {
		return {
			"--prompt-editor-syntax-tag": EDITOR_COLORS.syntaxTagSublandmark,
		} as React.CSSProperties;
	}
	if (info.role === "gap") {
		return { height: gapRowHeight(info) };
	}
	return undefined;
}

const PROMPT_VIEW_SIZE: Record<
	PromptViewSize,
	{ fontSize: string; lineHeight: string }
> = {
	sm: { fontSize: "13px", lineHeight: "21px" },
	md: { fontSize: "14px", lineHeight: "20px" },
	lg: { fontSize: "16px", lineHeight: "24px" },
};

export function PromptView({
	content,
	title,
	bare = false,
	startLine = 1,
	size = "sm",
	inheritStyle = false,
}: {
	content: string | null;
	title: string;
	/** Render without the outer rounded/background container, for nesting inside a bordered host (e.g. a file card). */
	bare?: boolean;
	/** Line number to show on the first row. Defaults to 1. Use to continue numbering across split chunks. */
	startLine?: number;
	/** Text size for the prompt body. Defaults to "sm" (extra-small). */
	size?: PromptViewSize;
	/**
	 * Inherit `--prompt-editor-*` variables from an ancestor surface instead of
	 * applying the persisted style settings locally. Hosts that already project
	 * live style vars (e.g. the prompt lab) pass true so rail changes apply
	 * without a remount.
	 */
	inheritStyle?: boolean;
}) {
	const lines = useMemo(() => (content ? content.split("\n") : []), [content]);
	const lineInfos = useMemo(
		() => (content ? classifyRenderedLines(content) : []),
		[content],
	);
	const lastLine = startLine + Math.max(0, lines.length - 1);
	const lineNumberWidth = useMemo(() => Math.max(2, String(lastLine).length), [lastLine]);
	const fallbackGutterWidth = `${lineNumberWidth + 2}ch`;
	const gutterWidth = promptEditorGutterWidth(fallbackGutterWidth);
	const typeSize = PROMPT_VIEW_SIZE[size];
	const persistedStyleVars = useMemo(
		() => (inheritStyle ? undefined : promptStyleVars(loadPromptStyleSettings())),
		[inheritStyle],
	);

	if (!content) {
		return (
			<div
				className={cn(PROMPT_EDITOR_ROOT_CLASS, "p-4 text-sm text-muted-foreground")}
				style={persistedStyleVars}
			>
				No {title.toLowerCase()} available
			</div>
		);
	}

	return (
		<div
			className={cn(PROMPT_EDITOR_ROOT_CLASS, "relative w-full overflow-hidden")}
			style={persistedStyleVars}
		>
			<div
				className={cn("w-full overflow-auto", bare ? undefined : "rounded-[3px]")}
				style={{
					backgroundColor: EDITOR_COLORS.bg,
					color: EDITOR_COLORS.fg,
					...editorRuleBackground,
				}}
			>
				<table
					className="w-full table-auto border-separate border-spacing-0"
					style={{
						fontFamily: EDITOR_METRICS.fontFamily,
						fontSize: `var(--prompt-editor-font-size, ${typeSize.fontSize})`,
						lineHeight: `var(--prompt-editor-line-height, ${typeSize.lineHeight})`,
						letterSpacing: EDITOR_METRICS.letterSpacing,
						maxWidth: EDITOR_METRICS.contentWidth,
					}}
				>
					<tbody>
						{lines.map((line, index) => {
							const info = lineInfos[index];
							const isLandmark =
								info?.role === "open" && info.depth === 0;
							return (
							<tr
								key={index}
								className="prompt-editor-row"
								// Scroll anchor: a host with a wayfinding column (the lab's
								// CONTEXT surface) addresses a row by its zero-based line index.
								// Attribute only — nothing styles off it.
								data-prompt-row={index}
								style={{
									"--prompt-editor-row-zebra":
										promptEditorZebraBackground(index),
									...rowRoleStyle(info),
								} as React.CSSProperties}
							>
								<td
									className="sticky left-0 select-none px-3 text-right align-top tabular-nums"
									style={{
										minWidth: gutterWidth,
										width: gutterWidth,
										background: "transparent",
										color: EDITOR_COLORS.lineNumber,
										// Landmark band: both cells share the block padding so
										// the row grows into a tinted band around the open tag.
										...(isLandmark
											? { paddingBlock: EDITOR_METRICS.landmarkPad }
											: undefined),
									}}
								>
									<span
										style={{
											visibility:
												"var(--prompt-editor-line-number-visibility, visible)" as React.CSSProperties["visibility"],
											display:
												"var(--prompt-editor-line-numbers-display, block)",
										}}
									>
										{startLine + index}
									</span>
								</td>
								<td
									className="w-full pr-4"
									style={{
										backgroundColor: "transparent",
										whiteSpace: "pre-wrap",
										wordBreak: "break-word",
										// Hanging indent: continuation lines of a wrapped row
										// align under the line's content start. paddingLeft
										// holds the leading whitespace's visual width;
										// text-indent pulls the first line back to flush. The
										// leading spaces stay real text in the DOM, so
										// copy/paste is unchanged.
										paddingLeft: `calc(${CONTENT_CELL_PAD} + ${lineIndent(line)})`,
										textIndent: `calc(0px - ${lineIndent(line)})`,
										// Landmark rows read a notch larger; line-height stays
										// the shared px token so the gutter keeps its rhythm.
										// The band padding matches the gutter cell's, keeping
										// number and tag on one baseline inside the band.
										...(isLandmark
											? {
													fontSize: `calc(var(--prompt-editor-font-size, ${typeSize.fontSize}) * ${EDITOR_METRICS.landmarkFontScale})`,
													paddingBlock: EDITOR_METRICS.landmarkPad,
												}
											: undefined),
										...guideBackground(info?.depth ?? 0),
									}}
								>
									{line ? highlightXmlLine(line) : "\u00A0"}
								</td>
							</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

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
	PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH,
	PROMPT_EDITOR_ROOT_CLASS,
	promptEditorGutterWidth,
	promptEditorIndentForDepth,
} from "../surface/editor-surface";
import { highlightXmlLine } from "../surface/xml-highlight";
import {
	classifyRenderedLines,
	collapseRenderedGapRuns,
	renderedLineBaseSpaces,
	type RenderedLineInfo,
} from "./rendered-line-model";

export type PromptViewSize = "sm" | "md" | "lg";

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
	sm: { fontSize: "13px", lineHeight: "22px" },
	md: { fontSize: "14px", lineHeight: "20px" },
	lg: { fontSize: "16px", lineHeight: "24px" },
};

export function PromptView({
	content,
	title,
	bare = false,
	size = "sm",
	inheritStyle = false,
	rowOffset = 0,
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
	/** Source row offset when rendering one part of a larger context. */
	rowOffset?: number;
}) {
	const lines = useMemo(() => (content ? content.split("\n") : []), [content]);
	const lineInfos = useMemo(
		() => (content ? classifyRenderedLines(content) : []),
		[content],
	);
	const lineBaseSpaces = useMemo(
		() => renderedLineBaseSpaces(lines, lineInfos),
		[lines, lineInfos],
	);
	const displayLines = useMemo(
		() => collapseRenderedGapRuns(lineInfos),
		[lineInfos],
	);
	const gutterWidth = promptEditorGutterWidth(
		PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH,
	);
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
						{displayLines.map(({ sourceIndex: index, info }) => {
							const line = lines[index] ?? "";
							const depth = info?.depth ?? 0;
							const baseSpaces = lineBaseSpaces[index] ?? 0;
							const isLandmark =
								info?.role === "open" && info.depth === 0;
							return (
							<tr
								key={index}
								// Scroll anchor: a host with a wayfinding column (the lab's
								// CONTEXT surface) addresses a row by its zero-based line index.
								// Attribute only — nothing styles off it.
								data-prompt-row={index + rowOffset}
								style={{
									border: 0,
									boxShadow: "none",
									...rowRoleStyle(info),
								} as React.CSSProperties}
							>
								{/* Line numbers retired (2026-08-04 audit): the gutter cell
								    keeps row geometry and the landmark band only. */}
								<td
									className="select-none align-top"
									style={{
										minWidth: gutterWidth,
										width: gutterWidth,
										background: "transparent",
										border: 0,
										boxShadow: "none",
										color: "transparent",
										paddingInline: 0,
										paddingBlock: 0,
										// Landmark band: both cells share the block padding so
										// the row grows into a tinted band around the open tag.
										...(isLandmark
											? { paddingBlock: EDITOR_METRICS.landmarkPad }
											: undefined),
									}}
								/>
								<td
									className="w-full pr-4"
									style={{
										backgroundColor: "transparent",
										border: 0,
										boxShadow: "none",
										whiteSpace: "pre-wrap",
										wordBreak: "break-word",
										paddingBlock: 0,
										// Classifier depth owns the base indent, matching the
										// guide geometry. The shared literal baseline is
										// offset while excess whitespace stays in the text.
										paddingLeft: `calc(${CONTENT_CELL_PAD} + ${promptEditorIndentForDepth(2 * depth)})`,
										textIndent: baseSpaces > 0 ? `-${baseSpaces}ch` : undefined,
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
										...guideBackground(depth),
									}}
								>
									{line ? highlightXmlLine(line) : null}
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

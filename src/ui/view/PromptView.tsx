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
	promptEditorIndentForSpaces,
	promptEditorZebraBackground,
} from "../surface/editor-surface";
import { highlightXmlLine } from "../surface/xml-highlight";

export type PromptViewSize = "sm" | "md" | "lg";

/** Visual width of a line's leading whitespace (0px when none). */
function lineIndent(line: string): string {
	const leading = line.match(/^ */)?.[0].length ?? 0;
	return promptEditorIndentForSpaces(leading);
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
						{lines.map((line, index) => (
							<tr
								key={index}
								className="prompt-editor-row"
								style={{
									"--prompt-editor-row-zebra":
										promptEditorZebraBackground(index),
								} as React.CSSProperties}
							>
								<td
									className="sticky left-0 select-none px-3 text-right align-top tabular-nums"
									style={{
										minWidth: gutterWidth,
										width: gutterWidth,
										background: "transparent",
										color: EDITOR_COLORS.lineNumber,
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
										background: "transparent",
										whiteSpace: "pre-wrap",
										wordBreak: "break-word",
										// Hanging indent: continuation lines of a wrapped row
										// align under the line's content start. paddingLeft
										// holds the leading whitespace's visual width;
										// text-indent pulls the first line back to flush. The
										// leading spaces stay real text in the DOM, so
										// copy/paste is unchanged.
										paddingLeft: `calc(0.75rem + ${lineIndent(line)})`,
										textIndent: `calc(0px - ${lineIndent(line)})`,
									}}
								>
									{line ? highlightXmlLine(line) : "\u00A0"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

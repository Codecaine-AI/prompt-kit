"use client";

/**
 * Single source of truth for XML/Markdown syntax coloring shared by the
 * read-only Raw prompt view and the editable Agent XML flow.
 *
 * Syntax roles are prompt-scoped CSS variables with balanced fallbacks. The
 * leading indentation remains real text in the DOM (so copy/paste and the
 * renderer string are unchanged), while an inline-block gives each two-space
 * nesting level the rail-controlled visual indent width.
 */

import { EDITOR_COLORS, promptEditorIndentForSpaces } from "./editor-surface";

const TAG_REGEX =
	/<\/?([a-zA-Z_][\w_-]*)((?:\s+[a-zA-Z_][\w_-]*(?:=(?:'[^']*'|"[^"]*"|[^\s>]*))?)*)\s*(\/)?>/g;
const ATTR_REGEX = /([a-zA-Z_][\w_-]*)(?:=('[^']*'|"[^"]*"|[^\s>]*))?/g;
const INLINE_TOKEN_REGEX = /\{\{([^{}]+)\}\}/g;

/** True when the text contains at least one XML-ish tag worth highlighting. */
export function hasXmlTags(content: string | null | undefined): boolean {
	return content ? /<\/?[a-zA-Z_][\w_-]*/.test(content) : false;
}

/**
 * Highlight one rendered XML/Markdown line. Plain content, variables, and
 * references are handled too, so callers can use this unconditionally.
 */
export function highlightXmlLine(line: string): React.ReactNode {
	const leading = line.match(/^ */)?.[0] ?? "";
	const body = line.slice(leading.length);
	const result: React.ReactNode[] = [];
	let keyIndex = 0;

	if (leading.length > 0) {
		result.push(
			<span
				key={keyIndex++}
				aria-hidden="true"
				style={{
					display: "inline-block",
					width: promptEditorIndentForSpaces(leading.length),
					overflow: "hidden",
					verticalAlign: "bottom",
					whiteSpace: "pre",
				}}
			>
				{leading}
			</span>,
		);
	}

	const tagRegex = new RegExp(TAG_REGEX.source, TAG_REGEX.flags);
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = tagRegex.exec(body)) !== null) {
		if (match.index > lastIndex) {
			result.push(...highlightInlineTokens(body.slice(lastIndex, match.index), keyIndex));
			keyIndex += countInlinePieces(body.slice(lastIndex, match.index));
		}

		const fullMatch = match[0];
		const tagName = match[1];
		const attributes = match[2] || "";
		const isClosing = fullMatch.startsWith("</");
		const isSelfClosing = fullMatch.endsWith("/>");
		const formattedAttributes: React.ReactNode[] = [];

		if (attributes.trim()) {
			const attrRegex = new RegExp(ATTR_REGEX.source, ATTR_REGEX.flags);
			let attrMatch: RegExpExecArray | null;
			while ((attrMatch = attrRegex.exec(attributes)) !== null) {
				const attrName = attrMatch[1];
				const attrValue = attrMatch[2];
				formattedAttributes.push(
					<span key={keyIndex++}>
						{" "}
						<span style={{ color: EDITOR_COLORS.syntaxAttribute }}>
							{attrName}
						</span>
						{attrValue && (
							<>
								<span style={{ color: EDITOR_COLORS.syntaxPunctuation }}>
									=
								</span>
								<span style={{ color: EDITOR_COLORS.syntaxValue }}>
									{attrValue}
								</span>
							</>
						)}
					</span>,
				);
			}
		}

		result.push(
			<span key={keyIndex++} style={{ color: EDITOR_COLORS.syntaxPunctuation }}>
				{"<"}
				{isClosing && "/"}
				<span style={{ color: EDITOR_COLORS.syntaxTag, fontWeight: 500 }}>
					{tagName}
				</span>
				{formattedAttributes}
				{isSelfClosing && " /"}
				{">"}
			</span>,
		);
		lastIndex = match.index + fullMatch.length;
	}

	if (lastIndex < body.length) {
		result.push(...highlightInlineTokens(body.slice(lastIndex), keyIndex));
	}

	return result.length === 0 ? <span>{line}</span> : <>{result}</>;
}

function highlightInlineTokens(text: string, firstKey: number): React.ReactNode[] {
	const result: React.ReactNode[] = [];
	const tokenRegex = new RegExp(INLINE_TOKEN_REGEX.source, INLINE_TOKEN_REGEX.flags);
	let key = firstKey;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = tokenRegex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			result.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
		}
		result.push(
			<span
				key={key++}
				style={{
					color: match[1]?.includes(":")
						? EDITOR_COLORS.syntaxReference
						: EDITOR_COLORS.syntaxVariable,
				}}
			>
				{match[0]}
			</span>,
		);
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) {
		result.push(<span key={key++}>{text.slice(lastIndex)}</span>);
	}
	return result.length > 0 ? result : [<span key={key}>{text}</span>];
}

function countInlinePieces(text: string): number {
	const matches = text.match(INLINE_TOKEN_REGEX)?.length ?? 0;
	// Each match contributes a token plus, at most, one preceding plain piece.
	// One final plain piece may follow the last token.
	return Math.max(1, matches * 2 + 1);
}

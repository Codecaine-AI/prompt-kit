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
// Inline reading cues inside content: {{variable}} / {{ns:reference}} tokens
// (group 1) and `backtick` code spans (group 2). One combined pattern keeps
// highlightInlineTokens and countInlinePieces in lockstep.
const INLINE_TOKEN_REGEX = /\{\{([^{}]+)\}\}|`([^`]+)`/g;

// Backtick ticks dim to half strength only while chips are visible: the same
// chip-opacity token that paints the chip drives the ticks, so a host that
// zeroes it (classic preset) gets plain full-opacity text back. Any working
// chip opacity (≥ 0.005) saturates the clamp at the designed 0.5 dim.
const TICK_OPACITY =
	"calc(1 - clamp(0, var(--prompt-editor-inline-chip-opacity, 0.08) * 100, 0.5))";

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

	const fragmentOpen = body.match(/^<([a-zA-Z_][\w_-]*)$/);
	if (fragmentOpen) {
		result.push(
			<span key={keyIndex} style={{ color: EDITOR_COLORS.syntaxPunctuation }}>
				{"<"}
				<span style={{ color: EDITOR_COLORS.syntaxTag, fontWeight: 500 }}>
					{fragmentOpen[1]}
				</span>
			</span>,
		);
		return <>{result}</>;
	}
	if (body === "/>") {
		result.push(
			<span key={keyIndex} style={{ color: EDITOR_COLORS.syntaxPunctuation }}>
				/&gt;
			</span>,
		);
		return <>{result}</>;
	}
	const fragmentAttribute = body.match(
		/^([a-zA-Z_:][\w:.-]*)(\s*=\s*)(["'][\s\S]*["'])$/,
	);
	if (fragmentAttribute) {
		result.push(
			<span key={keyIndex++} style={{ color: EDITOR_COLORS.syntaxAttribute }}>
				{fragmentAttribute[1]}
			</span>,
			<span key={keyIndex++} style={{ color: EDITOR_COLORS.syntaxPunctuation }}>
				{fragmentAttribute[2]}
			</span>,
			<span key={keyIndex} style={{ color: EDITOR_COLORS.syntaxValue }}>
				{fragmentAttribute[3]}
			</span>,
		);
		return <>{result}</>;
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
		if (match[2] !== undefined) {
			// `code` span: the ticks AND the inner text stay in the DOM byte-for-
			// byte; the chip is paint only. Horizontal padding is cancelled by an
			// equal negative margin so the mono column grid never shifts, and the
			// ticks dim inside the chip instead of leaving the text.
			result.push(
				<span
					key={key++}
					style={{
						color: EDITOR_COLORS.inlineCode,
						background: EDITOR_COLORS.inlineChipBg,
						borderRadius: 4,
						padding: "1px 2px",
						marginInline: "-2px",
					}}
				>
					<span style={{ opacity: TICK_OPACITY }}>`</span>
					{match[2]}
					<span style={{ opacity: TICK_OPACITY }}>`</span>
				</span>,
			);
		} else {
			const isReference = match[1]?.includes(":");
			result.push(
				<span
					key={key++}
					style={
						isReference
							? { color: EDITOR_COLORS.syntaxReference }
							: {
									color: EDITOR_COLORS.syntaxVariable,
									// Template variables get a chip tinted from their own
									// ink; the host dials it with one opacity token.
									background: `color-mix(in srgb, var(--prompt-editor-syntax-variable, #D9C578) calc(var(--prompt-editor-inline-chip-opacity, 0.08) * 100%), transparent)`,
									borderRadius: 4,
									padding: "1px 2px",
									marginInline: "-2px",
								}
					}
				>
					{match[0]}
				</span>,
			);
		}
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) {
		result.push(<span key={key++}>{text.slice(lastIndex)}</span>);
	}
	return result.length > 0 ? result : [<span key={key}>{text}</span>];
}

/**
 * Upper bound on the React keys highlightInlineTokens consumes for `text`.
 * MUST count the same combined token pattern the renderer walks: each match
 * (variable OR backtick span) contributes a token piece plus, at most, one
 * preceding plain piece; one final plain piece may follow the last token.
 */
function countInlinePieces(text: string): number {
	const matches = text.match(INLINE_TOKEN_REGEX)?.length ?? 0;
	return Math.max(1, matches * 2 + 1);
}

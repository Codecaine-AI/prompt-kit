"use client";

import { EDITOR_COLORS, promptEditorIndentForSpaces } from "./editor-surface";

/** Color JSON-shaped lines without parsing or changing their source text. */
export function highlightJsonLine(line: string): React.ReactNode | null {
	if (!/^\s*(?:["{}\[\]]|-?\d|true\b|false\b|null\b)/.test(line)) return null;
	const leading = line.match(/^ */)?.[0] ?? "";
	const body = line.slice(leading.length);
	const tokens = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g;
	const result: React.ReactNode[] = [];
	if (leading) result.push(<span key="indent" style={{ display: "inline-block", width: promptEditorIndentForSpaces(leading.length), overflow: "hidden", verticalAlign: "bottom", whiteSpace: "pre" }}>{leading}</span>);
	let cursor = 0;
	for (const match of body.matchAll(tokens)) {
		const offset = match.index!;
		if (offset > cursor) result.push(body.slice(cursor, offset));
		const token = match[0];
		const kind = token.startsWith('"')
			? /^\s*:/.test(body.slice(offset + token.length)) ? "key" : "string"
			: /^[{}\[\],:]$/.test(token) ? "punctuation"
			: /^(true|false|null)$/.test(token) ? "literal" : "number";
		const color = { key: EDITOR_COLORS.syntaxAttribute, string: EDITOR_COLORS.syntaxValue,
			punctuation: EDITOR_COLORS.syntaxPunctuation, literal: EDITOR_COLORS.syntaxTag, number: EDITOR_COLORS.inlineCode }[kind];
		result.push(<span key={offset} data-json-token={kind} style={{ color }}>{token}</span>);
		cursor = offset + token.length;
	}
	if (cursor < body.length) result.push(body.slice(cursor));
	return <>{result}</>;
}

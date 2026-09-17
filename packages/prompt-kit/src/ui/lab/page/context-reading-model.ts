/** Split standalone JSON payloads from context text without changing source rows.
 * Only round-trip-safe JSON is formatted. Ambiguous or lossy values stay as source.
 */
export type ContextReadingPart =
	| { kind: "source"; row: number; content: string }
	| { kind: "json"; row: number; value: unknown };

export function contextReadingParts(content: string): ContextReadingPart[] {
	const lines = content.split("\n");
	const parts: ContextReadingPart[] = [];
	let sourceStart = 0;
	for (let start = 0; start < lines.length; start++) {
		if (!/^\s*[{[]/.test(lines[start]!)) continue;
		let depth = 0;
		let quoted = false;
		let escaped = false;
		let end = start;
		for (; end < lines.length; end++) {
			for (const char of lines[end]!) {
				if (quoted) {
					if (escaped) escaped = false;
					else if (char === "\\") escaped = true;
					else if (char === '"') quoted = false;
				} else if (char === '"') quoted = true;
				else if (char === "{" || char === "[") depth++;
				else if (char === "}" || char === "]") depth--;
			}
			if (depth <= 0) break;
		}
		if (depth !== 0 || quoted || end >= lines.length) continue;
		const source = lines.slice(start, end + 1).join("\n");
		try {
			const value: unknown = JSON.parse(source);
			const compact = source.replace(/"(?:\\.|[^"\\])*"|\s+/g, token => token.startsWith('"') ? token : "");
			// Preserve duplicate keys, large integers and unusual number spellings as source.
			if (JSON.stringify(value) !== compact) continue;
			if (start > sourceStart) parts.push({ kind: "source", row: sourceStart, content: lines.slice(sourceStart, start).join("\n") });
			parts.push({ kind: "json", row: start, value });
			sourceStart = end + 1;
			start = end;
		} catch { /* Not a JSON payload; leave the text visible as source. */ }
	}
	if (sourceStart < lines.length) parts.push({ kind: "source", row: sourceStart, content: lines.slice(sourceStart).join("\n") });
	return parts;
}

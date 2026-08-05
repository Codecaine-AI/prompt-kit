// Slice: markdown autoformat — the "typing the markup makes the block" rule.
// Pure: it inspects the text a paragraph editor held before and after a
// keystroke and reports which block the paragraph should become. The caller
// runs `convertParagraphToStep`, so a conversion is one undoable step.

import type { ConvertParagraphTarget } from "../steps/structure-steps";

export interface AutoformatMatch {
	/** Block the paragraph turns into. */
	target: ConvertParagraphTarget;
	/** Text that survives the marker — carried into the new block. */
	rest: string;
	/** Fence language, when the marker carried one. */
	language?: string;
	/** Characters the marker itself occupies (used to gate the trigger). */
	markerLength: number;
}

/**
 * Markers, in the order they are tested. Each pattern must anchor at the start
 * of the line and capture the marker in group 1 so `markerLength` is exact.
 *
 * The vocabulary matches the insert palette and the slash menu — Bullets,
 * Steps, Code — plus nothing else. There is deliberately no `# ` heading rule:
 * this surface has no headings, and a section is a wrapper the user names, not
 * a rank.
 */
const RULES: ReadonlyArray<{
	pattern: RegExp;
	target: ConvertParagraphTarget;
}> = [
	{ pattern: /^([-*] )/, target: "bulletList" },
	{ pattern: /^(\d+[.)] )/, target: "orderedList" },
	{ pattern: /^(```)/, target: "codeBlock" },
];

/**
 * The block `value` asks for, or null when it names no marker.
 *
 * ```
 * matchAutoformatMarker("- ")       → bulletList, rest ""
 * matchAutoformatMarker("1. buy")   → orderedList, rest "buy"
 * matchAutoformatMarker("```ts")    → codeBlock, language "ts"
 * matchAutoformatMarker("hello")    → null
 * ```
 */
export function matchAutoformatMarker(value: string): AutoformatMatch | null {
	for (const rule of RULES) {
		const match = rule.pattern.exec(value);
		const marker = match?.[1];
		if (!marker) continue;
		const rest = value.slice(marker.length);
		if (rule.target === "codeBlock") {
			// ```lang has no body: everything after the fence names the language.
			const language = rest.trim();
			return {
				target: rule.target,
				rest: "",
				...(language ? { language } : {}),
				markerLength: marker.length,
			};
		}
		return { target: rule.target, rest, markerLength: marker.length };
	}
	return null;
}

/**
 * Whether a paragraph edit from `previous` to `next` should autoformat.
 *
 * The rule is "typing the marker on an EMPTY paragraph": `next` names a marker,
 * `previous` did not, `previous` is a prefix of `next` (the edit appended —
 * typing or a paste at the end, never a mid-line rewrite), and `previous` was
 * shorter than the marker, so everything the paragraph held was marker-in-
 * progress. That last clause is what keeps `- ` from firing when the caret is
 * parked at the start of a paragraph that already carries prose.
 */
export function resolveAutoformat(
	previous: string,
	next: string,
): AutoformatMatch | null {
	const match = matchAutoformatMarker(next);
	if (!match) return null;
	if (matchAutoformatMarker(previous)) return null;
	if (!next.startsWith(previous)) return null;
	if (previous.length >= match.markerLength) return null;
	return match;
}

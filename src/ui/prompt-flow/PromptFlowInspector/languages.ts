// Slice: the code-fence language list and its normalisation. The renderer emits
// ```<language>, so the value is a bare fence word — never a phrase.

/** Suggestions only: the field accepts any word the renderer can fence with. */
export const CODE_LANGUAGES = [
	"ts",
	"tsx",
	"js",
	"json",
	"python",
	"bash",
	"sh",
	"sql",
	"yaml",
	"toml",
	"md",
	"html",
	"css",
	"xml",
	"diff",
	"text",
] as const;

/**
 * Whitespace and backticks would break the fence out of itself, so they are
 * dropped; an empty value clears the language and renders a bare fence.
 */
export function normalizeLanguage(value: string): string | undefined {
	const next = value.replace(/\s+/g, "").replace(/`/g, "");
	return next.length === 0 ? undefined : next;
}

/** The opening fence the renderer will emit — shown under the field. */
export function fenceHint(language?: string): string {
	return `\`\`\`${language ?? ""}`;
}

// Slice: the slash-menu vocabulary and its matcher. Pure — no React, no DOM.
import type {
	PromptBlockNodeType,
} from "../model";

export type SlashCommandId =
	| "text"
	| "section"
	| "bullets"
	| "steps"
	| "code";

export type SlashCommand = {
	/** Stable key for React and for the integrator's selection state. */
	readonly id: SlashCommandId;
	/** Row title. Also the primary match target. */
	readonly label: string;
	/** Block created when the command is chosen. */
	readonly type: PromptBlockNodeType;
	/** One muted line under the label. Sentence case, no trailing period. */
	readonly description: string;
	/** Extra match targets: synonyms, abbreviations, the literal markup. */
	readonly aliases: readonly string[];
};

/**
 * Canonical order — the same five blocks the insert palette offers, in the same
 * sequence, so the two surfaces never disagree about what a prompt is made of.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{
		id: "text",
		label: "Text",
		type: "paragraph",
		description: "Plain prose",
		aliases: ["paragraph", "para", "p", "body", "plain"],
	},
	{
		id: "section",
		label: "Section",
		type: "section",
		description: "Wrapper tag",
		// No "container"/"code"-adjacent synonyms here: they would pull Section
		// into `/co`, which must belong to Code alone.
		aliases: ["tag", "xml", "element", "group", "wrap"],
	},
	{
		id: "bullets",
		label: "Bullets",
		type: "bulletList",
		description: "Unordered list",
		aliases: ["bullet", "list", "ul", "unordered", "dash", "-"],
	},
	{
		id: "steps",
		label: "Steps",
		type: "orderedList",
		description: "Numbered list",
		aliases: ["step", "ordered", "numbered", "number", "list", "ol", "1."],
	},
	{
		id: "code",
		label: "Code",
		type: "codeBlock",
		description: "Fenced block",
		aliases: ["codeblock", "snippet", "fence", "pre", "```"],
	},
];

/** Rank buckets, best first. Ties keep canonical order. */
const RANK_LABEL_PREFIX = 0;
const RANK_ALIAS_PREFIX = 1;
const RANK_LABEL_SUBSTRING = 2;
const RANK_ALIAS_SUBSTRING = 3;
const RANK_NONE = Number.POSITIVE_INFINITY;

/**
 * Filter the vocabulary for a slash query.
 *
 * The query is what the user typed after `/` — a leading slash is tolerated so
 * callers may pass the raw line. Matching is case-insensitive over the label and
 * the aliases, prefix matches outranking substring matches and label matches
 * outranking alias matches. Sorting is stable, so equally ranked commands stay
 * in canonical order.
 *
 * - `""` → every command, canonical order
 * - `"s"` → Section, Steps (label prefixes), then Bullets (a substring)
 * - `"bul"` → Bullets
 * - `"co"` → Code
 * - `"zzz"` → `[]` (the integrator dismisses on an empty result)
 */
export function matchSlashCommands(query: string): SlashCommand[] {
	const needle = normalizeQuery(query);
	if (needle === "") return [...SLASH_COMMANDS];

	return SLASH_COMMANDS.map((command, index) => ({
		command,
		index,
		rank: rankCommand(command, needle),
	}))
		.filter((entry) => entry.rank !== RANK_NONE)
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map((entry) => entry.command);
}

/** Lower is better; `RANK_NONE` means "not a match". */
function rankCommand(command: SlashCommand, needle: string): number {
	const label = command.label.toLowerCase();
	if (label.startsWith(needle)) return RANK_LABEL_PREFIX;

	let best = label.includes(needle) ? RANK_LABEL_SUBSTRING : RANK_NONE;
	for (const alias of command.aliases) {
		const candidate = alias.toLowerCase();
		if (candidate.startsWith(needle)) return RANK_ALIAS_PREFIX;
		if (candidate.includes(needle)) best = Math.min(best, RANK_ALIAS_SUBSTRING);
	}
	return best;
}

function normalizeQuery(query: string): string {
	return query.trim().replace(/^\/+/, "").trim().toLowerCase();
}

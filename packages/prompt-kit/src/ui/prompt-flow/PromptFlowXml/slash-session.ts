// Slice: the slash menu's state machine — when it opens, what the query is
// after a keystroke, when it retires, and where the selection sits. Pure: the
// surface owns the React state and the caret rect, this owns the rules.

import { matchSlashCommands, type SlashCommand } from "./slash-commands";

/** An open slash menu, as the surface stores it. */
export interface SlashSession {
	/** Editable line the menu belongs to. */
	nodeId: string;
	/** Item index, when that line is a list item. */
	itemIndex?: number;
	/** Text typed after the `/`. */
	query: string;
	/** Index into `matchSlashCommands(query)`. */
	selectedIndex: number;
}

/**
 * Whether typing turned `previous` into `next` by putting a `/` at the START of
 * an empty line. Nothing else opens the menu — a slash inside a sentence is a
 * slash, and re-opening on a line that already carries text would hijack it.
 */
export function shouldOpenSlash(previous: string, next: string): boolean {
	return previous === "" && next === "/";
}

/**
 * The session after the line's text became `next`, or null when the menu should
 * retire. It retires when the `/` is gone (backspaced over, or the line was
 * rewritten) or when the query matches nothing — in both cases the typed text
 * is left alone as literal prose.
 *
 * The selection is clamped into the new match list and reset to the top
 * whenever the query changes, so filtering never leaves the highlight parked on
 * an unrelated row.
 */
export function advanceSlashSession(
	session: SlashSession,
	next: string,
): SlashSession | null {
	if (!next.startsWith("/")) return null;
	const query = next.slice(1);
	const matches = matchSlashCommands(query);
	if (matches.length === 0) return null;
	if (query === session.query) {
		return { ...session, selectedIndex: clamp(session.selectedIndex, matches.length) };
	}
	return { ...session, query, selectedIndex: 0 };
}

/**
 * Selection after Down (`+1`) or Up (`-1`). The list wraps: pressing Up on the
 * first row lands on the last, which is what a five-row menu wants — the
 * bottom entry is one keystroke away in either direction.
 */
export function moveSlashSelection(
	session: SlashSession,
	delta: number,
): number {
	const count = matchSlashCommands(session.query).length;
	if (count === 0) return 0;
	return (((session.selectedIndex + delta) % count) + count) % count;
}

/** The command Enter / Tab would choose, or undefined when nothing matches. */
export function selectedSlashCommand(
	session: SlashSession,
): SlashCommand | undefined {
	const matches = matchSlashCommands(session.query);
	return matches[clamp(session.selectedIndex, matches.length)];
}

function clamp(index: number, count: number): number {
	if (count === 0) return 0;
	return Math.min(Math.max(index, 0), count - 1);
}

// Slice: hand-rolled line diff for inline staged-proposal rendering. The
// texts involved are whole-prompt renders (hundreds of lines at most), so a
// plain LCS is fast enough and keeps the dependency surface at zero.

/**
 * LCS line matching: `matchBefore[i]` is the index in `after` that line `i`
 * of `before` pairs with, or -1 when the line is deleted/changed. Matches are
 * strictly increasing in `after`, so they define a monotone alignment the
 * region math below can anchor on.
 */
export function lcsLineMatch(
	before: readonly string[],
	after: readonly string[],
): number[] {
	const n = before.length;
	const m = after.length;
	// dp[i][j] = LCS length of before[i..] and after[j..].
	const width = m + 1;
	const dp = new Int32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i -= 1) {
		for (let j = m - 1; j >= 0; j -= 1) {
			dp[i * width + j] =
				before[i] === after[j]
					? dp[(i + 1) * width + (j + 1)]! + 1
					: Math.max(dp[(i + 1) * width + j]!, dp[i * width + (j + 1)]!);
		}
	}
	const match = new Array<number>(n).fill(-1);
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (before[i] === after[j]) {
			match[i] = j;
			i += 1;
			j += 1;
		} else if (dp[(i + 1) * width + j]! >= dp[i * width + (j + 1)]!) {
			i += 1;
		} else {
			j += 1;
		}
	}
	return match;
}

/**
 * The `after` lines that correspond to the CONTIGUOUS `before` run
 * `[runStart, runEnd]` (inclusive): everything in `after` between the match
 * of the nearest matched line BEFORE the run and the match of the nearest
 * matched line AFTER it. Matched lines inside the run stay inside the
 * region, so a partially-edited block maps to its whole replacement — the
 * inline review shows old-block/new-block, not minimal hunks.
 */
export function afterRegionForRun(
	before: readonly string[],
	after: readonly string[],
	runStart: number,
	runEnd: number,
): string[] {
	const match = lcsLineMatch(before, after);
	let lo = 0;
	for (let i = Math.min(runStart, before.length) - 1; i >= 0; i -= 1) {
		const paired = match[i]!;
		if (paired >= 0) {
			lo = paired + 1;
			break;
		}
	}
	let hi = after.length - 1;
	for (let i = runEnd + 1; i < before.length; i += 1) {
		const paired = match[i]!;
		if (paired >= 0) {
			hi = paired - 1;
			break;
		}
	}
	return hi < lo ? [] : after.slice(lo, hi + 1);
}

/**
 * First index at which `needle` occurs as a contiguous run inside
 * `haystack`, or -1. Used to locate a node's current rendered extent inside
 * a proposal's `renderedBefore` text.
 */
export function findLineRun(
	haystack: readonly string[],
	needle: readonly string[],
): number {
	if (needle.length === 0 || needle.length > haystack.length) return -1;
	outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
		for (let offset = 0; offset < needle.length; offset += 1) {
			if (haystack[start + offset] !== needle[offset]) continue outer;
		}
		return start;
	}
	return -1;
}

/** Every line of `after` that no line of `before` pairs with — the diff's
 * added lines, used as the last-resort inline fallback when a proposal's
 * extent cannot be located in its `renderedBefore`. */
export function addedLines(
	before: readonly string[],
	after: readonly string[],
): string[] {
	const matched = new Set(lcsLineMatch(before, after).filter((j) => j >= 0));
	return after.filter((_, index) => !matched.has(index));
}

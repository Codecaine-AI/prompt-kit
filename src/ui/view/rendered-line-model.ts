/**
 * String-based line classifier for the read-only prompt renderer.
 *
 * PromptView receives a plain rendered string — no document model — so the
 * structural roles the editable surface derives from its node tree are
 * recovered here from the raw text alone. The classifier is pure: it never
 * mutates or re-serializes the input, only labels each line.
 *
 * Depth is tracked with a tag stack, not indentation. Rendered prompts indent
 * four spaces per level, but the stack is the source of truth; indentation is
 * only a sanity signal. A caller that passes a mid-document chunk (stack
 * starts empty) gets best-effort depths for that chunk.
 */

export type RenderedLineRole = "gap" | "open" | "close" | "content" | "item";

export interface RenderedLineInfo {
	role: RenderedLineRole;
	/**
	 * Tag-stack depth at this line. For an "open" line: the depth BEFORE the
	 * tag is pushed. For a "close" line: the depth AFTER popping — i.e. the
	 * depth of its matching opener. For "gap"/"content"/"item": the current
	 * stack depth.
	 */
	depth: number;
	/**
	 * For "gap" lines whose next non-blank line is an OPEN tag line: that
	 * opener's depth. Big blank-line heights mark where a section starts, so
	 * the renderer grades a gap by the depth of the open tag it precedes —
	 * absent when the gap precedes anything else (content, item, close, EOF),
	 * which keeps ordinary paragraph breaks one line tall.
	 */
	gapBeforeOpenDepth?: number;
}

/** A line that is exactly one opening tag (attributes allowed), nothing else. */
const OPEN_TAG_LINE = /^\s*<[A-Za-z][\w-]*(\s[^>]*)?>\s*$/;
/** A line that is exactly one closing tag, nothing else. */
const CLOSE_TAG_LINE = /^\s*<\/[A-Za-z][\w-]*>\s*$/;
/**
 * A line that is exactly one self-closing tag. Checked before the open
 * pattern because `<tag />`'s trailing "/" also satisfies `[^>]*`.
 */
const SELF_CLOSING_TAG_LINE = /^\s*<[A-Za-z][\w-]*(\s[^>]*)?\/\s*>\s*$/;
/** Fenced-code delimiter. Inside a fence nothing is a tag, gap, or item. */
const FENCE_LINE = /^\s*```/;
/**
 * List item: "-" or "*" followed by whitespace, or an ordered "1." marker,
 * after any indent. The whitespace requirement on dash/star keeps "---"
 * rules and "*emphasis*" prose out; ordered markers need only the dot.
 */
const ITEM_LINE = /^\s*(?:[-*]\s|\d+\.)/;

/**
 * Classify every line of a rendered prompt string. Output has exactly one
 * entry per `content.split("\n")` line, in order.
 */
export function classifyRenderedLines(content: string): RenderedLineInfo[] {
	const lines = content.split("\n");
	const stack: string[] = [];
	let inFence = false;
	const result: RenderedLineInfo[] = [];

	for (const line of lines) {
		if (inFence) {
			// Fence body and its closing delimiter both read as plain content.
			if (FENCE_LINE.test(line)) inFence = false;
			result.push({ role: "content", depth: stack.length });
			continue;
		}

		if (FENCE_LINE.test(line)) {
			inFence = true;
			result.push({ role: "content", depth: stack.length });
			continue;
		}

		if (line.trim().length === 0) {
			result.push({ role: "gap", depth: stack.length });
			continue;
		}

		if (SELF_CLOSING_TAG_LINE.test(line)) {
			// Self-closing tags never change the stack; they read as content.
			result.push({ role: "content", depth: stack.length });
			continue;
		}

		if (CLOSE_TAG_LINE.test(line)) {
			if (stack.length > 0) stack.pop();
			result.push({ role: "close", depth: stack.length });
			continue;
		}

		if (OPEN_TAG_LINE.test(line)) {
			result.push({ role: "open", depth: stack.length });
			const name = line.match(/^\s*<([A-Za-z][\w-]*)/)?.[1] ?? "";
			stack.push(name);
			continue;
		}

		if (ITEM_LINE.test(line)) {
			result.push({ role: "item", depth: stack.length });
			continue;
		}

		result.push({ role: "content", depth: stack.length });
	}

	// Look-ahead pass: tag every gap that directly precedes an open-tag line
	// (through any run of blanks) with that opener's depth, so the renderer
	// can reserve the big section seams for section starts only.
	let following: RenderedLineInfo | undefined;
	for (let index = result.length - 1; index >= 0; index--) {
		const info = result[index]!;
		if (info.role === "gap") {
			if (following?.role === "open") {
				info.gapBeforeOpenDepth = following.depth;
			}
			continue;
		}
		following = info;
	}

	return result;
}

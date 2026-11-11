import type { GuidanceTopic } from "@codecaine-ai/prompt-kit-server";

export { loadGuidance, type GuidanceSnapshot, type GuidanceSource } from "@codecaine-ai/prompt-kit-server";

/** A served topic part holds at most this many bytes, unless one line alone is longer. */
export const TOPIC_PART_BYTES = 24_576;
/** Where a topic may split, most preferred first: between sources, between paragraphs, between lines. */
const BREAKS = ["\n\n---\n\n", "\n\n", "\n"] as const;

/**
 * A topic as `prompts_guidance` serves it: one or more parts, never truncated. Each part starts with the topic
 * heading, and a topic with more than one part says which part each one is. The body splits at the most preferred
 * break that brings each piece within the budget, and each part packs as many whole pieces as fit. A break between
 * two parts opens the later part and counts in its bytes, so the part bodies joined in order are the topic body: a
 * `---` line inside a fenced example survives a split.
 */
export function topicParts(topic: Pick<GuidanceTopic, "title" | "text">): string[] {
	const heading = `# ${topic.title}`;
	const body = topic.text.startsWith(`${heading}\n\n`) ? topic.text.slice(heading.length + 2) : topic.text;
	const bytes = (text: string) => Buffer.byteLength(text);
	const room = TOPIC_PART_BYTES - bytes(`${heading}\n\nPart 99 of 99.\n\n`);
	// Each piece with the break that joins it to the piece before it.
	let pieces: { text: string; before: string }[] = [{ text: body, before: "" }];
	for (const split of BREAKS) {
		pieces = pieces.flatMap((piece) => bytes(piece.before) + bytes(piece.text) <= room ? [piece]
			: piece.text.split(split).map((text, index) => ({ text, before: index === 0 ? piece.before : split })));
	}
	const chunks: string[] = [];
	for (const piece of pieces) {
		const last = chunks.at(-1);
		if (last !== undefined && bytes(last) + bytes(piece.before) + bytes(piece.text) <= room) chunks[chunks.length - 1] = `${last}${piece.before}${piece.text}`;
		else chunks.push(`${piece.before}${piece.text}`);
	}
	return chunks.map((chunk, index) => chunks.length === 1 ? `${heading}\n\n${chunk}` : `${heading}\n\nPart ${index + 1} of ${chunks.length}.\n\n${chunk}`);
}

let servedTextHook: ((text: string) => string) | undefined;
/** Test hook for the manifest mutation test: it rewrites each served topic part. The snapshot and the manifest stay unchanged. */
export function setServedTextHook(hook?: (text: string) => string): void { servedTextHook = hook; }
/** One topic part as `prompts_guidance` serves it. */
export const servedText = (text: string): string => servedTextHook ? servedTextHook(text) : text;

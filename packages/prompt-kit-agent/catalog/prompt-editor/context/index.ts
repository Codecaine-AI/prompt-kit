/**
 * Section ② — the prompt-editor's STANDING KNOWLEDGE, and nothing else.
 *
 * `assemble()` bakes five named context blocks from the catalog's new shared
 * and prompt-editor-local block files. Each block is served by kernel `file`
 * loaders and rendered as its own XML tag; the tool guide deliberately joins
 * tool semantics first and the shared transaction vocabulary second.
 *
 * There is deliberately NO envelope here. The kernel's L2 context set wraps
 * section ② in its single <context> message itself — these blocks land as
 * entries inside it, and wrapping again would double-envelope the request.
 *
 * Live session data (the target prompt render, applied diffs, and the request
 * queue) is section ③ and belongs to the state sidecar (../state/index.ts),
 * which seeds it from the SpawnContext and renders it per request. This module
 * never reads `sessionData`.
 */
import { join } from "node:path";
import type {
	AgentContextResolver,
	LoadedMap,
	SpawnContext,
} from "@agent-kernel/kernel/context";
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import { block } from "../../shared/xml";

export interface ContextBlock {
	/** XML tag emitted for this section ② block. */
	readonly tag: string;
	/** Source files joined inside the tag, in reading order. */
	readonly files: ReadonlyArray<string>;
}

const SHARED_BLOCKS_DIR = join(import.meta.dir, "..", "..", "_shared", "blocks");
const LOCAL_BLOCKS_DIR = join(import.meta.dir, "blocks");

const sharedBlock = (filename: string): string =>
	join(SHARED_BLOCKS_DIR, filename);
const localBlock = (filename: string): string => join(LOCAL_BLOCKS_DIR, filename);

/** The five standing context blocks, in their rendered reading order. */
export const CONTEXT_BLOCKS: ReadonlyArray<ContextBlock> = [
	{
		tag: "prompt_document_model",
		files: [sharedBlock("10-document-model.md")],
	},
	{
		tag: "section_guide",
		files: [sharedBlock("20-section-guide-agent.md")],
	},
	{
		tag: "quality_guide",
		files: [sharedBlock("50-quality-guide.md")],
	},
	{
		tag: "tool_guide",
		files: [
			localBlock("20-tool-guide.md"),
			sharedBlock("70-transaction-guide.md"),
		],
	},
	{
		tag: "state_reference",
		files: [localBlock("10-state-reference.md")],
	},
];

/** All source files in kernel-loader order. */
export const CONTEXT_FILES: ReadonlyArray<string> = CONTEXT_BLOCKS.flatMap(
	(entry) => entry.files,
);

const loaders: AgentContextResolver["loaders"] = CONTEXT_FILES.map((path) => ({
	kind: "file",
	path,
}));

function loadedPath(input: LoadedMap[number]): string {
	return typeof input.decl === "object" && "path" in input.decl
		? String(input.decl.path)
		: "";
}

// `_ctx` is the contract's second parameter, deliberately unread: section ②
// is session-invariant standing knowledge. Session state rides section ③.
function assemble(loaded: LoadedMap, _ctx: SpawnContext): string {
	const loadedByPath = new Map(loaded.map((input) => [loadedPath(input), input]));

	return CONTEXT_BLOCKS.map((entry) => {
		const inputs = entry.files.map((path) => loadedByPath.get(path));
		const unavailableIndex = inputs.findIndex(
			(input) => input === undefined || input.status !== "ok",
		);
		if (unavailableIndex === -1) {
			const body = inputs
				.map((input) => input?.content ?? "")
				.join("\n\n");
			return block(entry.tag, "", body);
		}

		const unavailable = inputs[unavailableIndex];
		const status = unavailable?.status ?? "missing";
		return `<${entry.tag} status="${status}"></${entry.tag}>`;
	}).join("\n");
}

export const context = defineContext({ loaders, assemble });
export default context;

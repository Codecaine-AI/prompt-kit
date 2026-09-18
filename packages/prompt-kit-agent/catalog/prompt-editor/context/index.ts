/**
 * Section ② — session-invariant prompt authoring knowledge.
 *
 * Canonical native Docs files are loaded through Kernel file loaders, validated,
 * and projected by the same pure functions used by the guidance service. This keeps
 * the catalog bundle usable through Node/jiti and never starts a model or
 * server. Prompt-editor tool semantics and state vocabulary remain local.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AgentContextResolver,
	LoadedMap,
	SpawnContext,
} from "@agent-kernel/kernel/context";
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import {
	assembleGuidanceText,
	GUIDANCE_SOURCE_MANIFEST,
	renderGuidanceSource,
} from "@codecaine-ai/prompt-kit-server/guidance";
import { block } from "../../shared/xml";

export interface ContextBlock {
	readonly tag: string;
	readonly files: ReadonlyArray<string>;
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../../../../..");
const LOCAL_BLOCKS_DIR = join(MODULE_DIR, "blocks");
const localBlock = (filename: string): string => join(LOCAL_BLOCKS_DIR, filename);

export const GUIDANCE_FILES: ReadonlyArray<string> = GUIDANCE_SOURCE_MANIFEST.map(
	(source) => join(REPO_ROOT, source.path),
);

export const CONTEXT_BLOCKS: ReadonlyArray<ContextBlock> = [
	{ tag: "prompt_kit_authoring", files: GUIDANCE_FILES },
	{ tag: "tool_guide", files: [localBlock("20-tool-guide.md")] },
	{ tag: "state_reference", files: [localBlock("10-state-reference.md")] },
];

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

function unavailableStatus(
	files: ReadonlyArray<string>,
	loadedByPath: ReadonlyMap<string, LoadedMap[number]>,
): string | undefined {
	for (const path of files) {
		const input = loadedByPath.get(path);
		if (input === undefined || input.status !== "ok") {
			return input?.status ?? "missing";
		}
	}
	return undefined;
}

function assemble(loaded: LoadedMap, _ctx: SpawnContext): string {
	const loadedByPath = new Map(loaded.map((input) => [loadedPath(input), input]));
	return CONTEXT_BLOCKS.map((entry) => {
		const status = unavailableStatus(entry.files, loadedByPath);
		if (status !== undefined) {
			return `<${entry.tag} status="${status}"></${entry.tag}>`;
		}

		if (entry.tag === "prompt_kit_authoring") {
			const contents = Object.fromEntries(
				GUIDANCE_SOURCE_MANIFEST.map((source, index) => [
					source.id,
					renderGuidanceSource(
						source.path,
						loadedByPath.get(GUIDANCE_FILES[index]!)?.content ?? "",
					),
				]),
			);
			return block(entry.tag, "", assembleGuidanceText("agent", contents));
		}

		const body = entry.files
			.map((path) => loadedByPath.get(path)?.content ?? "")
			.join("\n\n");
		return block(entry.tag, "", body);
	}).join("\n");
}

export const context = defineContext({ loaders, assemble });
export default context;

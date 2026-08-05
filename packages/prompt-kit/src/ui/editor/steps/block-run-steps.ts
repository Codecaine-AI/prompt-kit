// Slice: contiguous BLOCK-RUN mutations — the sibling-level counterpart of
// list-item-steps' run helpers. A structural (marquee / shift-click) selection
// of kind "blocks" moves and deletes through these, so a multi-block object
// commits as ONE transaction and undoes in one action.

import type { PromptBlockNode, PromptDocument } from "../../../index";
import {
	createPromptEditorTree,
	type PromptNodePath,
} from "../model";
import {
	applySteps,
	type PromptStep,
} from "../transactions";

export interface BlockRunStepsResult {
	prompt: PromptDocument;
	/**
	 * The steps of ONE transaction (commit them together): sequential
	 * remove/insert steps whose paths are valid in application order, so
	 * `applySteps` replays them and `revertSteps` restores the original
	 * document exactly. Empty for a no-op (bad range, interior slot, missing
	 * parent).
	 */
	steps: PromptStep[];
	/** Ids of the moved/removed blocks, in run order (for focus / flash). */
	runIds: string[];
}

/**
 * Moves the CONTIGUOUS run of `count` blocks starting at `fromIndex` under
 * `parentId` (null = the document's top level) to insertion slot `toSlot` —
 * the block-level sibling of `moveListItemsStep`, speaking the same "slot in
 * the ORIGINAL indexing" language: slot `k` means "immediately before the
 * sibling currently at index k", `siblings.length` means "after the last". A
 * slot strictly inside the run is not a place the run can land, so it is a
 * no-op (the drag layer never offers those slots).
 */
export function moveBlocksStep(
	prompt: PromptDocument,
	parentId: string | null,
	fromIndex: number,
	count: number,
	toSlot: number,
): BlockRunStepsResult {
	const resolved = resolveRun(prompt, parentId, fromIndex, count);
	if (!resolved) return { prompt, steps: [], runIds: [] };
	const { parentPath, siblings, run } = resolved;

	let insert = Math.max(0, Math.min(toSlot, siblings.length));
	if (insert > fromIndex) {
		// A slot inside the run has no meaning once the run is lifted out.
		if (insert < fromIndex + count) return { prompt, steps: [], runIds: [] };
		// Removing the run first shifts every later slot left by its length.
		insert -= count;
	}
	if (insert === fromIndex) return { prompt, steps: [], runIds: [] };

	const steps: PromptStep[] = [];
	// Remove the run back-to-front so each step's path is valid when it
	// applies, then insert front-to-back at the adjusted slot.
	for (let offset = count - 1; offset >= 0; offset -= 1) {
		steps.push({
			op: "remove",
			path: [...parentPath, fromIndex + offset],
			removed: run[offset]!,
		});
	}
	run.forEach((node, offset) => {
		steps.push({ op: "insert", path: [...parentPath, insert + offset], node });
	});

	return {
		prompt: applySteps(prompt, steps),
		steps,
		runIds: runIdsOf(run),
	};
}

/**
 * Removes the CONTIGUOUS run of `count` blocks starting at `fromIndex` under
 * `parentId` (null = top level) — the whole run as one transaction, so
 * Backspace on a structural selection takes out the object in one action and
 * undo restores every block.
 */
export function removeBlocksStep(
	prompt: PromptDocument,
	parentId: string | null,
	fromIndex: number,
	count: number,
): BlockRunStepsResult {
	const resolved = resolveRun(prompt, parentId, fromIndex, count);
	if (!resolved) return { prompt, steps: [], runIds: [] };
	const { parentPath, run } = resolved;

	const steps: PromptStep[] = [];
	for (let offset = count - 1; offset >= 0; offset -= 1) {
		steps.push({
			op: "remove",
			path: [...parentPath, fromIndex + offset],
			removed: run[offset]!,
		});
	}

	return {
		prompt: applySteps(prompt, steps),
		steps,
		runIds: runIdsOf(run),
	};
}

function runIdsOf(run: readonly PromptBlockNode[]): string[] {
	return run
		.map((node) => node.id)
		.filter((id): id is string => id !== undefined);
}

/**
 * Resolves a run address to the parent's child-array path and the run's
 * nodes. Only tree-addressable levels own block runs: the document root and
 * section-like containers. (Blocks nested in LIST ITEMS never form a
 * blocks-run — structural resolution promotes those to the item level.)
 */
function resolveRun(
	prompt: PromptDocument,
	parentId: string | null,
	fromIndex: number,
	count: number,
):
	| {
			parentPath: PromptNodePath;
			siblings: readonly PromptBlockNode[];
			run: readonly PromptBlockNode[];
	  }
	| null {
	let parentPath: PromptNodePath;
	let siblings: readonly PromptBlockNode[];
	if (parentId === null) {
		parentPath = ["nodes"];
		siblings = prompt.nodes;
	} else {
		const entry = createPromptEditorTree(prompt).find(
			(candidate) => candidate.id === parentId,
		);
		if (!entry) return null;
		switch (entry.node.type) {
			case "section":
			case "example":
				parentPath = [...entry.path, "children"];
				siblings = entry.node.children;
				break;
			case "field":
				parentPath = [...entry.path, "children"];
				siblings = entry.node.children ?? [];
				break;
			case "contextUsage":
				parentPath = [...entry.path, "instructions"];
				siblings = entry.node.instructions;
				break;
			default:
				return null;
		}
	}
	if (count < 1 || fromIndex < 0 || fromIndex + count > siblings.length) {
		return null;
	}
	return { parentPath, siblings, run: siblings.slice(fromIndex, fromIndex + count) };
}

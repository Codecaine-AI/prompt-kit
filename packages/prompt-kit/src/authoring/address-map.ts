import type { PromptDocument } from "../document/nodes/types";
import { blockEntries } from "./tree";
import {
	PROMPT_DOCUMENT_ROOT_ID,
	type PromptAddressMap,
} from "./types";

/**
 * Build the stable, block-level addresses accepted by semantic edit operations.
 * Callers must normalize missing ids with `ensurePromptNodeIds` before reading;
 * un-normalized documents are rejected so the returned ids always name the
 * exact document supplied to `compilePromptEditOps`.
 */
export function readPromptAddressMap(doc: PromptDocument): PromptAddressMap {
	assertAddressableIds(doc.nodes);
	return {
		rootId: PROMPT_DOCUMENT_ROOT_ID,
		nodes: blockEntries(doc, PROMPT_DOCUMENT_ROOT_ID).map((entry) => ({
			nodeId: entry.node.id!,
			type: entry.node.type,
			path: entry.path,
			parentNodeId: entry.parentNodeId,
			index: entry.index,
		})),
	};
}

function assertAddressableIds(nodes: readonly import("../document/nodes/types").PromptBlockNode[]): void {
	for (const node of nodes) {
		if (!node.id) throw new Error("readPromptAddressMap requires a document normalized with ensurePromptNodeIds.");
		switch (node.type) {
			case "bulletList":
			case "orderedList":
				for (const item of node.items) {
					if (!item.id) throw new Error("readPromptAddressMap requires a document normalized with ensurePromptNodeIds.");
					assertAddressableIds(item.children ?? []);
				}
				break;
			case "section":
			case "example":
				assertAddressableIds(node.children);
				break;
			case "field":
				assertAddressableIds(node.children ?? []);
				break;
			case "contextUsage":
				assertAddressableIds(node.instructions);
				break;
		}
	}
}

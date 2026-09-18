import { prepareBlockForInsert } from "../document/nodes/ids";
import type { PromptBlockNode, PromptDocument } from "../document/nodes/types";
import type { PromptInsertStep, PromptNodePath, PromptStep } from "./types";

export interface BlockEntry {
	node: PromptBlockNode;
	path: PromptNodePath;
	parentPath: PromptNodePath;
	index: number;
	parentNodeId: string;
}

export function blockEntries(doc: PromptDocument, rootId: string): BlockEntry[] {
	const entries: BlockEntry[] = [];
	collect(doc.nodes, ["nodes"], rootId, entries);
	return entries;
}

function collect(
	nodes: readonly PromptBlockNode[],
	parentPath: PromptNodePath,
	parentNodeId: string,
	entries: BlockEntry[],
): void {
	nodes.forEach((node, index) => {
		if (!node.id) return;
		const path = [...parentPath, index];
		entries.push({ node, path, parentPath, index, parentNodeId });
		const children = childContainer(node);
		if (children) collect(children.nodes, [...path, children.key], node.id, entries);
		if (node.type === "bulletList" || node.type === "orderedList") {
			node.items.forEach((item, itemIndex) => {
				if (item.children) {
					collect(
						item.children,
						[...path, "items", itemIndex, "children"],
						item.id ?? node.id!,
						entries,
					);
				}
			});
		}
	});
}

export function findBlock(doc: PromptDocument, id: string, rootId: string): BlockEntry | undefined {
	return blockEntries(doc, rootId).find((entry) => entry.node.id === id);
}

export function childContainer(
	node: PromptBlockNode,
): { key: "children" | "instructions"; nodes: readonly PromptBlockNode[] } | undefined {
	switch (node.type) {
		case "section":
		case "example":
			return { key: "children", nodes: node.children };
		case "field":
			return { key: "children", nodes: node.children ?? [] };
		case "contextUsage":
			return { key: "instructions", nodes: node.instructions };
		default:
			return undefined;
	}
}

export function preparedInsertStep(
	doc: PromptDocument,
	path: PromptNodePath,
	node: PromptBlockNode,
): PromptInsertStep {
	return { op: "insert", path, node: prepareBlockForInsert(node, doc) };
}

export function applyStep(doc: PromptDocument, step: PromptStep, rootId: string): PromptDocument {
	switch (step.op) {
		case "insert":
			return insertAtPath(doc, step.path, step.node);
		case "remove":
			return removeAtPath(doc, step.path);
		case "move": {
			const node = getAtPath(doc, step.from);
			if (!node) return doc;
			return insertAtPath(removeAtPath(doc, step.from), step.to, node);
		}
		case "update": {
			const entry = findBlock(doc, step.id, rootId);
			return entry
				? updateAtPath(doc, entry.path, (value) => merge(value as PromptBlockNode, step.after))
				: doc;
		}
	}
}

function merge(node: PromptBlockNode, patch: object): PromptBlockNode {
	const result = { ...node, ...patch } as unknown as Record<string, unknown>;
	for (const key of Object.keys(result)) if (result[key] === undefined) delete result[key];
	return result as unknown as PromptBlockNode;
}

function getAtPath(doc: PromptDocument, path: PromptNodePath): PromptBlockNode | undefined {
	let value: unknown = doc;
	for (const segment of path) {
		if (value === null || value === undefined) return undefined;
		value = (value as Record<string | number, unknown>)[segment];
	}
	return value as PromptBlockNode | undefined;
}

function insertAtPath(doc: PromptDocument, path: PromptNodePath, node: PromptBlockNode): PromptDocument {
	const index = path.at(-1);
	if (typeof index !== "number") return doc;
	return updateAtPath(doc, path.slice(0, -1), (value) => {
		const next = Array.isArray(value) ? [...value] : [];
		next.splice(Math.min(Math.max(index, 0), next.length), 0, node);
		return next;
	});
}

function removeAtPath(doc: PromptDocument, path: PromptNodePath): PromptDocument {
	const index = path.at(-1);
	if (typeof index !== "number") return doc;
	return updateAtPath(doc, path.slice(0, -1), (value) =>
		Array.isArray(value) ? value.filter((_, itemIndex) => itemIndex !== index) : value,
	);
}

function updateAtPath<T>(value: T, path: PromptNodePath, update: (value: unknown) => unknown): T {
	if (path.length === 0) return update(value) as T;
	const [head, ...tail] = path;
	if (typeof head === "number") {
		const next = Array.isArray(value) ? [...value] : [];
		next[head] = updateAtPath(next[head], tail, update);
		return next as T;
	}
	const record = (value ?? {}) as Record<string, unknown>;
	return { ...record, [head]: updateAtPath(record[head], tail, update) } as T;
}

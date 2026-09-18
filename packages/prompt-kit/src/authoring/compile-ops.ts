import type { PromptBlockNode, PromptDocument } from "../document/nodes/types";
import { validatePromptDocumentShape } from "../document/schema/validate-shape";
import {
	PROMPT_DOCUMENT_ROOT_ID,
	type CompilePromptEditOpsResult,
	type ParsePromptEditOpsResult,
	type PromptBlockNodePatch,
	type PromptEditOp,
	type PromptEditOpError,
	type PromptStep,
} from "./types";
import { applyStep, childContainer, findBlock, preparedInsertStep } from "./tree";

/** Compile ID-relative operations sequentially against an immutable scratch document. */
export function compilePromptEditOps(
	doc: PromptDocument,
	ops: readonly PromptEditOp[],
): CompilePromptEditOpsResult {
	if (ops.length === 0) {
		return { ok: false, errors: [{ code: "empty_ops", opIndex: -1, message: "propose_transaction requires at least one op." }] };
	}
	const steps: PromptStep[] = [];
	const changedIds: string[] = [];
	let current = doc;
	for (let index = 0; index < ops.length; index += 1) {
		const outcome = compileOne(current, ops[index]!, index);
		if ("error" in outcome) return { ok: false, errors: [outcome.error] };
		steps.push(outcome.step);
		current = outcome.doc;
		if (!changedIds.includes(outcome.changedId)) changedIds.push(outcome.changedId);
	}
	return { ok: true, steps, doc: current, changedIds };
}

type One = { step: PromptStep; doc: PromptDocument; changedId: string } | { error: PromptEditOpError };

function compileOne(doc: PromptDocument, op: PromptEditOp, index: number): One {
	switch (op.op) {
		case "update_node": return compileUpdate(doc, op.nodeId, op.patch, index);
		case "insert_after": return compileInsertAfter(doc, op.refNodeId, op.node, index);
		case "insert_into": return compileInsertInto(doc, op.parentNodeId, op.index, op.node, index);
		case "remove_node": return compileRemove(doc, op.nodeId, index);
		case "move_after": return compileMoveAfter(doc, op.nodeId, op.refNodeId, index);
	}
}

function unknown(opIndex: number, nodeId: string, role: string): One {
	return { error: { code: "unknown_node", opIndex, nodeId, message: `Op ${opIndex}: no node "${nodeId}" (${role}) in the current document. Node ids are listed in the prompt address map.` } };
}

function compileUpdate(doc: PromptDocument, nodeId: string, patch: PromptBlockNodePatch, opIndex: number): One {
	const entry = findBlock(doc, nodeId, PROMPT_DOCUMENT_ROOT_ID);
	if (!entry) return unknown(opIndex, nodeId, "update_node target");
	const record = patch as Record<string, unknown>;
	if ("id" in record && record.id !== nodeId) return { error: { code: "cannot_change_id", opIndex, nodeId, message: `Op ${opIndex}: update_node must not change a node's id (ids anchor annotations).` } };
	if ("type" in record && record.type !== entry.node.type) return { error: { code: "cannot_change_type", opIndex, nodeId, message: `Op ${opIndex}: update_node must not change a node's type ("${entry.node.type}"). Remove and insert instead.` } };
	const allowed = PATCH_KEYS[entry.node.type];
	const invalidKey = Object.keys(record).find((key) => !allowed.has(key));
	if (invalidKey) return invalidPatch(opIndex, nodeId, `field ${JSON.stringify(invalidKey)} is not valid for a ${entry.node.type} node.`);
	const merged = mergePatch(entry.node, patch);
	const shape = validatePromptDocumentShape({
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "updated-node",
		nodes: [merged],
	});
	if (!shape.valid) return invalidPatch(opIndex, nodeId, shape.errors[0] ?? "patch produces an invalid node.");
	const diff = shallowDiff(entry.node, merged);
	if (!diff) return { error: { code: "noop_update", opIndex, nodeId, message: `Op ${opIndex}: update_node patch left "${nodeId}" unchanged.` } };
	const step: PromptStep = { op: "update", id: nodeId, ...diff };
	return { step, doc: applyStep(doc, step, PROMPT_DOCUMENT_ROOT_ID), changedId: nodeId };
}

const COMMON_PATCH_KEYS = ["id", "type", "metadata"] as const;
const patchKeys = (...keys: string[]): ReadonlySet<string> => new Set([...COMMON_PATCH_KEYS, ...keys]);
const PATCH_KEYS: Record<PromptBlockNode["type"], ReadonlySet<string>> = {
	section: patchKeys("tag", "title", "attrs", "children"),
	paragraph: patchKeys("content"),
	bulletList: patchKeys("items"),
	orderedList: patchKeys("items", "start"),
	field: patchKeys("label", "value", "children"),
	codeBlock: patchKeys("language", "code"),
	example: patchKeys("title", "children"),
	raw: patchKeys("value"),
	contextUsage: patchKeys("contextId", "tag", "instructions"),
};

function invalidPatch(opIndex: number, nodeId: string, detail: string): One {
	return { error: { code: "invalid_patch", opIndex, nodeId, message: `Op ${opIndex}: invalid update_node patch for "${nodeId}": ${detail}` } };
}

function compileInsertAfter(doc: PromptDocument, refNodeId: string, node: PromptBlockNode, opIndex: number): One {
	const ref = findBlock(doc, refNodeId, PROMPT_DOCUMENT_ROOT_ID);
	if (!ref) return unknown(opIndex, refNodeId, "insert_after reference");
	const step = preparedInsertStep(doc, [...ref.parentPath, ref.index + 1], node);
	return { step, doc: applyStep(doc, step, PROMPT_DOCUMENT_ROOT_ID), changedId: step.node.id ?? refNodeId };
}

function compileInsertInto(doc: PromptDocument, parentNodeId: string, index: number | undefined, node: PromptBlockNode, opIndex: number): One {
	let path: Array<string | number>;
	let length: number;
	if (parentNodeId === PROMPT_DOCUMENT_ROOT_ID) {
		path = ["nodes"];
		length = doc.nodes.length;
	} else {
		const parent = findBlock(doc, parentNodeId, PROMPT_DOCUMENT_ROOT_ID);
		if (!parent) return unknown(opIndex, parentNodeId, "insert_into parent");
		const container = childContainer(parent.node);
		if (!container) return { error: { code: "cannot_contain_children", opIndex, nodeId: parentNodeId, message: `Op ${opIndex}: node "${parentNodeId}" is a ${parent.node.type} and cannot contain block children. Use insert_after instead.` } };
		path = [...parent.path, container.key];
		length = container.nodes.length;
	}
	const position = index === undefined ? length : Math.min(Math.max(index, 0), length);
	const step = preparedInsertStep(doc, [...path, position], node);
	return { step, doc: applyStep(doc, step, PROMPT_DOCUMENT_ROOT_ID), changedId: step.node.id ?? parentNodeId };
}

function compileRemove(doc: PromptDocument, nodeId: string, opIndex: number): One {
	const entry = findBlock(doc, nodeId, PROMPT_DOCUMENT_ROOT_ID);
	if (!entry) return unknown(opIndex, nodeId, "remove_node target");
	const step: PromptStep = { op: "remove", path: entry.path, removed: entry.node };
	return { step, doc: applyStep(doc, step, PROMPT_DOCUMENT_ROOT_ID), changedId: nodeId };
}

function compileMoveAfter(doc: PromptDocument, nodeId: string, refNodeId: string, opIndex: number): One {
	const entry = findBlock(doc, nodeId, PROMPT_DOCUMENT_ROOT_ID);
	if (!entry) return unknown(opIndex, nodeId, "move_after subject");
	const ref = findBlock(doc, refNodeId, PROMPT_DOCUMENT_ROOT_ID);
	if (!ref) return unknown(opIndex, refNodeId, "move_after reference");
	if (nodeId === refNodeId || isPathPrefix(entry.path, ref.path)) return { error: { code: "move_ref_inside_subtree", opIndex, nodeId, message: `Op ${opIndex}: cannot move "${nodeId}" after "${refNodeId}" — the reference sits inside the moved subtree.` } };
	const remove: PromptStep = { op: "remove", path: entry.path, removed: entry.node };
	const without = applyStep(doc, remove, PROMPT_DOCUMENT_ROOT_ID);
	const refAfter = findBlock(without, refNodeId, PROMPT_DOCUMENT_ROOT_ID);
	if (!refAfter) return unknown(opIndex, refNodeId, "move_after reference");
	const step: PromptStep = { op: "move", from: entry.path, to: [...refAfter.parentPath, refAfter.index + 1] };
	return { step, doc: applyStep(doc, step, PROMPT_DOCUMENT_ROOT_ID), changedId: nodeId };
}

function mergePatch(node: PromptBlockNode, patch: PromptBlockNodePatch): PromptBlockNode {
	const merged = { ...node, ...patch } as unknown as Record<string, unknown>;
	for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
	return merged as unknown as PromptBlockNode;
}

function shallowDiff(before: PromptBlockNode, after: PromptBlockNode): { before: PromptBlockNodePatch; after: PromptBlockNodePatch } | undefined {
	const a = before as unknown as Record<string, unknown>;
	const b = after as unknown as Record<string, unknown>;
	const beforePatch: Record<string, unknown> = {};
	const afterPatch: Record<string, unknown> = {};
	let changed = false;
	for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
		if (deepEquals(a[key], b[key])) continue;
		beforePatch[key] = a[key]; afterPatch[key] = b[key]; changed = true;
	}
	return changed ? { before: beforePatch as PromptBlockNodePatch, after: afterPatch as PromptBlockNodePatch } : undefined;
}

function deepEquals(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => deepEquals(value, b[index]));
	const ar = a as Record<string, unknown>, br = b as Record<string, unknown>;
	const ak = Object.keys(ar).filter((key) => ar[key] !== undefined), bk = Object.keys(br).filter((key) => br[key] !== undefined);
	return ak.length === bk.length && ak.every((key) => deepEquals(ar[key], br[key]));
}

function isPathPrefix(prefix: readonly (string | number)[], path: readonly (string | number)[]): boolean {
	return prefix.length <= path.length && prefix.every((segment, index) => segment === path[index]);
}

/** Narrow untrusted JSON into semantic edit operations with stable typed errors. */
export function parsePromptEditOps(raw: unknown): ParsePromptEditOpsResult {
	if (!Array.isArray(raw)) return { ok: false, errors: [{ code: "invalid_op_shape", opIndex: -1, message: "ops must be an array of semantic ops." }] };
	const ops: PromptEditOp[] = [];
	for (let index = 0; index < raw.length; index += 1) {
		const parsed = parseOne(raw[index], index);
		if ("error" in parsed) return { ok: false, errors: [parsed.error] };
		ops.push(parsed.op);
	}
	return { ok: true, ops };
}

function shapeError(opIndex: number, message: string): { error: PromptEditOpError } {
	return { error: { code: "invalid_op_shape", opIndex, message: `Op ${opIndex}: ${message}` } };
}

function parseOne(raw: unknown, index: number): { op: PromptEditOp } | { error: PromptEditOpError } {
	if (!isObject(raw)) return shapeError(index, "each op must be an object.");
	const name = raw.op;
	const string = (key: string) => typeof raw[key] === "string" && raw[key].trim() ? raw[key] as string : undefined;
	const object = (key: string) => isObject(raw[key]) ? raw[key] as Record<string, unknown> : undefined;
	switch (name) {
		case "update_node": { const extra = unexpectedKey(raw, ["op", "nodeId", "patch"]); if (extra) return shapeError(index, `update_node does not allow field ${JSON.stringify(extra)}.`); const nodeId = string("nodeId"), patch = object("patch"); if (!nodeId) return shapeError(index, "update_node requires nodeId."); if (!patch || Object.keys(patch).length === 0) return shapeError(index, "update_node requires a non-empty patch object."); const patchExtra = Object.keys(patch).find((key) => !ALL_PATCH_KEYS.has(key)); return patchExtra ? shapeError(index, `update_node patch does not allow field ${JSON.stringify(patchExtra)}.`) : { op: { op: name, nodeId, patch: patch as PromptBlockNodePatch } }; }
		case "insert_after": { const extra = unexpectedKey(raw, ["op", "refNodeId", "node"]); if (extra) return shapeError(index, `insert_after does not allow field ${JSON.stringify(extra)}.`); const refNodeId = string("refNodeId"), node = object("node"); return !refNodeId ? shapeError(index, "insert_after requires refNodeId.") : !node || !isBlockNode(node) ? shapeError(index, "insert_after requires a valid block node.") : { op: { op: name, refNodeId, node: node as unknown as PromptBlockNode } }; }
		case "insert_into": { const extra = unexpectedKey(raw, ["op", "parentNodeId", "index", "node"]); if (extra) return shapeError(index, `insert_into does not allow field ${JSON.stringify(extra)}.`); const parentNodeId = string("parentNodeId"), node = object("node"), opIndex = raw.index; if (!parentNodeId) return shapeError(index, "insert_into requires parentNodeId."); if (!node || !isBlockNode(node)) return shapeError(index, "insert_into requires a valid block node."); if (opIndex !== undefined && (typeof opIndex !== "number" || !Number.isInteger(opIndex) || opIndex < 0)) return shapeError(index, "insert_into index must be a non-negative integer when given."); return { op: { op: name, parentNodeId, index: opIndex as number | undefined, node: node as unknown as PromptBlockNode } }; }
		case "remove_node": { const extra = unexpectedKey(raw, ["op", "nodeId"]); if (extra) return shapeError(index, `remove_node does not allow field ${JSON.stringify(extra)}.`); const nodeId = string("nodeId"); return nodeId ? { op: { op: name, nodeId } } : shapeError(index, "remove_node requires nodeId."); }
		case "move_after": { const extra = unexpectedKey(raw, ["op", "nodeId", "refNodeId"]); if (extra) return shapeError(index, `move_after does not allow field ${JSON.stringify(extra)}.`); const nodeId = string("nodeId"), refNodeId = string("refNodeId"); return !nodeId ? shapeError(index, "move_after requires nodeId.") : !refNodeId ? shapeError(index, "move_after requires refNodeId.") : { op: { op: name, nodeId, refNodeId } }; }
		default: return shapeError(index, `"op" must be one of update_node, insert_after, insert_into, remove_node, move_after (got ${JSON.stringify(name)}).`);
	}
}

const ALL_PATCH_KEYS = new Set(Object.values(PATCH_KEYS).flatMap((keys) => [...keys]));

function unexpectedKey(record: Record<string, unknown>, allowed: readonly string[]): string | undefined {
	const keys = new Set(allowed);
	return Object.keys(record).find((key) => !keys.has(key));
}

function isBlockNode(value: Record<string, unknown>): boolean {
	return validatePromptDocumentShape({
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "operation-node",
		nodes: [value],
	}).valid;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

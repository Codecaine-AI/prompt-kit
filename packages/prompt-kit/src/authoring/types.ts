import type { PromptBlockNode, PromptDocument } from "../document/nodes/types";
import type {
	PromptBlockNodePatch,
	PromptInsertStep,
	PromptMoveStep,
	PromptRemoveStep,
	PromptStep,
	PromptUpdateStep,
} from "../ui/editor/transactions";
import type { PromptNodePath } from "../ui/editor/model";

export type {
	PromptBlockNodePatch,
	PromptInsertStep,
	PromptMoveStep,
	PromptRemoveStep,
	PromptStep,
	PromptUpdateStep,
} from "../ui/editor/transactions";
export type { PromptNodePath } from "../ui/editor/model";

/** The stable address used by authoring clients for `PromptDocument.nodes`. */
export const PROMPT_DOCUMENT_ROOT_ID = "$root" as const;

export type PromptEditOp =
	| { op: "update_node"; nodeId: string; patch: PromptBlockNodePatch }
	| { op: "insert_after"; refNodeId: string; node: PromptBlockNode }
	| {
			op: "insert_into";
			/** A block node id, or `$root` for `PromptDocument.nodes`. */
			parentNodeId: string;
			index?: number;
			node: PromptBlockNode;
	  }
	| { op: "remove_node"; nodeId: string }
	| { op: "move_after"; nodeId: string; refNodeId: string };

export type PromptEditOpErrorCode =
	| "invalid_op_shape"
	| "invalid_patch"
	| "unknown_node"
	| "cannot_contain_children"
	| "cannot_change_id"
	| "cannot_change_type"
	| "noop_update"
	| "move_ref_inside_subtree"
	| "empty_ops";

export interface PromptEditOpError {
	code: PromptEditOpErrorCode;
	opIndex: number;
	nodeId?: string;
	message: string;
}

export interface CompilePromptEditOpsSuccess {
	ok: true;
	steps: PromptStep[];
	/** Scratch document with every operation applied. The input is not mutated. */
	doc: PromptDocument;
	changedIds: string[];
}

export interface CompilePromptEditOpsFailure {
	ok: false;
	errors: PromptEditOpError[];
}

export type CompilePromptEditOpsResult =
	| CompilePromptEditOpsSuccess
	| CompilePromptEditOpsFailure;

export type ParsePromptEditOpsResult =
	| { ok: true; ops: PromptEditOp[] }
	| { ok: false; errors: PromptEditOpError[] };

export interface PromptAddressEntry {
	nodeId: string;
	type: PromptBlockNode["type"];
	path: PromptNodePath;
	/** Structural parent. May name a non-addressable list item omitted from `nodes`. */
	parentNodeId: string;
	index: number;
}

export interface PromptAddressMap {
	rootId: typeof PROMPT_DOCUMENT_ROOT_ID;
	nodes: PromptAddressEntry[];
}

export type PromptLintProfile = "agent" | "single-output" | "generic";
export type PromptLintSeverity = "error" | "warning";

export interface PromptLintFinding {
	code: string;
	severity: PromptLintSeverity;
	message: string;
	nodeId?: string;
}

import { promptDocumentJsonSchema } from "../document/schema/prompt-document-schema";
import { PROMPT_DOCUMENT_ROOT_ID } from "./types";

const blockNode = { $ref: "#/$defs/promptBlockNode" } as const;
const nodeId = { type: "string", minLength: 1 } as const;
const inlineContent = { type: "array", items: { $ref: "#/$defs/promptInline" } } as const;
const blockChildren = { type: "array", items: blockNode } as const;
const promptNodePatch = {
	type: "object",
	additionalProperties: false,
	minProperties: 1,
	properties: {
		id: nodeId,
		type: { enum: ["section", "paragraph", "bulletList", "orderedList", "field", "codeBlock", "example", "raw", "contextUsage"] },
		metadata: { $ref: "#/$defs/promptMetadata" },
		tag: { type: "string" },
		title: { type: "string" },
		attrs: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] } },
		children: blockChildren,
		content: inlineContent,
		items: { type: "array", items: { $ref: "#/$defs/listItemNode" } },
		start: { type: "number" },
		label: { type: "string" },
		value: inlineContent,
		language: { type: "string" },
		code: { type: "string" },
		contextId: { type: "string" },
		instructions: blockChildren,
	},
} as const;

/** Strict JSON Schema for the semantic operation array accepted by authoring APIs. */
export const promptEditOpsJsonSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://codecaine.ai/schemas/prompt-kit/prompt-edit-ops.json",
	title: "PromptEditOps",
	type: "array",
	minItems: 1,
	items: {
		oneOf: [
			{ type: "object", additionalProperties: false, required: ["op", "nodeId", "patch"], properties: { op: { const: "update_node" }, nodeId, patch: promptNodePatch } },
			{ type: "object", additionalProperties: false, required: ["op", "refNodeId", "node"], properties: { op: { const: "insert_after" }, refNodeId: nodeId, node: blockNode } },
			{ type: "object", additionalProperties: false, required: ["op", "parentNodeId", "node"], properties: { op: { const: "insert_into" }, parentNodeId: { ...nodeId, description: `Block node id, or ${PROMPT_DOCUMENT_ROOT_ID} to insert into PromptDocument.nodes.` }, index: { type: "integer", minimum: 0 }, node: blockNode } },
			{ type: "object", additionalProperties: false, required: ["op", "nodeId"], properties: { op: { const: "remove_node" }, nodeId } },
			{ type: "object", additionalProperties: false, required: ["op", "nodeId", "refNodeId"], properties: { op: { const: "move_after" }, nodeId, refNodeId: nodeId } },
		],
	},
	$defs: promptDocumentJsonSchema.$defs,
} as const;

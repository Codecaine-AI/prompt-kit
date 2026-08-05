import { PROMPT_KIT_SCHEMA_VERSION } from "../nodes/types";

const promptMetadataSchema = {
  type: "object",
} as const;

const promptInlineContentSchema = {
  type: "array",
  items: { $ref: "#/$defs/promptInline" },
} as const;

const blockChildrenSchema = {
  type: "array",
  items: { $ref: "#/$defs/promptBlockNode" },
} as const;

/**
 * JSON Schema (draft 2020-12) for `PromptDocument` and every node type in
 * `src/nodes/types.ts`. Shared by the registry, the lab save endpoint, and
 * external tooling.
 */
export const promptDocumentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://codecaine.ai/schemas/prompt-kit/prompt-document.json",
  title: "PromptDocument",
  type: "object",
  required: ["kind", "schemaVersion", "id", "nodes"],
  properties: {
    kind: { const: "prompt" },
    schemaVersion: { const: PROMPT_KIT_SCHEMA_VERSION },
    id: { type: "string", minLength: 1 },
    title: { type: "string" },
    description: { type: "string" },
    archetype: { type: "string" },
    nodes: blockChildrenSchema,
    metadata: { $ref: "#/$defs/promptMetadata" },
  },
  $defs: {
    promptMetadata: promptMetadataSchema,
    promptInline: {
      anyOf: [
        { type: "string" },
        { $ref: "#/$defs/variableReferenceNode" },
        { $ref: "#/$defs/referenceNode" },
      ],
    },
    promptBlockNode: {
      anyOf: [
        { $ref: "#/$defs/sectionNode" },
        { $ref: "#/$defs/paragraphNode" },
        { $ref: "#/$defs/bulletListNode" },
        { $ref: "#/$defs/orderedListNode" },
        { $ref: "#/$defs/fieldNode" },
        { $ref: "#/$defs/codeBlockNode" },
        { $ref: "#/$defs/exampleNode" },
        { $ref: "#/$defs/rawNode" },
        { $ref: "#/$defs/contextUsageNode" },
      ],
    },
    sectionNode: {
      type: "object",
      required: ["type", "tag", "children"],
      properties: {
        type: { const: "section" },
        id: { type: "string" },
        tag: { type: "string", minLength: 1 },
        title: { type: "string" },
        attrs: {
          type: "object",
          additionalProperties: {
            type: ["string", "number", "boolean", "null"],
          },
        },
        children: blockChildrenSchema,
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    paragraphNode: {
      type: "object",
      required: ["type", "content"],
      properties: {
        type: { const: "paragraph" },
        id: { type: "string" },
        content: promptInlineContentSchema,
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    bulletListNode: {
      type: "object",
      required: ["type", "items"],
      properties: {
        type: { const: "bulletList" },
        id: { type: "string" },
        items: { type: "array", items: { $ref: "#/$defs/listItemNode" } },
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    orderedListNode: {
      type: "object",
      required: ["type", "items"],
      properties: {
        type: { const: "orderedList" },
        id: { type: "string" },
        start: { type: "number" },
        items: { type: "array", items: { $ref: "#/$defs/listItemNode" } },
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    listItemNode: {
      type: "object",
      required: ["type", "content"],
      properties: {
        type: { const: "listItem" },
        id: { type: "string" },
        content: promptInlineContentSchema,
        children: blockChildrenSchema,
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    fieldNode: {
      type: "object",
      required: ["type", "label", "value"],
      properties: {
        type: { const: "field" },
        id: { type: "string" },
        label: { type: "string", minLength: 1 },
        value: promptInlineContentSchema,
        children: blockChildrenSchema,
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    codeBlockNode: {
      type: "object",
      required: ["type", "code"],
      properties: {
        type: { const: "codeBlock" },
        id: { type: "string" },
        language: { type: "string" },
        code: { type: "string" },
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    exampleNode: {
      type: "object",
      required: ["type", "children"],
      properties: {
        type: { const: "example" },
        id: { type: "string" },
        title: { type: "string" },
        children: blockChildrenSchema,
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    rawNode: {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { const: "raw" },
        id: { type: "string" },
        value: { type: "string" },
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    contextUsageNode: {
      type: "object",
      required: ["type", "contextId", "instructions"],
      properties: {
        type: { const: "contextUsage" },
        id: { type: "string" },
        contextId: { type: "string", minLength: 1 },
        tag: { type: "string" },
        instructions: blockChildrenSchema,
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    variableReferenceNode: {
      type: "object",
      required: ["type", "name"],
      properties: {
        type: { const: "variable" },
        id: { type: "string" },
        name: { type: "string", minLength: 1 },
        fallback: promptInlineContentSchema,
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
    referenceNode: {
      type: "object",
      required: ["type", "kind", "name"],
      properties: {
        type: { const: "reference" },
        id: { type: "string" },
        kind: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        metadata: { $ref: "#/$defs/promptMetadata" },
      },
    },
  },
} as const;

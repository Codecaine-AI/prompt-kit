export const PROMPT_KIT_SCHEMA_VERSION = "prompt-kit/v1" as const;

export type PromptKitSchemaVersion = typeof PROMPT_KIT_SCHEMA_VERSION;

export type PromptArchetype = "singleOutput" | "workflow" | (string & {});

export type PromptMetadata = Record<string, unknown>;

export interface PromptNodeBase {
  id?: string;
  metadata?: PromptMetadata;
}

export interface PromptDocument {
  kind: "prompt";
  schemaVersion: PromptKitSchemaVersion;
  id: string;
  title?: string;
  description?: string;
  archetype?: PromptArchetype;
  nodes: PromptBlockNode[];
  metadata?: PromptMetadata;
}

export interface PromptDocumentInput {
  id: string;
  title?: string;
  description?: string;
  archetype?: PromptArchetype;
  nodes?: PromptBlockNode[];
  metadata?: PromptMetadata;
  schemaVersion?: PromptKitSchemaVersion;
}

export interface SectionNode extends PromptNodeBase {
  type: "section";
  tag: string;
  title?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  children: PromptBlockNode[];
}

export interface ParagraphNode extends PromptNodeBase {
  type: "paragraph";
  content: PromptInline[];
}

export interface BulletListNode extends PromptNodeBase {
  type: "bulletList";
  items: ListItemNode[];
}

export interface OrderedListNode extends PromptNodeBase {
  type: "orderedList";
  items: ListItemNode[];
  start?: number;
}

export interface ListItemNode extends PromptNodeBase {
  type: "listItem";
  content: PromptInline[];
  children?: PromptBlockNode[];
}

export interface FieldNode extends PromptNodeBase {
  type: "field";
  label: string;
  value: PromptInline[];
  children?: PromptBlockNode[];
}

export interface CodeBlockNode extends PromptNodeBase {
  type: "codeBlock";
  language?: string;
  code: string;
}

export interface ExampleNode extends PromptNodeBase {
  type: "example";
  title?: string;
  children: PromptBlockNode[];
}

export interface RawNode extends PromptNodeBase {
  type: "raw";
  value: string;
}

export interface ContextUsageNode extends PromptNodeBase {
  type: "contextUsage";
  contextId: string;
  tag?: string;
  instructions: PromptBlockNode[];
}

export interface VariableReferenceNode extends PromptNodeBase {
  type: "variable";
  name: string;
  fallback?: PromptInline[];
}

export interface ReferenceNode extends PromptNodeBase {
  type: "reference";
  kind: string;
  name: string;
}

export type PromptInline = string | VariableReferenceNode | ReferenceNode;

export type PromptListNode = BulletListNode | OrderedListNode;

export type PromptBlockNode =
  | SectionNode
  | ParagraphNode
  | BulletListNode
  | OrderedListNode
  | FieldNode
  | CodeBlockNode
  | ExampleNode
  | RawNode
  | ContextUsageNode;

export type PromptNode =
  | PromptDocument
  | PromptBlockNode
  | ListItemNode
  | VariableReferenceNode
  | ReferenceNode;

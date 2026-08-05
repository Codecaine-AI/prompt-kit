import { PROMPT_KIT_SCHEMA_VERSION } from "../nodes/types";

export interface PromptDocumentShapeResult {
  valid: boolean;
  errors: string[];
}

const BLOCK_NODE_TYPES = new Set([
  "section",
  "paragraph",
  "bulletList",
  "orderedList",
  "field",
  "codeBlock",
  "example",
  "raw",
  "contextUsage",
]);

/**
 * Structural validation of an untrusted value against the semantics of
 * `promptDocumentJsonSchema`. Implemented directly in TypeScript so callers
 * do not need a JSON Schema runtime; keep it in lockstep with the schema.
 */
export function validatePromptDocumentShape(
  value: unknown,
): PromptDocumentShapeResult {
  const errors: string[] = [];

  if (!isPlainObject(value)) {
    errors.push("document: expected an object");
    return { valid: false, errors };
  }

  if (value.kind !== "prompt") {
    errors.push(`document.kind: expected "prompt", got ${describe(value.kind)}`);
  }
  if (value.schemaVersion !== PROMPT_KIT_SCHEMA_VERSION) {
    errors.push(
      `document.schemaVersion: expected "${PROMPT_KIT_SCHEMA_VERSION}", got ${describe(value.schemaVersion)}`,
    );
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    errors.push(`document.id: expected a non-empty string, got ${describe(value.id)}`);
  }
  checkOptionalString(value, "title", "document.title", errors);
  checkOptionalString(value, "description", "document.description", errors);
  checkOptionalString(value, "archetype", "document.archetype", errors);
  checkOptionalMetadata(value, "document.metadata", errors);

  if (!Array.isArray(value.nodes)) {
    errors.push(`document.nodes: expected an array, got ${describe(value.nodes)}`);
  } else {
    value.nodes.forEach((node, index) => {
      validateBlockNode(node, `nodes[${index}]`, errors);
    });
  }

  return { valid: errors.length === 0, errors };
}

function validateBlockNode(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isPlainObject(value)) {
    errors.push(`${path}: expected an object, got ${describe(value)}`);
    return;
  }
  const type = value.type;
  if (typeof type !== "string" || !BLOCK_NODE_TYPES.has(type)) {
    errors.push(`${path}: unknown node type ${describe(type)}`);
    return;
  }

  checkOptionalString(value, "id", `${path}.id`, errors);
  checkOptionalMetadata(value, `${path}.metadata`, errors);

  switch (type) {
    case "section":
      checkRequiredString(value, "tag", path, "section", errors);
      validateAttrs(value.attrs, `${path}.attrs`, errors);
      checkOptionalString(value, "title", `${path}.title`, errors);
      validateBlockArray(value.children, `${path}.children`, path, "section", "children", errors, true);
      return;
    case "paragraph":
      validateInlineArray(value.content, `${path}.content`, path, "paragraph", "content", errors, true);
      return;
    case "bulletList":
    case "orderedList":
      if (type === "orderedList" && value.start !== undefined && typeof value.start !== "number") {
        errors.push(`${path}.start: expected a number, got ${describe(value.start)}`);
      }
      if (!Array.isArray(value.items)) {
        errors.push(
          `${path}: missing required field "items" on ${type} node (expected an array, got ${describe(value.items)})`,
        );
        return;
      }
      value.items.forEach((item, index) => {
        validateListItemNode(item, `${path}.items[${index}]`, errors);
      });
      return;
    case "field":
      checkRequiredString(value, "label", path, "field", errors);
      validateInlineArray(value.value, `${path}.value`, path, "field", "value", errors, true);
      validateBlockArray(value.children, `${path}.children`, path, "field", "children", errors, false);
      return;
    case "codeBlock":
      if (typeof value.code !== "string") {
        errors.push(`${path}: missing required field "code" on codeBlock node`);
      }
      checkOptionalString(value, "language", `${path}.language`, errors);
      return;
    case "example":
      checkOptionalString(value, "title", `${path}.title`, errors);
      validateBlockArray(value.children, `${path}.children`, path, "example", "children", errors, true);
      return;
    case "raw":
      if (typeof value.value !== "string") {
        errors.push(`${path}: missing required field "value" on raw node`);
      }
      return;
    case "contextUsage":
      checkRequiredString(value, "contextId", path, "contextUsage", errors);
      checkOptionalString(value, "tag", `${path}.tag`, errors);
      validateBlockArray(value.instructions, `${path}.instructions`, path, "contextUsage", "instructions", errors, true);
      return;
  }
}

function validateListItemNode(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isPlainObject(value)) {
    errors.push(`${path}: expected a listItem object, got ${describe(value)}`);
    return;
  }
  if (value.type !== "listItem") {
    errors.push(`${path}: expected node type "listItem", got ${describe(value.type)}`);
    return;
  }
  checkOptionalString(value, "id", `${path}.id`, errors);
  checkOptionalMetadata(value, `${path}.metadata`, errors);
  validateInlineArray(value.content, `${path}.content`, path, "listItem", "content", errors, true);
  validateBlockArray(value.children, `${path}.children`, path, "listItem", "children", errors, false);
}

function validateInlinePart(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (typeof value === "string") return;
  if (!isPlainObject(value)) {
    errors.push(
      `${path}: expected a string, variable, or reference, got ${describe(value)}`,
    );
    return;
  }
  if (value.type === "variable") {
    if (typeof value.name !== "string" || value.name.length === 0) {
      errors.push(`${path}: missing required field "name" on variable node`);
    }
    if (value.fallback !== undefined) {
      validateInlineArray(value.fallback, `${path}.fallback`, path, "variable", "fallback", errors, false);
    }
    return;
  }
  if (value.type === "reference") {
    if (typeof value.kind !== "string" || value.kind.length === 0) {
      errors.push(`${path}: missing required field "kind" on reference node`);
    }
    if (typeof value.name !== "string" || value.name.length === 0) {
      errors.push(`${path}: missing required field "name" on reference node`);
    }
    return;
  }
  errors.push(`${path}: unknown inline node type ${describe(value.type)}`);
}

function validateBlockArray(
  value: unknown,
  path: string,
  nodePath: string,
  nodeType: string,
  field: string,
  errors: string[],
  required: boolean,
): void {
  if (value === undefined) {
    if (required) {
      errors.push(`${nodePath}: missing required field "${field}" on ${nodeType} node`);
    }
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected an array, got ${describe(value)}`);
    return;
  }
  value.forEach((node, index) => {
    validateBlockNode(node, `${path}[${index}]`, errors);
  });
}

function validateInlineArray(
  value: unknown,
  path: string,
  nodePath: string,
  nodeType: string,
  field: string,
  errors: string[],
  required: boolean,
): void {
  if (value === undefined) {
    if (required) {
      errors.push(`${nodePath}: missing required field "${field}" on ${nodeType} node`);
    }
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected an array, got ${describe(value)}`);
    return;
  }
  value.forEach((part, index) => {
    validateInlinePart(part, `${path}[${index}]`, errors);
  });
}

function validateAttrs(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${path}: expected an object, got ${describe(value)}`);
    return;
  }
  for (const [key, member] of Object.entries(value)) {
    if (member === undefined || member === null) continue;
    const memberType = typeof member;
    if (memberType !== "string" && memberType !== "number" && memberType !== "boolean") {
      errors.push(
        `${path}.${key}: expected string, number, boolean, or null, got ${describe(member)}`,
      );
    }
  }
}

function checkRequiredString(
  value: Record<string, unknown>,
  field: string,
  nodePath: string,
  nodeType: string,
  errors: string[],
): void {
  const member = value[field];
  if (typeof member !== "string" || member.length === 0) {
    errors.push(
      `${nodePath}: missing required field "${field}" on ${nodeType} node (expected a non-empty string, got ${describe(member)})`,
    );
  }
}

function checkOptionalString(
  value: Record<string, unknown>,
  field: string,
  path: string,
  errors: string[],
): void {
  const member = value[field];
  if (member !== undefined && typeof member !== "string") {
    errors.push(`${path}: expected a string, got ${describe(member)}`);
  }
}

function checkOptionalMetadata(
  value: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  const member = value.metadata;
  if (member !== undefined && !isPlainObject(member)) {
    errors.push(`${path}: expected an object, got ${describe(member)}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return `${typeof value} ${String(value)}`;
}

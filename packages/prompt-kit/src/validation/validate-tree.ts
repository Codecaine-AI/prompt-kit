import {
  PROMPT_KIT_SCHEMA_VERSION,
  type PromptDocument,
  type PromptNode,
} from "../nodes/types";
import { isXmlName } from "../renderers/xml-markdown/escaping";
import { visitPrompt } from "../transforms/visit";
import type { PromptDiagnostic, PromptValidationResult } from "./diagnostics";

export interface ValidatePromptOptions {
  declaredVariables?: Iterable<string>;
}

export function validatePrompt(
  prompt: PromptDocument,
  options: ValidatePromptOptions = {},
): PromptValidationResult {
  const diagnostics: PromptDiagnostic[] = [];
  const ids = new Map<string, Array<string | number>>();
  const declaredVariables = options.declaredVariables
    ? new Set(options.declaredVariables)
    : undefined;

  if (prompt.schemaVersion !== PROMPT_KIT_SCHEMA_VERSION) {
    diagnostics.push({
      severity: "error",
      code: "unknown_schema_version",
      message: `Unsupported prompt schema version: ${prompt.schemaVersion}`,
      path: ["schemaVersion"],
    });
  }

  if (prompt.id.trim().length === 0) {
    diagnostics.push({
      severity: "error",
      code: "missing_prompt_id",
      message: "Prompt id must be non-empty.",
      path: ["id"],
    });
  }

  visitPrompt(prompt, (entry) => {
    validateNode(entry.node, entry.path, diagnostics, ids, declaredVariables);
  });

  for (const [id, firstPath] of ids.entries()) {
    const matches = collectIdPaths(prompt, id);
    if (matches.length > 1) {
      diagnostics.push({
        severity: "error",
        code: "duplicate_node_id",
        message: `Duplicate prompt node id: ${id}`,
        path: firstPath,
        nodeId: id,
      });
    }
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics,
  };
}

function validateNode(
  node: PromptNode,
  path: Array<string | number>,
  diagnostics: PromptDiagnostic[],
  ids: Map<string, Array<string | number>>,
  declaredVariables: Set<string> | undefined,
): void {
  if ("id" in node && node.id) {
    if (!ids.has(node.id)) ids.set(node.id, path);
  }

  if ("type" in node && node.type === "section" && !isXmlName(node.tag)) {
    diagnostics.push({
      severity: "error",
      code: "invalid_section_tag",
      message: `Section tag is not a valid XML name: ${node.tag}`,
      path: [...path, "tag"],
      nodeId: node.id,
    });
  }

  if ("type" in node && node.type === "contextUsage" && node.contextId.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "missing_context_id",
      message: "Context usage nodes must name a context id.",
      path: [...path, "contextId"],
      nodeId: node.id,
    });
  }

  if (
    "type" in node &&
    node.type === "variable" &&
    declaredVariables &&
    !declaredVariables.has(node.name)
  ) {
    diagnostics.push({
      severity: "error",
      code: "unknown_variable",
      message: `Prompt references undeclared variable: ${node.name}`,
      path,
      nodeId: node.id,
    });
  }
}

function collectIdPaths(
  prompt: PromptDocument,
  id: string,
): Array<Array<string | number>> {
  const paths: Array<Array<string | number>> = [];
  visitPrompt(prompt, (entry) => {
    if ("id" in entry.node && entry.node.id === id) {
      paths.push(entry.path);
    }
  });
  return paths;
}

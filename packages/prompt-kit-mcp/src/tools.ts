import {
  lintPrompt,
  parsePromptEditOps,
  promptEditOpsJsonSchema,
  readPromptAddressMap,
  type PromptEditOp,
  type PromptLintProfile,
} from "@codecaine-ai/prompt-kit/authoring";
import { validatePrompt } from "@codecaine-ai/prompt-kit";
import { confinePath, createPromptStore, type PromptStore, type PromptStoreFailure } from "@codecaine-ai/prompt-kit-server";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { DiscoveredPrompt, PromptProject } from "./discovery";

export interface PromptToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

export interface PromptTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: unknown): Promise<PromptToolResult>;
}

export interface PromptToolContext {
  resolveProject(projectId: string): Promise<PromptProject>;
  resolvePrompt(projectId: string, promptId: string): Promise<{ project: PromptProject; prompt: DiscoveredPrompt }>;
  onMutation?(event: { taskId?: string; projectId: string; promptId: string; hash: string }): void;
  onCheck?(event: { taskId?: string; projectId: string; promptId: string; hash: string; ok: boolean }): void;
  profileForTask?(taskId: string | undefined, fallback: PromptLintProfile): PromptLintProfile;
}

const string = { type: "string", minLength: 1 };
const targetProperties = { project: string, prompt_id: string };
const schema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false,
});
const embeddedPromptEditOpsSchema = structuredClone(promptEditOpsJsonSchema) as Record<string, unknown>;
const promptEditOpsDefinitions = embeddedPromptEditOpsSchema.$defs;
delete embeddedPromptEditOpsSchema.$defs;
delete embeddedPromptEditOpsSchema.$id;
delete embeddedPromptEditOpsSchema.$schema;

function result(data: Record<string, unknown>, error = data.ok === false): PromptToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, ...(error ? { isError: true } : {}) };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exact(args: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!record(args)) throw new Error("Tool arguments must be an object.");
  const allowed = new Set([...required, ...optional]);
  const extras = Object.keys(args).filter((key) => !allowed.has(key));
  if (extras.length) throw new Error(`Unknown argument${extras.length === 1 ? "" : "s"}: ${extras.join(", ")}.`);
  for (const key of required) {
    if (key === "ops") { if (!(key in args)) throw new Error("ops is required."); continue; }
    if (typeof args[key] !== "string" || !(args[key] as string).trim()) throw new Error(`${key} must be a non-empty string.`);
  }
  return args;
}

function storeFailure(value: PromptStoreFailure): PromptToolResult {
  return result({ ...value });
}

function strictOps(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) throw new Error("ops must be a non-empty array.");
  const fields: Record<string, Set<string>> = {
    update_node: new Set(["op", "nodeId", "patch"]), insert_after: new Set(["op", "refNodeId", "node"]),
    insert_into: new Set(["op", "parentNodeId", "index", "node"]), remove_node: new Set(["op", "nodeId"]),
    move_after: new Set(["op", "nodeId", "refNodeId"]),
  };
  value.forEach((raw, index) => {
    if (!record(raw) || typeof raw.op !== "string" || !fields[raw.op]) return;
    const extra = Object.keys(raw).filter((key) => !fields[raw.op as string]!.has(key));
    if (extra.length) throw new Error(`Op ${index}: unknown field${extra.length === 1 ? "" : "s"} ${extra.join(", ")}.`);
    if (raw.op === "insert_into" && raw.index !== undefined && (!Number.isInteger(raw.index) || (raw.index as number) < 0)) throw new Error(`Op ${index}: index must be a non-negative integer.`);
  });
}

/** Direct adapter over the shared filesystem store; no Kernel or model process is started. */
export function createPromptTools(context: PromptToolContext): PromptTool[] {
  const stores = new Map<string, PromptStore>();
  async function selected(args: Record<string, unknown>) {
    const projectId = args.project as string;
    const promptId = args.prompt_id as string;
    const selection = await context.resolvePrompt(projectId, promptId);
    let store = stores.get(selection.project.root);
    if (!store) { store = createPromptStore({ root: selection.project.root }); stores.set(selection.project.root, store); }
    return { ...selection, store, projectId, promptId };
  }
  function tool(name: string, description: string, inputSchema: Record<string, unknown>, execute: (args: Record<string, unknown>) => Promise<Record<string, unknown> | PromptToolResult>): PromptTool {
    return { name, description, inputSchema, execute: async (raw) => {
      try {
        const output = await execute(raw as Record<string, unknown>);
        return "content" in output ? output as PromptToolResult : result(output);
      } catch (error) { return result({ ok: false, detail: error instanceof Error ? error.message : String(error) }); }
    } };
  }
  async function snapshot(args: Record<string, unknown>) {
    const choice = await selected(args);
    const read = await choice.store.read(choice.prompt.target);
    if (!read.ok) return { choice, failure: storeFailure(read) };
    const validation = validatePrompt(read.document, { declaredVariables: choice.prompt.target.declaredVariables });
    const selectedProfile = context.profileForTask?.(args.task_id as string | undefined, choice.prompt.profile) ?? choice.prompt.profile;
    const findings = lintPrompt(read.document, selectedProfile);
    return { choice, read, validation, findings, selectedProfile };
  }
  async function currentDeclarations(choice: Awaited<ReturnType<typeof selected>>): Promise<string[] | undefined> {
    const source = choice.prompt.declarationSource;
    if (!source) return choice.prompt.target.declaredVariables;
    const file = await confinePath(choice.project.root, source);
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!record(value)) throw new Error("The current declaration source is not an object.");
    let declaration: Record<string, unknown>;
    let fingerprintValue: unknown = value;
    if (choice.prompt.declarationKind === "standalone") {
      const configured = value.standalonePrompts ?? value.standalone;
      if (!Array.isArray(configured)) throw new Error("The current standalone prompt declaration list is missing.");
      const matches = configured.filter((entry) => (typeof entry === "string" ? entry : record(entry) ? entry.path : undefined) === choice.prompt.declarationIdentity);
      if (matches.length !== 1) throw new Error("The standalone prompt declaration is missing or ambiguous. Run prompts_discover again.");
      fingerprintValue = matches[0];
      declaration = typeof matches[0] === "string" ? { path: matches[0] } : matches[0] as Record<string, unknown>;
    } else declaration = value;
    const currentFingerprint = createHash("sha256").update(JSON.stringify(fingerprintValue)).digest("hex");
    if (choice.prompt.declarationFingerprint && currentFingerprint !== choice.prompt.declarationFingerprint) {
      throw new Error("Prompt declaration configuration changed after discovery. Begin a new task from current discovery.");
    }
    const raw = choice.prompt.declarationKind === "agent" ? declaration.variables ?? {} : declaration.variables ?? declaration.declaredVariables;
    if (raw === undefined) return undefined;
    if (Array.isArray(raw) && raw.every((entry) => typeof entry === "string" && entry)) return [...new Set(raw)].sort();
    if (record(raw)) return Object.keys(raw).sort();
    throw new Error("The current agent variables declaration must be an object or array of names.");
  }

  return [
    tool("prompts_list", "List discovered prompts and per-entry discovery errors for one explicit project.", schema({ project: string }), async (raw) => {
      const args = exact(raw, ["project"]);
      const project = await context.resolveProject(args.project as string);
      return { ok: true, project: { id: project.id, name: project.name }, prompts: project.prompts, errors: project.errors };
    }),
    tool("prompts_read", "Read the normalized prompt, production render, current hash, stable address map, declarations, profile, and findings. Use hash as expected_hash for edits.", schema(targetProperties), async (raw) => {
      const args = exact(raw, ["project", "prompt_id"]);
      const state = await snapshot(args);
      if (state.failure) return state.failure;
      const { choice, read, validation, findings, selectedProfile } = state;
      return { ok: true, document: read.document, hash: read.hash, expected_hash: read.hash, rendered: read.rendered,
        address_map: readPromptAddressMap(read.document), declared_variables: choice.prompt.target.declaredVariables,
        variable_declarations_known: choice.prompt.target.declaredVariables !== undefined, profile: selectedProfile,
        validation, findings, prompt_path: read.promptPath, rendered_path: read.renderedPath };
    }),
    tool("prompts_apply_ops", "Apply an atomic batch of ID-relative prompt operations at the expected revision. Requires prompts_begin and task_id.", { ...schema({ ...targetProperties, task_id: string, expected_hash: string, ops: embeddedPromptEditOpsSchema }), $defs: promptEditOpsDefinitions }, async (raw) => {
      const args = exact(raw, ["project", "prompt_id", "task_id", "expected_hash", "ops"]);
      strictOps(args.ops);
      const parsed = parsePromptEditOps(args.ops);
      if (!parsed.ok) return { ok: false, detail: "Operation arguments failed validation.", errors: parsed.errors };
      const choice = await selected(args);
      const profile = context.profileForTask?.(args.task_id as string, choice.prompt.profile) ?? choice.prompt.profile;
      const changed = await choice.store.applyOps(choice.prompt.target, {
        ops: parsed.ops as PromptEditOp[], expectedHash: args.expected_hash as string, source: "prompt-kit-mcp",
        validate: async ({ document }) => {
          const declarations = await currentDeclarations(choice);
          if (declarations === undefined) return { ok: false as const, errors: ["Variable declarations are unknown. Add variables: [] (or the declared names) to the standalone prompt entry."] };
          const structural = validatePrompt(document, { declaredVariables: declarations });
          const errors = structural.diagnostics.filter((finding) => finding.severity === "error").map((finding) => `${finding.code}: ${finding.message}`);
          return errors.length ? { ok: false as const, errors } : { ok: true as const, declaredVariables: declarations };
        },
      });
      if (!changed.ok) return storeFailure(changed);
      context.onMutation?.({ taskId: args.task_id as string, projectId: choice.projectId, promptId: choice.promptId, hash: changed.hash });
      return { ...changed, expected_hash: changed.hash, profile, findings: lintPrompt(changed.document, profile),
        validation: validatePrompt(changed.document, { declaredVariables: choice.prompt.target.declaredVariables }),
        next: "Changes are saved. Run prompts_check for this revision before ending the task." };
    }),
    tool("prompts_undo", "Undo a change created through this service, only while its resulting revision is current. Requires prompts_begin and task_id.", schema({ ...targetProperties, task_id: string, change_id: string, expected_hash: string }), async (raw) => {
      const args = exact(raw, ["project", "prompt_id", "task_id", "change_id", "expected_hash"]);
      const choice = await selected(args);
      const profile = context.profileForTask?.(args.task_id as string, choice.prompt.profile) ?? choice.prompt.profile;
      const undone = await choice.store.undo(choice.prompt.target, {
        changeId: args.change_id as string, expectedHash: args.expected_hash as string, source: "prompt-kit-mcp",
        validate: async ({ document }) => {
          const declarations = await currentDeclarations(choice);
          if (declarations === undefined) return { ok: false as const, errors: ["Variable declarations are unknown. Add variables: [] (or the declared names) to the standalone prompt entry."] };
          const structural = validatePrompt(document, { declaredVariables: declarations });
          const errors = structural.diagnostics.filter((finding) => finding.severity === "error").map((finding) => `${finding.code}: ${finding.message}`);
          return errors.length ? { ok: false as const, errors } : { ok: true as const, declaredVariables: declarations };
        },
      });
      if (!undone.ok) return storeFailure(undone);
      context.onMutation?.({ taskId: args.task_id as string, projectId: choice.projectId, promptId: choice.promptId, hash: undone.hash });
      return { ...undone, expected_hash: undone.hash, profile,
        findings: lintPrompt(undone.document, profile), next: "Undo is saved. Run prompts_check for this revision." };
    }),
    tool("prompts_check", "Check the current revision for structural, variable, and selected profile findings. A missing declaration source is reported as unknown, not passing.", schema({ ...targetProperties, task_id: string }, ["project", "prompt_id"]), async (raw) => {
      const args = exact(raw, ["project", "prompt_id"], ["task_id"]);
      if (args.task_id !== undefined && (typeof args.task_id !== "string" || !args.task_id)) throw new Error("task_id must be a non-empty string.");
      const state = await snapshot(args);
      if (state.failure) return state.failure;
      const { choice, read, validation, findings, selectedProfile } = state;
      const declarationsKnown = choice.prompt.target.declaredVariables !== undefined;
      const blocking = [...validation.diagnostics.filter((item) => item.severity === "error"), ...findings.filter((item) => item.severity === "error"),
        ...(!declarationsKnown ? [{ code: "variable_declarations_unknown", severity: "error" as const,
          message: "Variable declarations are unknown. Declare variables: [] for no variables or list every supported name in codecaine.prompts.json." }] : [])];
      const ok = blocking.length === 0;
      context.onCheck?.({ taskId: args.task_id as string | undefined, projectId: choice.projectId, promptId: choice.promptId, hash: read.hash, ok });
      return { ok, hash: read.hash, expected_hash: read.hash, structurally_valid: validation.ok,
        variable_declarations_known: declarationsKnown, profile: selectedProfile, validation, findings, blocking };
    }),
  ];
}

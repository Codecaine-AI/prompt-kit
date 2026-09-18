import type { PromptDiagnostic, PromptDocument } from "@codecaine-ai/prompt-kit";
import type { PromptEditOp } from "@codecaine-ai/prompt-kit/authoring";

export interface PromptTarget {
  /** Canonical PromptDocument JSON path, relative to the store root. */
  promptPath: string;
  /** Derived Markdown path. Defaults by bundle form. */
  renderedPath?: string;
  /** Authoritative variable names when no mutation-time validator supplies them. */
  declaredVariables?: string[];
  /** Header written before the production render. Defaults to the Kernel-compatible header. */
  renderedHeader?: string;
}

export interface PromptSnapshot {
  ok: true;
  document: PromptDocument;
  hash: string;
  rendered: string;
  promptPath: string;
  renderedPath: string;
  /** True when mutation-time recovery repaired a previously incomplete derived write. */
  recovered?: boolean;
}

export type PromptStoreErrorCode =
  | "invalid_path"
  | "not_found"
  | "invalid_document"
  | "validation_failed"
  | "conflict"
  | "invalid_ops"
  | "change_not_found"
  | "undo_conflict"
  | "lock_timeout"
  | "storage_error";

export interface PromptStoreFailure {
  ok: false;
  code: PromptStoreErrorCode;
  status?: number;
  detail: string;
  currentHash?: string;
  /** True only when canonical prompt bytes reached their atomic commit point. */
  committed?: boolean;
  errors?: string[];
  diagnostics?: PromptDiagnostic[];
}

export interface PromptMutationSuccess extends PromptSnapshot {
  changeId: string;
  changedIds?: string[];
  source?: string;
}

export type PromptReadResult = PromptSnapshot | PromptStoreFailure;
export type PromptMutationResult = PromptMutationSuccess | PromptStoreFailure;

export interface PromptLatestChange {
  changeId: string;
  afterHash: string;
  source?: string;
}

export type PromptLatestChangeResult =
  | { ok: true; change: PromptLatestChange | null }
  | PromptStoreFailure;

export interface PromptValidationContext {
  root: string;
  target: PromptTarget;
  /** Disk-fresh normalized candidate, while the per-prompt lock is held. */
  document: PromptDocument;
  /** Production render before the generated-file header is applied. */
  rendered: string;
}

export type PromptValidationOutcome =
  | void
  | { ok: true; rendered?: string; declaredVariables?: string[] }
  | { ok: false; errors: string[] };

/** Called under the lock so hosts can reload fresh manifest state and declarations. */
export type PromptStoreValidator = (
  context: PromptValidationContext,
) => PromptValidationOutcome | Promise<PromptValidationOutcome>;

export interface SavePromptInput {
  document: PromptDocument;
  expectedHash: string;
  source?: string;
  validate?: PromptStoreValidator;
}

export interface ApplyPromptOpsInput {
  ops: readonly PromptEditOp[];
  expectedHash: string;
  source?: string;
  validate?: PromptStoreValidator;
}

export interface UndoPromptInput {
  changeId: string;
  expectedHash: string;
  source?: string;
  validate?: PromptStoreValidator;
}

export interface CreatePromptStoreOptions {
  root: string;
  /** Cross-process acquisition deadline. Default 10 seconds. */
  lockTimeoutMs?: number;
  /** Test/host override. Default is a machine-global temp directory. */
  lockRoot?: string;
  /** Test-only failure injection after the canonical commit point. */
  failAfterCanonicalCommit?: () => void | Promise<void>;
}

export interface PromptStore {
  readonly root: string;
  read(target: PromptTarget): Promise<PromptReadResult>;
  readLatestChange(target: PromptTarget, expectedHash: string): Promise<PromptLatestChangeResult>;
  save(target: PromptTarget, input: SavePromptInput): Promise<PromptMutationResult>;
  applyOps(target: PromptTarget, input: ApplyPromptOpsInput): Promise<PromptMutationResult>;
  undo(target: PromptTarget, input: UndoPromptInput): Promise<PromptMutationResult>;
}

export interface SavePromptFileOptions extends SavePromptInput {
  root?: string;
  renderedPath?: string;
  declaredVariables?: string[];
  renderedHeader?: string;
  lockTimeoutMs?: number;
  lockRoot?: string;
}

export interface ReadLatestPromptChangeOptions {
  root: string;
  target: PromptTarget;
  expectedHash: string;
  lockTimeoutMs?: number;
  lockRoot?: string;
}

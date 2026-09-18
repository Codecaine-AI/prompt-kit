import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import {
  canonicalizePrompt,
  ensurePromptNodeIds,
  hashPrompt,
  renderXmlMarkdown,
  validatePrompt,
  validatePromptDocumentShape,
  type PromptDocument,
} from "@codecaine-ai/prompt-kit";
import { compilePromptEditOps } from "@codecaine-ai/prompt-kit/authoring";

import { confinePath, PathConfinementError } from "./confine";
import type {
  ApplyPromptOpsInput,
  CreatePromptStoreOptions,
  PromptLatestChangeResult,
  PromptMutationResult,
  PromptReadResult,
  PromptStore,
  PromptStoreFailure,
  PromptTarget,
  PromptValidationOutcome,
  SavePromptFileOptions,
  ReadLatestPromptChangeOptions,
  SavePromptInput,
  UndoPromptInput,
} from "./types";

export const RENDERED_PROMPT_HEADER =
  "<!-- derived from prompt.json — do not edit. regenerate: bunx agent-kernel-render-prompts <catalog-root> -->\n\n";

interface ResolvedTarget {
  target: PromptTarget;
  promptFile: string;
  renderedFile: string;
  promptPath: string;
  renderedPath: string;
  journalDir: string;
  journalRelativeDir: string;
}

interface ChangeRecord {
  version: 1;
  id: string;
  promptFile: string;
  promptPath: string;
  scopeRoot: string;
  renderedFile: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  beforeHash: string;
  afterHash: string;
  beforeDocument: PromptDocument;
  afterDocument: PromptDocument;
  phase: "prepared" | "canonical_committed" | "complete" | "aborted";
  recovered?: boolean;
  undoOf?: string;
  rendered: string;
  renderedHeader: string;
}

interface LoadedPrompt {
  document: PromptDocument;
  hash: string;
}

interface LockOwner {
  version: 1;
  pid: number;
  processStartedAt: number;
  nonce: string;
  createdAt: number;
  promptFile: string;
}

interface ProcessLease {
  server: Server;
  sockets: Set<Socket>;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function createPromptStore(options: CreatePromptStoreOptions): PromptStore {
  const configuredRoot = resolve(options.root);
  const lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  const lockRoot = resolve(
    options.lockRoot ?? join(tmpdir(), `codecaine-prompt-kit-${uid}`, "locks"),
  );
  let rootPromise: Promise<string> | undefined;
  const getRoot = () => (rootPromise ??= realpath(configuredRoot));

  async function read(target: PromptTarget): Promise<PromptReadResult> {
    try {
      const root = await getRoot();
      const resolved = await resolveTarget(root, target, false);
      const loaded = await loadPrompt(resolved.promptFile, target.declaredVariables);
      const rendered = renderXmlMarkdown(loaded.document);
      return snapshot(resolved, loaded.document, rendered);
    } catch (error) {
      return failureFrom(error);
    }
  }

  async function readLatestChange(
    target: PromptTarget,
    expectedHash: string,
  ): Promise<PromptLatestChangeResult> {
    try {
      const root = await getRoot();
      const resolved = await resolveTarget(root, target, false);
      return await withPromptLock(resolved.promptFile, lockRoot, lockTimeoutMs, async () => {
        const current = await loadPrompt(resolved.promptFile, target.declaredVariables);
        if (current.hash !== expectedHash) {
          return {
            ...fail("conflict", "prompt changed since it was read", 409),
            currentHash: current.hash,
          };
        }
        const records = await loadChangeRecords(resolved);
        const latest = records
          .filter((record) => record.phase === "complete" && record.afterHash === current.hash)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        return {
          ok: true,
          change: latest
            ? { changeId: latest.id, afterHash: latest.afterHash, source: latest.source }
            : null,
        };
      });
    } catch (error) {
      return failureFrom(error);
    }
  }

  async function save(
    target: PromptTarget,
    input: SavePromptInput,
  ): Promise<PromptMutationResult> {
    return mutate(target, input.expectedHash, async (root, resolved, current) => {
      return commitCandidate(root, resolved, current, input.document, {
        source: input.source,
        validate: input.validate,
      });
    });
  }

  async function applyOps(
    target: PromptTarget,
    input: ApplyPromptOpsInput,
  ): Promise<PromptMutationResult> {
    return mutate(target, input.expectedHash, async (root, resolved, current) => {
      const compiled = compilePromptEditOps(current.document, input.ops);
      if (!compiled.ok) {
        return {
          ok: false,
          code: "invalid_ops",
          status: 422,
          detail: compiled.errors.map((error) => error.message).join("\n"),
          errors: compiled.errors.map((error) => error.message),
          committed: false,
        };
      }
      return commitCandidate(root, resolved, current, compiled.doc, {
        source: input.source,
        validate: input.validate,
        changedIds: compiled.changedIds,
      });
    });
  }

  async function undo(
    target: PromptTarget,
    input: UndoPromptInput,
  ): Promise<PromptMutationResult> {
    return mutate(target, input.expectedHash, async (root, resolved, current) => {
      if (!/^[a-z0-9]+-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.changeId)) {
        return fail("change_not_found", `invalid change id: ${input.changeId}`, 404);
      }
      const recordPath = join(resolved.journalDir, `${input.changeId}.json`);
      await rejectSymlink(recordPath, true);
      let record: ChangeRecord;
      try {
        record = JSON.parse(await readFile(recordPath, "utf8")) as ChangeRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return fail("change_not_found", `change not found: ${input.changeId}`, 404);
        }
        throw error;
      }
      if (
        record.id !== input.changeId ||
        record.promptFile !== resolved.promptFile ||
        record.scopeRoot !== root ||
        record.phase !== "complete"
      ) {
        return fail(
          "change_not_found",
          `change ${input.changeId} does not belong to this project and prompt`,
          404,
        );
      }
      if (record.renderedFile !== resolved.renderedFile || !validRecordHashes(record)) {
        throw Object.assign(new Error(`corrupt or mismatched change journal: ${record.id}`), {
          storeCode: "storage_error",
          status: 500,
        });
      }
      if (current.hash !== record.afterHash) {
        return {
          ...fail(
            "undo_conflict",
            `change ${input.changeId} is not the current prompt revision`,
            409,
          ),
          currentHash: current.hash,
        };
      }
      return commitCandidate(root, resolved, current, record.beforeDocument, {
        source: input.source ?? `undo:${input.changeId}`,
        validate: input.validate,
        undoOf: input.changeId,
      });
    });
  }

  async function mutate(
    target: PromptTarget,
    expectedHash: string,
    action: (
      root: string,
      target: ResolvedTarget,
      current: LoadedPrompt,
    ) => Promise<PromptMutationResult>,
  ): Promise<PromptMutationResult> {
    try {
      const root = await getRoot();
      const resolved = await resolveTarget(root, target, true);
      return await withPromptLock(
        resolved.promptFile,
        lockRoot,
        lockTimeoutMs,
        async () => {
          const recovered = await recoverIncomplete(resolved);
          const current = await loadPrompt(resolved.promptFile);
          if (current.hash !== expectedHash) {
            return {
              ...fail("conflict", "prompt changed since it was read", 409),
              currentHash: current.hash,
            };
          }
          const result = await action(root, resolved, current);
          if (result.ok && recovered) result.recovered = true;
          return result;
        },
      );
    } catch (error) {
      return failureFrom(error);
    }
  }

  async function commitCandidate(
    root: string,
    target: ResolvedTarget,
    current: LoadedPrompt,
    inputDocument: PromptDocument,
    meta: {
      source?: string;
      validate?: SavePromptInput["validate"];
      changedIds?: string[];
      undoOf?: string;
    },
  ): Promise<PromptMutationResult> {
    let committed = false;
    try {
      const prepared = prepareDocument(
        inputDocument,
        meta.validate ? undefined : target.target.declaredVariables,
      );
      if (!prepared.ok) return prepared.failure;
      const document = prepared.document;
      let rendered = renderXmlMarkdown(document);
      if (!meta.validate) {
        const rawVariableErrors = validateRenderedVariables(
          rendered,
          target.target.declaredVariables,
        );
        if (rawVariableErrors.length > 0) {
          return {
            ...fail("validation_failed", rawVariableErrors.join("\n"), 422),
            errors: rawVariableErrors,
          };
        }
      }
      if (meta.validate) {
        const validation = await meta.validate({
          root,
          target: target.target,
          document,
          rendered,
        });
        if (validation && !validation.ok) {
          return {
            ...fail("validation_failed", validation.errors.join("\n"), 422),
            errors: validation.errors,
          };
        }
        if (validation?.rendered !== undefined) rendered = validation.rendered;
        const effectiveDeclarations =
          validation?.declaredVariables ?? target.target.declaredVariables;
        const finalValidation = validatePrompt(document, {
          declaredVariables: effectiveDeclarations,
        });
        const finalErrors = finalValidation.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
        const rawVariableErrors = validateRenderedVariables(
          rendered,
          effectiveDeclarations,
        );
        const errors = [...finalErrors, ...rawVariableErrors];
        if (errors.length > 0) {
          return {
            ...fail("validation_failed", errors.join("\n"), 422),
            errors,
            diagnostics: finalValidation.diagnostics,
          };
        }
      }

      const afterHash = hashPrompt(document);
      const id = `${Date.now().toString(36)}-${randomUUID()}`;
      const now = new Date().toISOString();
      const record: ChangeRecord = {
        version: 1,
        id,
        promptFile: target.promptFile,
        promptPath: target.promptPath,
        scopeRoot: root,
        renderedFile: target.renderedFile,
        source: meta.source,
        createdAt: now,
        updatedAt: now,
        beforeHash: current.hash,
        afterHash,
        beforeDocument: current.document,
        afterDocument: document,
        phase: "prepared",
        undoOf: meta.undoOf,
        rendered,
        renderedHeader: target.target.renderedHeader ?? RENDERED_PROMPT_HEADER,
      };
      const journalFile = join(target.journalDir, `${id}.json`);
      await mkdir(target.journalDir, { recursive: true, mode: 0o700 });
      await rejectSymlink(target.journalDir);
      await atomicWrite(journalFile, jsonBytes(record));
      await atomicWrite(target.promptFile, canonicalizePrompt(document));
      committed = true;
      record.phase = "canonical_committed";
      record.updatedAt = new Date().toISOString();
      await atomicWrite(journalFile, jsonBytes(record));
      await options.failAfterCanonicalCommit?.();
      await atomicWrite(target.renderedFile, renderedBytes(target.target, rendered));
      record.phase = "complete";
      record.updatedAt = new Date().toISOString();
      await atomicWrite(journalFile, jsonBytes(record));
      return {
        ...snapshot(target, document, rendered),
        changeId: id,
        changedIds: meta.changedIds,
        source: meta.source,
      };
    } catch (error) {
      return {
        ...failureFrom(error),
        code: "storage_error",
        status: 500,
        committed,
      };
    }
  }

  return { root: configuredRoot, read, readLatestChange, save, applyOps, undo };
}

export async function readLatestPromptChange(
  options: ReadLatestPromptChangeOptions,
): Promise<PromptLatestChangeResult> {
  return createPromptStore({
    root: options.root,
    lockRoot: options.lockRoot,
    lockTimeoutMs: options.lockTimeoutMs,
  }).readLatestChange(options.target, options.expectedHash);
}

export async function savePromptFile(
  promptFile: string,
  options: SavePromptFileOptions,
): Promise<PromptMutationResult> {
  const absolute = resolve(promptFile);
  const root = resolve(options.root ?? dirname(absolute));
  const promptPath = relative(root, absolute);
  return createPromptStore({
    root,
    lockRoot: options.lockRoot,
    lockTimeoutMs: options.lockTimeoutMs,
  }).save(
    {
      promptPath,
      renderedPath: options.renderedPath,
      declaredVariables: options.declaredVariables,
      renderedHeader: options.renderedHeader,
    },
    {
      document: options.document,
      expectedHash: options.expectedHash,
      source: options.source,
      validate: options.validate,
    },
  );
}

async function resolveTarget(
  root: string,
  target: PromptTarget,
  mutation: boolean,
): Promise<ResolvedTarget> {
  if (target.promptPath.split(/[\\/]+/).includes(".prompt-kit")) {
    throw new PathConfinementError("prompt path must not use the store-owned .prompt-kit namespace");
  }
  const promptFile = await confinePath(root, target.promptPath);
  const defaultRendered =
    basename(promptFile) === "prompt.json" && basename(dirname(promptFile)) === "prompt"
      ? join(dirname(target.promptPath), "system.md")
      : join(dirname(target.promptPath), "prompt.rendered.md");
  const renderedRelative = target.renderedPath ?? defaultRendered;
  if (renderedRelative.split(/[\\/]+/).includes(".prompt-kit")) {
    throw new PathConfinementError("rendered path must not use the store-owned .prompt-kit namespace");
  }
  if (extname(renderedRelative).toLowerCase() !== ".md") {
    throw new PathConfinementError("rendered path must be a Markdown file");
  }
  const renderedFile = await confinePath(root, renderedRelative, {
    createParent: mutation,
  });
  if (renderedFile === promptFile) {
    throw new PathConfinementError("rendered path must differ from the canonical prompt path");
  }
  const journalRelativeDir = join(dirname(target.promptPath), ".prompt-kit", "changes");
  const journalDir = await confinePath(root, journalRelativeDir, {
    createParent: mutation,
  });
  return {
    target,
    promptFile,
    renderedFile,
    promptPath: target.promptPath,
    renderedPath: renderedRelative,
    journalDir,
    journalRelativeDir,
  };
}

function prepareDocument(
  value: PromptDocument,
  declaredVariables?: string[],
):
  | { ok: true; document: PromptDocument }
  | { ok: false; failure: PromptStoreFailure } {
  const shape = validatePromptDocumentShape(value);
  if (!shape.valid) {
    return {
      ok: false,
      failure: {
        ...fail("invalid_document", shape.errors.join("\n"), 422),
        errors: shape.errors,
      },
    };
  }
  // Round-trip canonical bytes before validation and return. This ensures the
  // in-memory object, hash, journal, and persisted JSON describe one exact value
  // even when an input object carried unknown properties.
  const document = JSON.parse(
    canonicalizePrompt(ensurePromptNodeIds(value)),
  ) as PromptDocument;
  const validation = validatePrompt(document, { declaredVariables });
  if (!validation.ok) {
    const errors = validation.diagnostics
      .filter((item) => item.severity === "error")
      .map((item) => `${item.code}: ${item.message}`);
    return {
      ok: false,
      failure: {
        ...fail("validation_failed", errors.join("\n"), 422),
        errors,
        diagnostics: validation.diagnostics,
      },
    };
  }
  return { ok: true, document };
}

async function loadPrompt(
  promptFile: string,
  declaredVariables?: string[],
): Promise<LoadedPrompt> {
  let raw: string;
  try {
    raw = await readFile(promptFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw Object.assign(new Error(`prompt not found: ${promptFile}`), {
        storeCode: "not_found",
        status: 404,
      });
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw Object.assign(new Error(`invalid prompt JSON: ${(error as Error).message}`), {
      storeCode: "invalid_document",
      status: 422,
    });
  }
  const prepared = prepareDocument(parsed as PromptDocument, declaredVariables);
  if (!prepared.ok) {
    throw Object.assign(new Error(prepared.failure.detail), {
      storeCode: prepared.failure.code,
      status: prepared.failure.status,
      errors: prepared.failure.errors,
      diagnostics: prepared.failure.diagnostics,
    });
  }
  const rawVariableErrors = validateRenderedVariables(
    renderXmlMarkdown(prepared.document),
    declaredVariables,
  );
  if (rawVariableErrors.length > 0) {
    throw Object.assign(new Error(rawVariableErrors.join("\n")), {
      storeCode: "validation_failed",
      status: 422,
      errors: rawVariableErrors,
    });
  }
  return { document: prepared.document, hash: hashPrompt(prepared.document) };
}

function validateRenderedVariables(rendered: string, declared?: string[]): string[] {
  if (declared === undefined) return [];
  const names = new Set(declared);
  const missing = new Set<string>();
  for (const match of rendered.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_.-]*)\}\}/g)) {
    if (!names.has(match[1]!)) missing.add(match[1]!);
  }
  return [...missing].sort().map((name) => `undeclared variable reference: {{${name}}}`);
}

function renderedBytes(target: PromptTarget, rendered: string): string {
  const header = target.renderedHeader ?? RENDERED_PROMPT_HEADER;
  return `${header}${rendered.endsWith("\n") ? rendered : `${rendered}\n`}`;
}

function snapshot(
  target: ResolvedTarget,
  document: PromptDocument,
  rendered: string,
): PromptReadResult & { ok: true } {
  return {
    ok: true,
    document,
    hash: hashPrompt(document),
    rendered,
    promptPath: target.promptPath,
    renderedPath: target.renderedPath,
  };
}

async function loadChangeRecords(target: ResolvedTarget): Promise<ChangeRecord[]> {
  let names: string[];
  try {
    names = await readdir(target.journalDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: ChangeRecord[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const file = join(target.journalDir, name);
    await rejectSymlink(file);
    let record: ChangeRecord;
    try {
      record = JSON.parse(await readFile(file, "utf8")) as ChangeRecord;
    } catch (error) {
      throw Object.assign(new Error(`corrupt change journal ${file}: ${(error as Error).message}`), {
        storeCode: "storage_error",
        status: 500,
      });
    }
    if (record.version !== 1 || !recordBindsToTarget(record, target)) continue;
    if (!validRecordHashes(record)) {
      throw Object.assign(new Error(`corrupt change journal hashes: ${record.id}`), {
        storeCode: "storage_error",
        status: 500,
      });
    }
    if (record.phase !== "complete" && record.renderedFile !== target.renderedFile) {
      throw Object.assign(new Error(`incomplete change ${record.id} targets a different derived render path`), {
        storeCode: "storage_error",
        status: 500,
      });
    }
    records.push(record);
  }
  return records;
}

async function recoverIncomplete(target: ResolvedTarget): Promise<boolean> {
  let names: string[];
  try {
    names = await readdir(target.journalDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  let recovered = false;
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const file = join(target.journalDir, name);
    let record: ChangeRecord;
    await rejectSymlink(file);
    try {
      record = JSON.parse(await readFile(file, "utf8")) as ChangeRecord;
    } catch (error) {
      throw Object.assign(new Error(`corrupt change journal ${file}: ${(error as Error).message}`), {
        storeCode: "storage_error",
        status: 500,
      });
    }
    if (
      record.version !== 1 ||
      (record.phase !== "prepared" && record.phase !== "canonical_committed")
    ) {
      continue;
    }
    if (!recordBindsToTarget(record, target)) continue;
    const relocated = record.promptFile !== target.promptFile;
    if (relocated) {
      record.promptFile = target.promptFile;
      record.renderedFile = target.renderedFile;
    }
    if (record.renderedFile !== target.renderedFile) {
      throw Object.assign(new Error(`change ${record.id} targets a different derived render path`), {
        storeCode: "storage_error",
        status: 500,
      });
    }
    if (!validRecordHashes(record)) {
      throw Object.assign(new Error(`corrupt change journal hashes: ${record.id}`), {
        storeCode: "storage_error",
        status: 500,
      });
    }
    const current = await loadPrompt(target.promptFile);
    if (current.hash === record.afterHash) {
      const rendered = record.rendered ?? renderXmlMarkdown(current.document);
      const recoveredTarget = {
        ...target.target,
        renderedHeader: record.renderedHeader ?? target.target.renderedHeader,
      };
      await atomicWrite(target.renderedFile, renderedBytes(recoveredTarget, rendered));
      record.phase = "complete";
      record.recovered = true;
      recovered = true;
    } else if (current.hash === record.beforeHash) {
      record.phase = "aborted";
    } else {
      throw Object.assign(
        new Error(`cannot recover change ${record.id}: canonical revision is unrelated`),
        { storeCode: "storage_error", status: 500 },
      );
    }
    record.updatedAt = new Date().toISOString();
    await atomicWrite(file, jsonBytes(record));
  }
  return recovered;
}

async function atomicWrite(path: string, bytes: string): Promise<void> {
  await rejectSymlink(path, true);
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  await rejectSymlink(parent);
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    const directory = await open(parent, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function rejectSymlink(path: string, allowMissing = false): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new PathConfinementError(`symlink path is not allowed: ${path}`);
    }
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function withPromptLock<T>(
  promptFile: string,
  lockRoot: string,
  timeoutMs: number,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(lockRoot, { recursive: true, mode: 0o700 });
  await rejectSymlink(lockRoot);
  const key = createHash("sha256").update(promptFile).digest("hex");
  const lockDir = join(lockRoot, `${key}.lock`);
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  // One deterministic port is authoritative for this prompt. Never fall back:
  // doing so could split contenders if an unrelated listener disappears.
  const leasePort = 10_000 + (Number.parseInt(key.slice(0, 8), 16) + Number(uid)) % 10_000;
  const nonce = randomUUID();
  const owner: LockOwner = {
    version: 1,
    pid: process.pid,
    processStartedAt: Date.now() - Math.floor(process.uptime() * 1000),
    nonce,
    createdAt: Date.now(),
    promptFile,
  };
  const started = Date.now();
  let lease: ProcessLease | undefined;
  while (!lease) {
    lease = await tryAcquireLease(leasePort);
    if (!lease) await waitForLock(started, timeoutMs, promptFile);
  }
  try {
    if (await pathExists(lockDir)) {
      // Holding the keyed OS lease proves no compliant writer is active, even
      // when a crashed owner's PID has since been recycled.
      await rm(lockDir, { recursive: true, force: true });
    }
    await mkdir(lockDir, { mode: 0o700 });
    await atomicWrite(join(lockDir, "owner.json"), jsonBytes(owner));
    try {
      return await action();
    } finally {
      await removeOwnedLock(lockDir, nonce);
    }
  } finally {
    await closeLease(lease);
  }
}

async function tryAcquireLease(port: number): Promise<ProcessLease | undefined> {
  return await new Promise((resolveLease, rejectLease) => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.destroy();
    });
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeAllListeners();
      if (error.code === "EADDRINUSE") resolveLease(undefined);
      else rejectLease(error);
    };
    server.once("error", onError);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.removeListener("error", onError);
      resolveLease({ server, sockets });
    });
  });
}

async function closeLease(lease: ProcessLease): Promise<void> {
  for (const socket of lease.sockets) socket.destroy();
  await new Promise<void>((resolveClose) => lease.server.close(() => resolveClose()));
}

async function waitForLock(started: number, timeoutMs: number, promptFile: string): Promise<void> {
  if (Date.now() - started >= timeoutMs) {
    throw Object.assign(new Error(`timed out waiting for prompt lock: ${promptFile}`), {
      storeCode: "lock_timeout",
      status: 503,
    });
  }
  await sleep(10 + Math.floor(Math.random() * 20));
}

async function removeOwnedLock(lockDir: string, nonce: string): Promise<void> {
  try {
    const actual = JSON.parse(await readFile(join(lockDir, "owner.json"), "utf8")) as LockOwner;
    if (actual.nonce === nonce) await rm(lockDir, { recursive: true, force: true });
  } catch {
    // A missing lock is already released; a changed nonce belongs to another owner.
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function recordBindsToTarget(record: ChangeRecord, target: ResolvedTarget): boolean {
  if (record.promptFile === target.promptFile) return true;
  // Journals are colocated with the canonical prompt. If that whole directory
  // is relocated, bind the record by its filename and unchanged derived-file
  // layout so an interrupted commit cannot become invisible after the move.
  return (
    basename(record.promptFile) === basename(target.promptFile) &&
    relative(dirname(record.promptFile), record.renderedFile) ===
      relative(dirname(target.promptFile), target.renderedFile)
  );
}

function validRecordHashes(record: ChangeRecord): boolean {
  try {
    return (
      hashPrompt(record.beforeDocument) === record.beforeHash &&
      hashPrompt(record.afterDocument) === record.afterHash
    );
  } catch {
    return false;
  }
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fail(
  code: PromptStoreFailure["code"],
  detail: string,
  status?: number,
): PromptStoreFailure {
  return { ok: false, code, status, detail, committed: false };
}

function failureFrom(error: unknown): PromptStoreFailure {
  if (error instanceof PathConfinementError) {
    return fail("invalid_path", error.message, 400);
  }
  const shaped = error as Error & {
    storeCode?: PromptStoreFailure["code"];
    status?: number;
    errors?: string[];
    diagnostics?: PromptStoreFailure["diagnostics"];
  };
  return {
    ...fail(shaped.storeCode ?? "storage_error", shaped.message ?? String(error), shaped.status ?? 500),
    errors: shaped.errors,
    diagnostics: shaped.diagnostics,
  };
}

import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

import {
  validatePromptAnnotationsDocument,
  type AnnotationReply,
  type PromptAnnotation,
  type PromptAnnotationsDocument,
  type PromptAnnotationThread,
  type ValidationIssue,
} from "@codecaine-ai/prompt-kit/annotations";

import { confinePath, PathConfinementError } from "./confine";
import { atomicWrite, withPromptLock } from "./store";

/**
 * Server store for prompt annotations (human requests and notes), keyed by
 * the prompt's catalog path relative to the project root. Each prompt's
 * annotations persist beside it at
 * `<prompt dir>/.prompt-kit/annotations/<stem>.annotations.json`, next to the
 * prompt store's `.prompt-kit/changes` journal, and every write takes the same
 * cross-process lock and atomic write the prompt store uses.
 */

export type PromptAnnotationChange = "created" | "replied" | "resolved" | "thread";

/** One annotation created or changed. Published in-process; served as SSE. */
export type PromptAnnotationEvent = {
  /** Absolute project root the catalog path is relative to. */
  root: string;
  /** Prompt catalog path, relative to `root`. */
  path: string;
  annotationId: string;
  change: PromptAnnotationChange;
  intent: string;
  status: string;
  thread: PromptAnnotationThread | null;
  /** Annotations document hash after the change. */
  hash: string;
  actor: string;
};

export type PromptAnnotationErrorCode =
  | "invalid_path"
  | "not_found"
  | "invalid_input"
  | "annotation_not_found"
  | "duplicate_id"
  | "conflict"
  | "lock_timeout"
  | "storage_error";

export interface PromptAnnotationFailure {
  ok: false;
  code: PromptAnnotationErrorCode;
  status: number;
  detail: string;
  currentHash?: string;
  issues?: ValidationIssue[];
}

export interface PromptAnnotationsSnapshot {
  ok: true;
  path: string;
  annotations: PromptAnnotation[];
  hash: string;
}

export type PromptAnnotationsResult = PromptAnnotationsSnapshot | PromptAnnotationFailure;
export type PromptAnnotationMutationResult =
  | (PromptAnnotationsSnapshot & { annotation: PromptAnnotation; reply?: AnnotationReply })
  | PromptAnnotationFailure;

interface Guarded {
  /** Rejects the write when the annotations document moved past this hash. */
  expectedHash?: string;
}

export interface AddPromptAnnotationInput extends Guarded {
  /** Client-chosen id, so an optimistic UI keeps its id. Generated when absent. */
  id?: string;
  target: unknown;
  body: string;
  intent: string;
  author: string;
}

export interface ReplyPromptAnnotationInput extends Guarded {
  id?: string;
  author: string;
  body: string;
}

export interface ResolvePromptAnnotationInput extends Guarded {
  resolution?: string;
  actor?: string;
}

export interface SetPromptAnnotationThreadInput extends Guarded {
  /** The binding to store, or null to clear it. */
  thread: PromptAnnotationThread | null;
  actor?: string;
}

export interface PromptAnnotationFileStore {
  readonly root: string;
  list(path: string): Promise<PromptAnnotationsResult>;
  add(path: string, input: AddPromptAnnotationInput): Promise<PromptAnnotationMutationResult>;
  reply(path: string, annotationId: string, input: ReplyPromptAnnotationInput): Promise<PromptAnnotationMutationResult>;
  resolve(path: string, annotationId: string, input?: ResolvePromptAnnotationInput): Promise<PromptAnnotationMutationResult>;
  setThread(path: string, annotationId: string, input: SetPromptAnnotationThreadInput): Promise<PromptAnnotationMutationResult>;
}

export interface CreatePromptAnnotationFileStoreOptions {
  root: string;
  lockRoot?: string;
  lockTimeoutMs?: number;
}

type Listener = (event: PromptAnnotationEvent) => void;
const listeners = new Set<Listener>();

/** Publishes to every in-process subscriber (the SSE route, tests). */
export function publishPromptAnnotationEvent(event: PromptAnnotationEvent): void {
  for (const listener of [...listeners]) listener(event);
}

/** Subscribes to every annotation event in this process; returns unsubscribe. */
export function subscribeToPromptAnnotationEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function promptAnnotationsHash(document: PromptAnnotationsDocument): string {
  return `pka1-${createHash("sha256").update(documentBytes(document)).digest("hex")}`;
}

export function createPromptAnnotationFileStore(
  options: CreatePromptAnnotationFileStoreOptions,
): PromptAnnotationFileStore {
  const root = resolve(options.root);
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  const lockRoot = resolve(options.lockRoot ?? join(tmpdir(), `codecaine-prompt-kit-${uid}`, "locks"));
  const lockTimeoutMs = options.lockTimeoutMs ?? 10_000;

  async function sidecarFor(path: string, create: boolean): Promise<string> {
    if (path.split(/[\\/]+/).includes(".prompt-kit")) {
      throw new PathConfinementError("prompt path must not use the store-owned .prompt-kit namespace");
    }
    const promptFile = await confinePath(root, path);
    const stat = await lstat(promptFile).catch(() => null);
    if (!stat?.isFile()) throw failure("not_found", `prompt not found: ${path}`, 404);
    const stem = basename(path, extname(path));
    const relativeSidecar = join(dirname(path), ".prompt-kit", "annotations", `${stem}.annotations.json`);
    return confinePath(root, relativeSidecar, { createParent: create });
  }

  async function load(file: string): Promise<PromptAnnotationsDocument> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, annotations: [] };
      throw error;
    }
    const validated = validatePromptAnnotationsDocument(JSON.parse(raw));
    if (!validated.ok) {
      throw failure("storage_error", `stored annotations are invalid: ${file}: ${JSON.stringify(validated.issues)}`, 500);
    }
    return validated.document;
  }

  async function list(path: string): Promise<PromptAnnotationsResult> {
    try {
      const document = await load(await sidecarFor(path, false));
      return { ok: true, path, annotations: document.annotations, hash: promptAnnotationsHash(document) };
    } catch (error) {
      return failureFrom(error);
    }
  }

  /** Read, change, validate, and write one prompt's annotations under its lock. */
  async function mutate(
    path: string,
    guard: Guarded,
    change: (annotations: PromptAnnotation[]) =>
      | { annotations: PromptAnnotation[]; annotation: PromptAnnotation; reply?: AnnotationReply; event: PromptAnnotationChange; actor: string }
      | PromptAnnotationFailure,
  ): Promise<PromptAnnotationMutationResult> {
    try {
      const file = await sidecarFor(path, true);
      const result = await withPromptLock(file, lockRoot, lockTimeoutMs, async () => {
        const current = await load(file);
        const currentHash = promptAnnotationsHash(current);
        if (guard.expectedHash !== undefined && guard.expectedHash !== currentHash) {
          return { ...failure("conflict", "annotations changed since they were read", 409), currentHash };
        }
        const next = change(current.annotations);
        if ("ok" in next) return next;
        const validated = validatePromptAnnotationsDocument({ schemaVersion: 1, annotations: next.annotations });
        if (!validated.ok) {
          return {
            ...failure("invalid_input", validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"), 422),
            issues: validated.issues,
          };
        }
        await atomicWrite(file, documentBytes(validated.document));
        const annotation = validated.document.annotations.find((entry) => entry.id === next.annotation.id)!;
        const hash = promptAnnotationsHash(validated.document);
        return { ok: true as const, path, annotations: validated.document.annotations, hash, annotation,
          ...(next.reply ? { reply: next.reply } : {}), event: next.event, actor: next.actor };
      });
      if (!result.ok) return result;
      const { event, actor, ...snapshot } = result;
      publishPromptAnnotationEvent({
        root, path, annotationId: snapshot.annotation.id, change: event, intent: snapshot.annotation.intent,
        status: snapshot.annotation.status, thread: snapshot.annotation.thread ?? null, hash: snapshot.hash, actor,
      });
      return snapshot;
    } catch (error) {
      return failureFrom(error);
    }
  }

  function update(
    annotations: PromptAnnotation[],
    id: string,
    apply: (annotation: PromptAnnotation) => PromptAnnotation,
  ): { annotations: PromptAnnotation[]; annotation: PromptAnnotation } | PromptAnnotationFailure {
    const existing = annotations.find((entry) => entry.id === id);
    if (!existing) return failure("annotation_not_found", `annotation not found: ${id}`, 404);
    const annotation = apply(existing);
    return { annotation, annotations: annotations.map((entry) => (entry.id === id ? annotation : entry)) };
  }

  return {
    root,
    list,
    add: (path, input) =>
      mutate(path, input, (annotations) => {
        const id = input.id ?? randomUUID();
        if (annotations.some((entry) => entry.id === id)) return failure("duplicate_id", `annotation id already exists: ${id}`, 409);
        const annotation = {
          id, target: input.target, body: input.body, intent: input.intent, author: input.author,
          status: "open", createdAt: new Date().toISOString(),
        } as PromptAnnotation;
        return { annotations: [...annotations, annotation], annotation, event: "created", actor: input.author };
      }),
    reply: (path, annotationId, input) =>
      mutate(path, input, (annotations) => {
        const reply: AnnotationReply = { id: input.id ?? randomUUID(), author: input.author, body: input.body, createdAt: new Date().toISOString() };
        const existing = annotations.find((entry) => entry.id === annotationId);
        if (existing?.replies?.some((entry) => entry.id === reply.id)) return failure("duplicate_id", `reply id already exists: ${reply.id}`, 409);
        const next = update(annotations, annotationId, (annotation) => ({ ...annotation, replies: [...(annotation.replies ?? []), reply] }));
        return "ok" in next ? next : { ...next, reply, event: "replied", actor: input.author };
      }),
    resolve: (path, annotationId, input = {}) =>
      mutate(path, input, (annotations) => {
        const next = update(annotations, annotationId, (annotation) => ({
          ...annotation, status: "resolved", ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        }));
        return "ok" in next ? next : { ...next, event: "resolved", actor: input.actor ?? "unknown" };
      }),
    setThread: (path, annotationId, input) =>
      mutate(path, input, (annotations) => {
        const next = update(annotations, annotationId, ({ thread: _previous, ...annotation }) =>
          input.thread ? { ...annotation, thread: input.thread } : annotation);
        return "ok" in next ? next : { ...next, event: "thread", actor: input.actor ?? "unknown" };
      }),
  };
}

function documentBytes(document: PromptAnnotationsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function failure(code: PromptAnnotationErrorCode, detail: string, status: number): PromptAnnotationFailure {
  return { ok: false, code, status, detail };
}

function failureFrom(error: unknown): PromptAnnotationFailure {
  if (error instanceof PathConfinementError) return failure("invalid_path", error.message, 400);
  const shaped = error as Partial<PromptAnnotationFailure> & { storeCode?: PromptAnnotationErrorCode; message?: string };
  if (shaped && shaped.ok === false && shaped.code) return shaped as PromptAnnotationFailure;
  if (shaped?.storeCode) return failure(shaped.storeCode, shaped.message ?? String(error), shaped.status ?? 500);
  return failure("storage_error", error instanceof Error ? error.message : String(error), 500);
}

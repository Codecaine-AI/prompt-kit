/**
 * Headless annotation store for hosts without a server. Pure TS — no React
 * import. `document()`/`list()` return immutable snapshots whose identity
 * only changes on mutation, so React hosts can plug `subscribe`/`document`
 * straight into `useSyncExternalStore`.
 */

import type {
  AnnotationReply,
  PromptAnnotation,
  PromptAnnotationIntent,
  PromptAnnotationsDocument,
  PromptAnnotationTarget,
} from "./schema";

export type AnnotationStoreAddInput = {
  target: PromptAnnotationTarget;
  body: string;
  intent: PromptAnnotationIntent;
  author: string;
};

export type AnnotationStoreReplyInput = {
  author: string;
  body: string;
};

export type PromptAnnotationStore = {
  /** Appends an open annotation (generated id + createdAt) and returns it. */
  add(input: AnnotationStoreAddInput): PromptAnnotation;
  /**
   * Marks the annotation resolved, persisting `resolution` when given.
   * Returns the updated annotation, or undefined when the id is unknown.
   */
  resolve(id: string, resolution?: string): PromptAnnotation | undefined;
  /**
   * Appends a reply (generated id + createdAt) to the annotation's thread —
   * the running exchange with the agent about that requested change. Returns
   * the reply, or undefined when the annotation id is unknown.
   */
  addReply(
    annotationId: string,
    input: AnnotationStoreReplyInput,
  ): AnnotationReply | undefined;
  list(): PromptAnnotation[];
  document(): PromptAnnotationsDocument;
  /** Notifies on every mutation; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
};

export function createAnnotationStore(
  initial?: PromptAnnotationsDocument,
): PromptAnnotationStore {
  let doc: PromptAnnotationsDocument = {
    schemaVersion: 1,
    annotations: initial ? [...initial.annotations] : [],
  };
  const listeners = new Set<() => void>();

  function commit(annotations: PromptAnnotation[]): void {
    doc = { schemaVersion: 1, annotations };
    for (const listener of [...listeners]) listener();
  }

  return {
    add(input) {
      const annotation: PromptAnnotation = {
        id: crypto.randomUUID(),
        target: input.target,
        body: input.body,
        intent: input.intent,
        author: input.author,
        status: "open",
        createdAt: new Date().toISOString(),
      };
      commit([...doc.annotations, annotation]);
      return annotation;
    },
    resolve(id, resolution) {
      const existing = doc.annotations.find((annotation) => annotation.id === id);
      if (!existing) return undefined;
      const updated: PromptAnnotation = {
        ...existing,
        status: "resolved",
        ...(resolution !== undefined ? { resolution } : {}),
      };
      commit(
        doc.annotations.map((annotation) =>
          annotation.id === id ? updated : annotation,
        ),
      );
      return updated;
    },
    addReply(annotationId, input) {
      const existing = doc.annotations.find(
        (annotation) => annotation.id === annotationId,
      );
      if (!existing) return undefined;
      const reply: AnnotationReply = {
        id: crypto.randomUUID(),
        author: input.author,
        body: input.body,
        createdAt: new Date().toISOString(),
      };
      const updated: PromptAnnotation = {
        ...existing,
        replies: [...(existing.replies ?? []), reply],
      };
      commit(
        doc.annotations.map((annotation) =>
          annotation.id === annotationId ? updated : annotation,
        ),
      );
      return reply;
    },
    list: () => doc.annotations,
    document: () => doc,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

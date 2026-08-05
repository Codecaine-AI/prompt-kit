"use client";

/**
 * Prompt-kit annotation pane — binds the generic `AnnotationPanel` from
 * `@codecaine-ai/annotations/react` to prompt-kit's annotation targets
 * (prompt-node and prompt-range) and the headless `createAnnotationStore`.
 *
 * The pane is LIST-ONLY: composing happens in the anchored
 * `AnnotationComposerPopover` next to the target (see the lab shell), so the
 * panel renders with `showComposer={false}` and an empty state that points at
 * the prompt surface. Every annotation is an agent request — the single
 * intent option keeps the intent picker hidden everywhere.
 *
 * Focus-clicks in the list map back to `onSelectNode` with the target's node
 * id — both target kinds carry one. Annotations live in the passed store; the
 * pane subscribes via `useSyncExternalStore` so external mutations re-render
 * it.
 *
 * Run `ensurePromptNodeIds` on the prompt before annotating so every node
 * (and list item) is addressable.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  AnnotationPanel,
  type AddAnnotationInput,
  type AnnotationPanelIntentOption,
  type RunAgentResult,
  type UndoPatchResult,
} from "@codecaine-ai/annotations/react";

import type { PromptDocument } from "../../document/nodes/types";
import {
  promptAnnotationSchema,
  type PromptAnnotationIntent,
  type PromptAnnotationTarget,
} from "../../annotations/schema";
import type { PromptAnnotationStore } from "../../annotations/store";

/** Result of a host agent run kicked off from an agent-request annotation. */
export type PromptAnnotationRunAgentResult = RunAgentResult;
/** Result of a host undo of a previously-applied agent patch. */
export type PromptAnnotationUndoPatchResult = UndoPatchResult;

/**
 * The one intent prompt-kit offers: every annotation is an agent request.
 * A single option keeps the panel's (and popover's) intent picker hidden.
 */
export const PROMPT_ANNOTATION_INTENT_OPTIONS: AnnotationPanelIntentOption[] = [
  {
    value: "agent-request",
    label: "Agent request",
    hint: "Ask an agent to act on this.",
  },
];

export interface PromptAnnotationsPaneProps {
  /** The prompt document annotations target. Its `id` is the stable docId. */
  prompt: PromptDocument;
  /** Host selection setter for focus-clicks; called with the target's nodeId. */
  onSelectNode?: (id: string | undefined) => void;
  /** Annotation store (see `createAnnotationStore`). */
  store: PromptAnnotationStore;
  /** Author recorded on new annotations. Defaults to "you". */
  author?: string;
  /**
   * Kicks off an agent run for an agent-request annotation. Passed straight
   * through to the panel — omitted, the Run-agent button never renders.
   */
  onRunAgent?: (annotationId: string) => Promise<PromptAnnotationRunAgentResult>;
  /**
   * Undoes a previously-applied agent patch. Passed straight through to the
   * panel — omitted, the Undo button never renders.
   */
  onUndoPatch?: (
    patchId: string,
    changedIds?: string[],
  ) => Promise<PromptAnnotationUndoPatchResult>;
  className?: string;
}

export function PromptAnnotationsPane({
  prompt,
  onSelectNode,
  store,
  author = "you",
  onRunAgent,
  onUndoPatch,
  className,
}: PromptAnnotationsPaneProps) {
  const doc = useSyncExternalStore(store.subscribe, store.document, store.document);

  const danglingReasons = useMemo(() => {
    const dangling = promptAnnotationSchema.detectDanglingTargets(doc, {
      "prompt-node": prompt,
      "prompt-range": prompt,
    });
    return new Map(dangling.map((entry) => [entry.annotationId, entry.reason]));
  }, [doc, prompt]);

  // The panel requires a clear handler even with no composer on screen.
  const handleClearSelection = useCallback(() => {
    onSelectNode?.(undefined);
  }, [onSelectNode]);

  const handleAddAnnotation = useCallback(
    async (input: AddAnnotationInput<PromptAnnotationTarget>) => {
      store.add({
        target: input.target,
        body: input.body,
        intent: input.intent as PromptAnnotationIntent,
        author,
      });
    },
    [store, author],
  );

  const handleResolveAnnotation = useCallback(
    async (annotationId: string) => {
      store.resolve(annotationId);
    },
    [store],
  );

  const handleFocusTarget = useCallback(
    (target: PromptAnnotationTarget) => {
      onSelectNode?.(target.nodeId);
    },
    [onSelectNode],
  );

  // Reply threads: each annotation is a running exchange with the agent
  // about that requested change; replies land on the annotation in the store.
  const handleAddReply = useCallback(
    async (annotationId: string, body: string) => {
      store.addReply(annotationId, { author, body });
    },
    [store, author],
  );

  return (
    <AnnotationPanel<PromptAnnotationTarget>
      annotations={doc.annotations}
      selection={null}
      showComposer={false}
      emptyState="No annotations yet. Click a node or select text in the prompt to request a change."
      intentOptions={PROMPT_ANNOTATION_INTENT_OPTIONS}
      targetKey={promptAnnotationSchema.targetKey}
      targetLabel={promptAnnotationSchema.targetLabel}
      danglingReasons={danglingReasons}
      onClearSelection={handleClearSelection}
      onAddAnnotation={handleAddAnnotation}
      onResolveAnnotation={handleResolveAnnotation}
      onFocusTarget={handleFocusTarget}
      onRunAgent={onRunAgent}
      onUndoPatch={onUndoPatch}
      onAddReply={handleAddReply}
      className={className}
    />
  );
}

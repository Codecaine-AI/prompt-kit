"use client";

// The prompt lab shell: LEFT is a statusbar over the pure editor surface (or
// the read-only context surface); RIGHT is a collapsible tabbed inspector —
// AGENT / DETAILS / REVISIONS — that collapses away entirely.

import cn from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PromptDocument } from "../../index";
import {
  createPromptEditorModel,
  type PromptStep,
} from "../editors";
import { estimateTokenCount } from "tokenx";

import { PromptFlowInspector } from "../prompt-flow/PromptFlowInspector";
import { PromptFlowXml } from "../prompt-flow/PromptFlowXml";
import { createPromptLabHistory } from "./prompt-lab-history";
import {
  loadPromptStyleSettings,
  promptStyleVars,
  type PromptStyleSettings,
} from "../style/prompt-style-settings";
import { AgentZone } from "./AgentZone";
import {
  createAutosaveController,
  type AutosaveController,
  type AutosaveControllerState,
} from "./autosave-controller";
import { ContextSurface, type LabContextPreview } from "./ContextSurface";
import {
  LabInspector,
  loadLabInspectorPreference,
  saveLabInspectorPreference,
} from "./LabInspector";
import { LabStatusBar, type LabView } from "./LabStatusBar";

// Directory entry point: the shell itself plus the pieces a host composes
// around it (the style rail it docks, the undo history it owns, the context
// preview shape it is fed).
export { PromptStyleRail, type PromptStyleRailProps } from "./PromptStyleRail";
export type { LabContextPreview } from "./ContextSurface";
export type { LabView } from "./LabStatusBar";
export {
  createPromptLabHistory,
  type PromptLabHistory,
  type PromptLabMetaPatch,
} from "./prompt-lab-history";
export {
  createAutosaveController,
  type AutosaveController,
  type AutosaveControllerOptions,
  type AutosaveControllerState,
  type AutosaveScheduler,
} from "./autosave-controller";

export type PromptSaveOutcome = { hash: string } | { errors: string[] };
export type ManifestSaveOutcome = { ok: true } | { errors: string[] };

/** AGENT-tab manifest fields surfaced + editable in the inspector. */
export interface LabManifest {
  name: string;
  model: string;
  description: string;
  modelAliases: string[];
  /** When false the AGENT-tab inputs are read-only (no save endpoint). */
  editable: boolean;
}

export interface PromptInlineLabProps {
  prompt: PromptDocument;
  declaredVariables?: string[];
  renderVariables?: Record<string, unknown>;
  className?: string;
  onDraftChange?: (prompt: PromptDocument) => void;
  /**
   * Persists the current prompt draft. Autosave debounces this call after
   * edits; on `{ hash }` the draft becomes the new saved baseline (undo
   * history survives), on `{ errors }` the messages render under the
   * statusbar. The lab never fetches.
   */
  onSave?: (doc: PromptDocument) => Promise<PromptSaveOutcome>;
  /**
   * Content hash of the currently saved prompt revision. Not surfaced by the
   * lab shell itself — the hash lives in the host page header and the
   * REVISIONS tab — but kept in the contract for hosts that pass it.
   */
  savedHash?: string;
  /** AGENT-tab manifest data (name/model/description + alias suggestions). */
  manifest?: LabManifest;
  /** Persists AGENT-tab edits (model/description). */
  onManifestSave?: (patch: {
    model: string;
    description: string;
  }) => Promise<ManifestSaveOutcome>;
  /** Read-only context preview shown when the statusbar selects CONTEXT. */
  context?: LabContextPreview;
  /**
   * Viewer-only style settings controlled by the host. When omitted, the lab
   * reads the persisted settings once while mounting.
   */
  styleSettings?: PromptStyleSettings;
  /**
   * REVISIONS-tab content (stats + history + diff). Host-composed — see
   * AgentPromptLabContainer.
   */
  revisionsZone?: React.ReactNode;
}

export function PromptInlineLab({
  prompt,
  declaredVariables = [],
  renderVariables,
  className,
  onDraftChange,
  onSave,
  manifest,
  onManifestSave,
  context,
  styleSettings,
  revisionsZone,
}: PromptInlineLabProps) {
  const [history, setHistory] = useState(() => createPromptLabHistory(prompt));
  const [editVersion, setEditVersion] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(
    undefined,
  );
  const [autosaveState, setAutosaveState] = useState<AutosaveControllerState>({
    pending: false,
    saving: false,
  });
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<Date | undefined>(undefined);
  const [view, setView] = useState<LabView>("system");
  const [inspector, setInspector] = useState(() =>
    loadLabInspectorPreference(),
  );
  // The section outline is part of the editor surface, not an option. It
  // needs real width to be worth its column, so the one guard is geometric:
  // below the breakpoint it is not rendered and costs nothing.
  const [outlineFits, setOutlineFits] = useState(true);
  const rootRef = useRef<HTMLElement | null>(null);
  const [persistedStyleSettings] = useState(() =>
    styleSettings ?? loadPromptStyleSettings(),
  );

  // AGENT-tab local edit state (model/description), reset when the source
  // manifest identity changes.
  const [model, setModel] = useState(manifest?.model ?? "");
  const [description, setDescription] = useState(manifest?.description ?? "");
  const [manifestSaving, setManifestSaving] = useState(false);
  const [manifestError, setManifestError] = useState<string | undefined>(
    undefined,
  );

  const bump = useCallback(() => setEditVersion((version) => version + 1), []);

  // The autosave controller outlives renders; callbacks reach the live
  // history/onSave through refs so the controller itself stays stable.
  const controllerRef = useRef<AutosaveController<PromptDocument> | null>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const ensureController = useCallback((): AutosaveController<PromptDocument> => {
    controllerRef.current ??= createAutosaveController<
      PromptDocument,
      PromptSaveOutcome
    >({
      save: (doc) => {
        const save = onSaveRef.current;
        if (!save) return Promise.resolve({ errors: ["No save endpoint"] });
        return save(doc);
      },
      onStateChange: setAutosaveState,
      onSuccess: (outcome, completion) => {
        if ("hash" in outcome) {
          setSaveErrors([]);
          setLastSavedAt(new Date());
          if (completion.isLatest) {
            historyRef.current.markSaved();
            bump();
          }
        } else {
          setSaveErrors(outcome.errors);
        }
      },
      onFailure: (error) => {
        setSaveErrors([
          error instanceof Error ? error.message : "Save failed",
        ]);
      },
    });
    return controllerRef.current;
  }, [bump]);

  useEffect(() => {
    setHistory(createPromptLabHistory(prompt));
    setSelectedNodeId(undefined);
    setSaveErrors([]);
    // A document swap invalidates any queued or in-flight save of the
    // previous document; dispose suppresses its completions entirely.
    controllerRef.current?.dispose();
    controllerRef.current = null;
    setAutosaveState({ pending: false, saving: false });
  }, [prompt]);

  useEffect(
    () => () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    setModel(manifest?.model ?? "");
    setDescription(manifest?.description ?? "");
    setManifestError(undefined);
  }, [manifest?.name, manifest?.model, manifest?.description]);

  useEffect(() => {
    saveLabInspectorPreference(inspector);
  }, [inspector]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const check = () =>
      setOutlineFits(element.clientWidth >= OUTLINE_MIN_CONTAINER_WIDTH);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // history.current() builds a fresh object; key the memo on the edit
  // version so the model (and prompt identity handed to views) stays stable
  // between edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const draftPrompt = useMemo(() => history.current(), [history, editVersion]);
  const model_ = useMemo(
    () =>
      createPromptEditorModel(draftPrompt, {
        selectedNodeId,
        declaredVariables,
        renderVariables,
      }),
    [draftPrompt, selectedNodeId, declaredVariables, renderVariables],
  );

  const dirty = history.isDirty();
  const diagnostics = model_.validation.diagnostics;
  const errorCount = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const promptTokenCount = useMemo(
    () => estimateTokenCount(model_.rendered),
    [model_.rendered],
  );
  const contextTokenCount = useMemo(
    () => estimateTokenCount(context?.renderedContext ?? ""),
    [context?.renderedContext],
  );
  const explicitSelectedEntry = selectedNodeId
    ? model_.tree.find((entry) => entry.id === selectedNodeId)
    : undefined;
  const appliedStyleSettings = styleSettings ?? persistedStyleSettings;
  const styleVars = useMemo(
    () => promptStyleVars(appliedStyleSettings),
    [appliedStyleSettings],
  );

  const manifestDirty = Boolean(
    manifest &&
    (model !== manifest.model || description !== manifest.description),
  );
  const inContext = view === "context";

  // Autosave: a dirty, valid draft saves shortly after the last edit; an
  // invalid or clean draft cancels queued work (validation gates every save).
  useEffect(() => {
    if (!onSave) return;
    const controller = ensureController();
    if (!dirty || errorCount > 0) {
      controller.cancelPending();
      return;
    }
    controller.schedule(draftPrompt);
  }, [draftPrompt, dirty, errorCount, onSave, ensureController]);

  function handleSelectNode(nodeId?: string) {
    setSelectedNodeId(nodeId);
    // Selecting a block steers an open inspector to DETAILS; a collapsed
    // inspector stays collapsed.
    if (nodeId) {
      setInspector((preference) =>
        preference.collapsed || preference.activeTab === "details"
          ? preference
          : { ...preference, activeTab: "details" },
      );
    }
  }

  function handlePromptChange(
    nextPrompt: PromptDocument,
    nextSelectedNodeId?: string,
    steps?: PromptStep[],
  ) {
    let changed: boolean;
    if (steps) {
      changed = steps.length > 0 && history.commitSteps(steps);
    } else {
      changed = history.commitMeta({
        title: nextPrompt.title,
        description: nextPrompt.description,
      });
    }
    setSelectedNodeId(nextSelectedNodeId);
    if (changed) {
      bump();
      onDraftChange?.(history.current());
    }
  }

  function undo() {
    if (!history.undo()) return;
    bump();
    onDraftChange?.(history.current());
  }

  function redo() {
    if (!history.redo()) return;
    bump();
    onDraftChange?.(history.current());
  }

  async function handleManifestSave() {
    if (!onManifestSave || manifestSaving || !manifestDirty) return;
    setManifestSaving(true);
    setManifestError(undefined);
    try {
      const outcome = await onManifestSave({ model, description });
      if (!("ok" in outcome)) {
        setManifestError(outcome.errors.join("; "));
      }
    } catch (error) {
      setManifestError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setManifestSaving(false);
    }
  }

  /**
   * ⌘Z / ⌘⇧Z / ⌘S are bound on the document rather than as a React onKeyDown
   * on the root. Clicking an affordance that then unmounts itself — the insert
   * palette, a delete button — leaves focus on <body>, which is outside this
   * tree, so a React handler stops firing at exactly the moment the user
   * reaches for undo. The guard keeps the shortcut scoped: it runs for events
   * inside the lab, or when nothing at all holds focus.
   */
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const root = rootRef.current;
    if (!root) return;
    const target = event.target;
    const inside = target instanceof Node && root.contains(target);
    const active = root.ownerDocument.activeElement;
    if (!inside && active !== null && active !== root.ownerDocument.body) return;

    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      if (!inContext) ensureController().flush();
      return;
    }
    if (key !== "z") return;
    if (inContext) return;
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcutRef.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  return (
    <section
      ref={rootRef}
      style={styleVars}
      className={cn(
        "@container flex h-full min-h-0 flex-1 flex-col bg-card font-mono",
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT: statusbar over the editor surface — nothing else. In
            context view the read-only context surface takes its place. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <LabStatusBar
            view={view}
            onViewChange={setView}
            tokenCount={inContext ? contextTokenCount : promptTokenCount}
            errorCount={errorCount}
            canUndo={history.canUndo()}
            canRedo={history.canRedo()}
            dirty={dirty}
            hasSave={Boolean(onSave)}
            savePending={autosaveState.pending}
            saving={autosaveState.saving}
            saveErrors={saveErrors}
            lastSavedAt={lastSavedAt}
            inspectorCollapsed={inspector.collapsed}
            onUndo={undo}
            onRedo={redo}
            onRetrySave={() => ensureController().retry()}
            onOpenInspector={() =>
              setInspector((preference) => ({
                ...preference,
                collapsed: false,
              }))
            }
          />

          {saveErrors.length > 0 && (
            <div className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-3 py-1.5">
              {saveErrors.map((message, index) => (
                <p
                  key={`save:${index}`}
                  className="break-words text-[11px] leading-snug text-destructive"
                >
                  {message}
                </p>
              ))}
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {inContext ? (
              <ContextSurface context={context} />
            ) : (
              <PromptFlowXml
                prompt={model_.prompt}
                model={model_}
                selectedEntry={explicitSelectedEntry}
                selectedNodeId={selectedNodeId}
                onSelectNode={handleSelectNode}
                onPromptChange={handlePromptChange}
                showOutline={outlineFits}
              />
            )}
          </div>
        </div>

        {/* RIGHT: tabbed inspector; collapsed renders nothing at all. */}
        {!inspector.collapsed && (
          <LabInspector
            activeTab={inspector.activeTab}
            onActiveTabChange={(tab) =>
              setInspector((preference) => ({
                ...preference,
                activeTab: tab,
              }))
            }
            onCollapse={() =>
              setInspector((preference) => ({
                ...preference,
                collapsed: true,
              }))
            }
            agent={
              manifest ? (
                <AgentZone
                  name={manifest.name}
                  model={model}
                  description={description}
                  modelAliases={manifest.modelAliases}
                  dirty={manifestDirty}
                  saving={manifestSaving}
                  canSave={manifest.editable && Boolean(onManifestSave)}
                  onModelChange={setModel}
                  onDescriptionChange={setDescription}
                  onSave={() => void handleManifestSave()}
                  error={manifestError}
                />
              ) : (
                <TabPlaceholder>
                  No agent manifest accompanies this prompt.
                </TabPlaceholder>
              )
            }
            details={
              <PromptFlowInspector
                prompt={model_.prompt}
                model={model_}
                selectedEntry={explicitSelectedEntry}
                onPromptChange={handlePromptChange}
              />
            }
            revisions={
              revisionsZone ?? (
                <TabPlaceholder>
                  No revision history for this prompt.
                </TabPlaceholder>
              )
            }
          />
        )}
      </div>
    </section>
  );
}

/**
 * Below this lab-container width the outline column is omitted entirely —
 * the editor pane left over would be too cramped to read.
 */
const OUTLINE_MIN_CONTAINER_WIDTH = 1100;

function TabPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center p-5">
      <p className="max-w-52 text-center text-[12px] leading-relaxed text-muted-foreground/70">
        {children}
      </p>
    </div>
  );
}

"use client";

// The prompt lab shell: LEFT is a statusbar over the pure editor surface (or
// the read-only context surface); RIGHT is a collapsible tabbed inspector —
// AGENT / DETAILS / REVISIONS — that collapses away entirely. The statusbar's
// ANNOTATE toggle flips the lab into annotate mode, which swaps the right-hand
// inspector for the annotations pane (node clicks then pick annotation
// targets instead of steering inspector tabs).

import cn from "classnames";
import { PanelRightClose } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AnnotationComposerPopover,
  DEFAULT_SKIP_SELECTOR,
  useTargeting,
  type ResolvedTarget,
} from "@codecaine-ai/annotations/react";
import type { PromptDocument } from "../../index";
import {
  createPromptEditorModel,
  promptBlockLabel,
  type PromptStep,
} from "../editors";
import { estimateTokenCount } from "tokenx";

import { PromptFlowInspector } from "../prompt-flow/PromptFlowInspector";
import { PromptFlowXml } from "../prompt-flow/PromptFlowXml";
import { buildXmlLineModel } from "../prompt-flow/xml-line-model";
import {
  annotationRowElements,
  promptRangeRowElements,
  annotationScopeChain,
  buildAnnotationParentMap,
  mapDomRangeToPromptRange,
  closestPromptRow,
  rowDisplayRegions,
} from "./annotation-targeting";
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
import {
  createAnnotationStore,
  type PromptAnnotationStore,
} from "../../annotations/store";
import {
  promptAnnotationSchema,
  targetForNode,
  type PromptAnnotationIntent,
  type PromptAnnotationTarget,
} from "../../annotations/schema";
import {
  PromptAnnotationsPane,
  type PromptAnnotationRunAgentResult,
  type PromptAnnotationUndoPatchResult,
} from "../annotations/PromptAnnotationsPane";

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

/**
 * EDIT is the default authoring mode; ANNOTATE swaps the right-hand inspector
 * for the annotations pane and points node selection at annotation targets.
 */
export type LabMode = "edit" | "annotate";

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
  /**
   * Store backing annotate mode. When omitted the lab owns an in-memory
   * store, so annotate mode works out of the box (annotations then live only
   * as long as the lab instance).
   */
  annotationStore?: PromptAnnotationStore;
  /**
   * Sends an agent-request annotation off to be fixed. Threaded to the
   * annotations pane's Run-agent button — omitted, the button never renders.
   */
  onAnnotationAgentRun?: (
    annotationId: string,
  ) => Promise<PromptAnnotationRunAgentResult>;
  /**
   * Undoes a previously-applied annotation agent patch. Threaded to the
   * annotations pane's Undo button — omitted, the button never renders.
   */
  onAnnotationUndoPatch?: (
    patchId: string,
    changedIds?: string[],
  ) => Promise<PromptAnnotationUndoPatchResult>;
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
  annotationStore,
  onAnnotationAgentRun,
  onAnnotationUndoPatch,
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
  const [mode, setMode] = useState<LabMode>("edit");
  // The pinned BASE annotation target — the exact thing the user clicked
  // (node) or dragged (range). The composer's scope breadcrumb widens it via
  // `activeScopeKey`; the base itself never changes until re-pinned, so the
  // range scope can always restore the original drag.
  const [annotationTarget, setAnnotationTarget] =
    useState<PromptAnnotationTarget | null>(null);
  // The breadcrumb segment currently applied: "range" for a range base,
  // otherwise a node id from the base's ancestor chain.
  const [activeScopeKey, setActiveScopeKey] = useState<string | null>(null);

  // Every pin (click, drag, annotate-toggle, clear) resets the scope to the
  // base's own leaf segment.
  const pinAnnotationTarget = useCallback(
    (target: PromptAnnotationTarget | null) => {
      setAnnotationTarget(target);
      setActiveScopeKey(
        target ? (target.kind === "prompt-range" ? "range" : target.nodeId) : null,
      );
    },
    [],
  );
  const [inspector, setInspector] = useState(() =>
    loadLabInspectorPreference(),
  );
  // Lab-owned fallback store so annotate mode works without host wiring.
  const fallbackAnnotationStore = useMemo(() => createAnnotationStore(), []);
  const activeAnnotationStore = annotationStore ?? fallbackAnnotationStore;
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
    setAnnotationTarget(null);
    setActiveScopeKey(null);
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
  const annotateActive = mode === "annotate" && !inContext;

  // The lab's own copy of the line model PromptFlowXml renders from — the
  // build is deterministic on the prompt, so rows here and rows on screen
  // agree line-for-line. Targeting maps DOM rows onto these lines.
  const labLineModel = useMemo(
    () => buildXmlLineModel(model_.prompt, { variables: undefined }),
    [model_.prompt],
  );
  // `model_.prompt` (and therefore labLineModel) churns identity per render —
  // effects/callbacks that only need the CURRENT lines read this ref instead
  // of depending on the object (a labLineModel dep loops: effect → setState →
  // render → new labLineModel → effect …).
  const labLineModelRef = useRef(labLineModel);
  labLineModelRef.current = labLineModel;
  // Hover-chip labels, named exactly the way the inspector tree names nodes.
  // Item ids label as "List item" — items are not blocks, so they sit outside
  // promptBlockLabel's union.
  const nodeLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const line of labLineModel.lines) {
      if (line.role === "gap") continue;
      if (!labels.has(line.nodeId)) {
        labels.set(line.nodeId, promptBlockLabel(line.node));
      }
      if (line.itemId && !labels.has(line.itemId)) {
        labels.set(line.itemId, "List item");
      }
    }
    return labels;
  }, [labLineModel]);

  // Full ancestor links (child id → parent id) for the scope breadcrumb —
  // `XmlLine.parentNodeId` is one level only, so the chain comes from the
  // prompt tree, built once per draft.
  const nodeParentMap = useMemo(
    () => buildAnnotationParentMap(model_.prompt),
    [model_.prompt],
  );

  /**
   * The WORKING annotation target: the pinned base widened (or restored) by
   * the breadcrumb. It drives the popover anchors, the selected ring and
   * what submits — widening a bullet to its list re-rings the whole list
   * live before Annotate. The base's own key ("range" / its nodeId) yields
   * the base unchanged; any other key targets that node.
   */
  const workingAnnotationTarget = useMemo<PromptAnnotationTarget | null>(() => {
    if (!annotationTarget) return null;
    const baseKey =
      annotationTarget.kind === "prompt-range" ? "range" : annotationTarget.nodeId;
    if (activeScopeKey === null || activeScopeKey === baseKey) {
      return annotationTarget;
    }
    // Derived from the BASE's docId (not model_.prompt, whose identity churns
    // per render) so the widened target object stays referentially stable —
    // the anchors/ring effects key on it.
    return {
      kind: "prompt-node",
      docId: annotationTarget.docId,
      nodeId: activeScopeKey,
    };
  }, [annotationTarget, activeScopeKey]);

  // Leaf-first breadcrumb entries for the pinned base: the base itself, then
  // every enclosing block up to the top-level block (never the document). A
  // range's leaf entry is the adapter's quote label; the popover renders the
  // breadcrumb only at 2+ entries, so top-level bases fall back to the plain
  // header label.
  const composerScopes = useMemo(() => {
    if (!annotationTarget) return undefined;
    // A document-anchored range (cross-section drag, nodeId === docId) has no
    // node chain — its only scope is the dragged text itself.
    const docAnchored =
      annotationTarget.kind === "prompt-range" &&
      annotationTarget.nodeId === annotationTarget.docId;
    const nodeScopes = docAnchored
      ? []
      : annotationScopeChain(nodeParentMap, annotationTarget.nodeId).map(
          (id) => ({
            key: id,
            label: nodeLabels.get(id) ?? `Node ${id}`,
          }),
        );
    if (annotationTarget.kind === "prompt-range") {
      return [
        {
          key: "range",
          label: promptAnnotationSchema.targetLabel(annotationTarget),
        },
        ...nodeScopes,
      ];
    }
    return nodeScopes;
  }, [annotationTarget, nodeParentMap, nodeLabels]);

  // The targeting hook owns its containerRef; this mirror lets callbacks
  // passed INTO the hook (resolve/selected/range) reach the same element.
  const targetingContainerRef = useRef<HTMLDivElement | null>(null);

  /**
   * Alt/Option state for parent expansion. The targeting hook hands
   * `resolveTarget` only the raw element, so the lab records the modifier
   * itself: the container's capture-phase mousemove (and the click capture)
   * stash `event.altKey` here BEFORE the hook's bubble-phase resolution runs,
   * and Alt keydown/keyup re-dispatch a mousemove at the last hovered element
   * so the ring flips between leaf and parent without waiting for the pointer
   * to move.
   */
  const altKeyRef = useRef(false);
  const lastPointerTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!annotateActive) return;
    const sync = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return;
      altKeyRef.current = event.type === "keydown";
      lastPointerTargetRef.current?.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          altKey: altKeyRef.current,
        }),
      );
    };
    document.addEventListener("keydown", sync);
    document.addEventListener("keyup", sync);
    return () => {
      document.removeEventListener("keydown", sync);
      document.removeEventListener("keyup", sync);
      altKeyRef.current = false;
      lastPointerTargetRef.current = null;
    };
  }, [annotateActive]);

  /**
   * Element → annotation target. Plain hover resolves the row's own stamp —
   * for item rows that is the ITEM's id, so single bullets are targetable
   * leaves. With Alt held the row's PARENT block resolves instead (bullet →
   * list, nested paragraph → section); rows are collected parent-inclusively
   * so the whole list/section rings. No parent stamp → the leaf stands.
   */
  const resolveTargetForElement = useCallback(
    (element: HTMLElement): ResolvedTarget<PromptAnnotationTarget> | null => {
      const row = closestPromptRow(element);
      if (!row) return null;
      let nodeId = row.getAttribute("data-prompt-node-id");
      if (!nodeId) return null;
      if (altKeyRef.current) {
        const parentId = row.getAttribute("data-prompt-parent-node-id");
        if (parentId) nodeId = parentId;
      }
      const scope = targetingContainerRef.current ?? row.ownerDocument;
      const rows = annotationRowElements(scope, nodeId);
      if (rows.length === 0) return null;
      return {
        // Rings measure the rows' TEXT regions so the hover ring hugs the
        // object's content instead of spanning gutter + full row width.
        elements: rowDisplayRegions(rows),
        target: targetForNode(model_.prompt, nodeId),
        label: nodeLabels.get(nodeId) ?? `Node ${nodeId}`,
      };
    },
    [model_.prompt, nodeLabels],
  );

  /**
   * A range emit is chased by the drag's own `click` event (mousedown and
   * mouseup produce a click on their common ancestor). That click used to be
   * swallowed by the "non-collapsed selection" guard — but the shared hook
   * now CLEARS the selection right after emitting (annotate mode shows no
   * highlight), so the guard no longer sees it and the release click would
   * re-pin a node target or advance the scope, clobbering the just-pinned
   * range. This flag swallows exactly that one click; a fresh mousedown
   * clears it so it can never leak into a genuine next click.
   */
  const swallowReleaseClickRef = useRef(false);

  const handleRangeSelect = useCallback(
    ({ range }: { range: Range; text: string }) => {
      const container = targetingContainerRef.current;
      if (!container) return;
      const target = mapDomRangeToPromptRange({
        container,
        range,
        lines: labLineModel.lines,
        docId: model_.prompt.id,
        // A drag spanning several nodes widens to their nearest common
        // ancestor (bullets 2–4 → the list; across lists → the section).
        parents: nodeParentMap,
      });
      if (!target) return;
      swallowReleaseClickRef.current = true;
      // Direct sets (not handleSelectNode): the node stays selected for the
      // existing focus/ring flows while the range target feeds the composer.
      // Document-anchored ranges (nodeId === docId) select no node.
      setSelectedNodeId(
        target.nodeId === target.docId ? undefined : target.nodeId,
      );
      pinAnnotationTarget(target);
    },
    [labLineModel, model_.prompt.id, nodeParentMap, pinAnnotationTarget],
  );

  const resolveSelectedRows = useCallback(() => {
    if (!workingAnnotationTarget) return null;
    const container = targetingContainerRef.current;
    if (!container) return null;
    // Range targets ring exactly the rows the drag bounded; node targets ring
    // the node's full extent.
    const rows =
      workingAnnotationTarget.kind === "prompt-range"
        ? promptRangeRowElements(
            container,
            labLineModelRef.current.lines,
            workingAnnotationTarget,
          )
        : annotationRowElements(container, workingAnnotationTarget.nodeId);
    // Text regions, not full-width rows: the selected ring auto-sizes to the
    // content's bounds (row resolution above still drives WHICH rows count).
    return rows.length > 0 ? rowDisplayRegions(rows) : null;
  }, [workingAnnotationTarget]);

  const targeting = useTargeting<PromptAnnotationTarget>({
    active: annotateActive,
    resolveTarget: resolveTargetForElement,
    // Clicks are pinned by the capture handler below — the editor's own row
    // handlers stop propagation, so the hook's bubble-phase click never fires
    // on rows and onTargetSelect is intentionally omitted.
    onRangeSelect: handleRangeSelect,
    // Annotation mode is the selector: a plain drag is ignored (no composer,
    // no pin); text-range selection requires holding Cmd (Ctrl on non-mac).
    rangeModifier: "meta",
    resolveSelected: resolveSelectedRows,
    resolveToken: `${mode}:${editVersion}:${
      workingAnnotationTarget
        ? promptAnnotationSchema.targetKey(workingAnnotationTarget)
        : "none"
    }`,
    // While the composer popover is open the hover ring/chip would chase the
    // pointer underneath it; the pinned selection ring is affordance enough.
    suppressHover: annotationTarget !== null,
  });

  /**
   * Annotate-mode clicks pick annotation targets INSTEAD of editing: rows'
   * own click handlers (inline editor, selection) stop propagation before
   * the targeting container's bubble handler would run, so target pinning
   * happens in the capture phase and consumes the event. Skip elements
   * (buttons, the annotation UI — the composer popover included) keep their
   * normal behavior; a click that releases a drag-selection defers to the
   * range flow captured on mouseup (with `rangeModifier: "meta"` an
   * unmodified drag's release click is swallowed here too, so a plain drag
   * neither pins nor opens the composer).
   *
   * Click-again-to-widen: clicking a row that resolves to the SAME leaf as
   * the pinned base advances the working scope one ancestor along the
   * breadcrumb chain (bullet → list → section → … → back to the leaf) —
   * "click the bullet twice to grab the whole list". Relative to the CURRENT
   * scope, so it composes with breadcrumb clicks (which jump to an absolute
   * level). Clicking a DIFFERENT row re-pins that row's leaf as a fresh base.
   */
  function handleAnnotateClickCapture(event: React.MouseEvent<HTMLElement>) {
    if (!annotateActive) return;
    const raw = event.target;
    if (!(raw instanceof HTMLElement)) return;
    // Skip elements (the composer popover included) keep their own clicks —
    // checked BEFORE the release-swallow so an armed flag can never eat a
    // click on the popover's controls.
    if (raw.closest(DEFAULT_SKIP_SELECTOR)) return;
    // The click that RELEASES a range drag must not re-pin/advance anything —
    // the range was already pinned on mouseup and the selection is cleared,
    // so only this flag can tell the release apart from a fresh click.
    if (swallowReleaseClickRef.current) {
      swallowReleaseClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Clicks carry the modifier themselves — Alt-click pins the parent block.
    altKeyRef.current = event.altKey;
    const resolved = resolveTargetForElement(raw);
    if (!resolved) return;
    event.preventDefault();
    event.stopPropagation();
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    if (
      annotationTarget &&
      resolved.target.nodeId === annotationTarget.nodeId &&
      composerScopes &&
      composerScopes.length > 1
    ) {
      const keys = composerScopes.map((scope) => scope.key);
      const currentIndex = activeScopeKey ? keys.indexOf(activeScopeKey) : 0;
      const nextKey = keys[(Math.max(currentIndex, 0) + 1) % keys.length]!;
      setActiveScopeKey(nextKey);
      return;
    }
    handleSelectNode(resolved.target.nodeId);
  }

  // Popover header label (used when the breadcrumb has fewer than 2 entries):
  // node targets carry the inspector-style label; range targets use the
  // adapter's quoted-text label. Labels the WORKING target so widening also
  // renames the header.
  const composerTargetLabel = useMemo(() => {
    if (!workingAnnotationTarget) return "";
    if (workingAnnotationTarget.kind === "prompt-node") {
      return (
        nodeLabels.get(workingAnnotationTarget.nodeId) ??
        promptAnnotationSchema.targetLabel(workingAnnotationTarget)
      );
    }
    return promptAnnotationSchema.targetLabel(workingAnnotationTarget);
  }, [workingAnnotationTarget, nodeLabels]);

  // Anchor rows for the composer popover, re-read from the committed DOM
  // (effect, not render) so post-edit rows are the ones measured. Parent-
  // inclusive: a pinned list anchors to all of its item rows. Keyed on the
  // WORKING target, so a breadcrumb scope change re-anchors through this
  // same effect.
  const [composerAnchors, setComposerAnchors] = useState<HTMLElement[] | null>(
    null,
  );
  useEffect(() => {
    if (!annotateActive || !workingAnnotationTarget) {
      setComposerAnchors(null);
      return;
    }
    const container = targetingContainerRef.current;
    if (!container) {
      setComposerAnchors(null);
      return;
    }
    // Range targets anchor to the rows the drag bounded (a cross-node drag
    // must not anchor the popover to the whole common-ancestor section).
    const rows =
      workingAnnotationTarget.kind === "prompt-range"
        ? promptRangeRowElements(
            container,
            labLineModelRef.current.lines,
            workingAnnotationTarget,
          )
        : annotationRowElements(container, workingAnnotationTarget.nodeId);
    // Anchor to the rows' TEXT regions so the popover aligns with the
    // content's left edge instead of floating over the gutter.
    setComposerAnchors(rows.length > 0 ? rowDisplayRegions(rows) : null);
  }, [annotateActive, workingAnnotationTarget, editVersion]);

  const clearAnnotationSelection = useCallback(() => {
    pinAnnotationTarget(null);
    setSelectedNodeId(undefined);
  }, [pinAnnotationTarget]);

  // Popover submit: every annotation is an agent request; landing it in the
  // store clears the pinned target, so the new entry appears in the sidebar
  // list with no composer left on screen.
  const activeAnnotationStoreRef = useRef(activeAnnotationStore);
  activeAnnotationStoreRef.current = activeAnnotationStore;
  // Submits the WORKING target — a breadcrumb-widened scope is what lands.
  const annotationTargetRef = useRef(workingAnnotationTarget);
  annotationTargetRef.current = workingAnnotationTarget;
  const handleComposerSubmit = useCallback(
    async ({ body, intent }: { body: string; intent: string }) => {
      const target = annotationTargetRef.current;
      if (!target) return;
      activeAnnotationStoreRef.current.add({
        target,
        body,
        intent: intent as PromptAnnotationIntent,
        author: "you",
      });
      clearAnnotationSelection();
    },
    [clearAnnotationSelection],
  );

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
    // In annotate mode selection picks the annotation target — the inspector
    // is not on screen, so its tab preference stays untouched.
    if (mode === "annotate") {
      pinAnnotationTarget(
        nodeId ? targetForNode(model_.prompt, nodeId) : null,
      );
      return;
    }
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

  // Undo/redo are keyboard-only (⌘Z / ⌘⇧Z — see the shortcut handler below);
  // the statusbar carries no buttons for them.
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
            dirty={dirty}
            hasSave={Boolean(onSave)}
            savePending={autosaveState.pending}
            saving={autosaveState.saving}
            saveErrors={saveErrors}
            lastSavedAt={lastSavedAt}
            inspectorCollapsed={mode === "edit" && inspector.collapsed}
            annotateMode={mode === "annotate"}
            onRetrySave={() => ensureController().retry()}
            onToggleAnnotate={() => {
              const next = mode === "annotate" ? "edit" : "annotate";
              setMode(next);
              // Entering annotate mode adopts the current node selection as
              // the pending target; leaving drops the target entirely.
              pinAnnotationTarget(
                next === "annotate" && selectedNodeId
                  ? targetForNode(model_.prompt, selectedNodeId)
                  : null,
              );
            }}
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
              <ContextSurface context={context} showOutline={outlineFits} />
            ) : (
              /* Targeting container: hover glide-ring/chip + selected ring
                 overlays render inside it; in annotate mode its capture
                 handler turns row clicks into target picks. Inert (attrs
                 only) while editing. */
              <div
                ref={(element) => {
                  targetingContainerRef.current = element;
                  targeting.containerRef.current = element;
                }}
                {...targeting.containerProps}
                onClickCapture={handleAnnotateClickCapture}
                // A fresh press disarms the release-click swallow — if a drag
                // released outside the container (its click never reached
                // handleAnnotateClickCapture), the stale flag must not eat
                // the next genuine click.
                onMouseDownCapture={() => {
                  swallowReleaseClickRef.current = false;
                }}
                // Capture-phase modifier tracking runs before the hook's
                // bubble-phase resolution reads altKeyRef (see above).
                onMouseMoveCapture={(event) => {
                  altKeyRef.current = event.altKey;
                  lastPointerTargetRef.current =
                    event.target instanceof HTMLElement ? event.target : null;
                }}
                onMouseLeave={() => {
                  lastPointerTargetRef.current = null;
                  targeting.containerProps.onMouseLeave();
                }}
                // Escape closes the anchored composer and drops the pinned
                // target (the popover itself has no Escape handling).
                onKeyDown={(event) => {
                  if (event.key === "Escape" && annotationTarget) {
                    event.stopPropagation();
                    clearAnnotationSelection();
                  }
                }}
                className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
              >
                <PromptFlowXml
                  prompt={model_.prompt}
                  model={model_}
                  selectedEntry={explicitSelectedEntry}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                  onPromptChange={handlePromptChange}
                  showOutline={outlineFits}
                />
                {targeting.overlays}
                {/* Anchored composer: pinning a target (click or drag
                    release) opens it beside the target's rows; Annotate
                    lands the agent request in the store and the sidebar
                    list. Single intent — no picker. */}
                {annotateActive && annotationTarget && (
                  <AnnotationComposerPopover
                    anchorElements={composerAnchors}
                    targetLabel={composerTargetLabel}
                    scopes={composerScopes}
                    activeScopeKey={activeScopeKey ?? undefined}
                    onScopeChange={setActiveScopeKey}
                    onSubmit={handleComposerSubmit}
                    onCancel={clearAnnotationSelection}
                  />
                )}
                {annotateActive && <style>{ANNOTATE_CURSOR_CSS}</style>}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: annotate mode pins the annotations pane; otherwise the
            tabbed inspector, which collapsed renders nothing at all. */}
        {mode === "annotate" ? (
          <aside className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card">
            <div className="flex h-9 shrink-0 items-stretch border-b border-border">
              <span className="inline-flex items-center px-3 text-[11px] uppercase tracking-[0.08em] text-foreground">
                Annotations
              </span>
              <button
                type="button"
                onClick={() => setMode("edit")}
                aria-label="Exit annotate mode"
                title="Exit annotate mode"
                className="ml-auto inline-flex w-9 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              >
                <PanelRightClose size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {/* model_.prompt has run through ensurePromptNodeIds (the
                  editor model ensures ids), so every node — list items
                  included — is addressable. The pane is list-only; the
                  composer is the anchored popover on the editor surface. */}
              <PromptAnnotationsPane
                prompt={model_.prompt}
                onSelectNode={handleSelectNode}
                store={activeAnnotationStore}
                onRunAgent={onAnnotationAgentRun}
                onUndoPatch={onAnnotationUndoPatch}
              />
            </div>
          </aside>
        ) : !inspector.collapsed && (
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

/**
 * Annotate-mode cursor affordance: rows read as pick targets, not text. The
 * `.cursor-text` / `.cursor-pointer` descendants (row text, markers,
 * brackets) are overridden explicitly; buttons keep their own cursor.
 *
 * The `user-select: text` rule is the Cmd+drag guarantee: whatever selection
 * behavior the editor chrome carries (the gutter and list markers are
 * `select-none`), the row TEXT region must stay natively selectable or the
 * range-annotation drag has nothing to read on release.
 *
 * The zeroed row-wash vars keep annotate mode BORDER-ONLY. `XmlRow` paints
 * its own full-bleed hover/selection washes from these custom properties
 * (inline `background: var(--prompt-editor-hover-bg, …)`), and the hover wash
 * spans the whole hovered node's row range — under the targeting ring that
 * compounded into a wide tinted band, exactly the thing the dotted ring is
 * supposed to replace. Redefining the vars here beats the root section's
 * inline `promptStyleVars` for this subtree only, so EDIT mode (where the
 * style is never injected) keeps every wash untouched.
 *
 * The `[data-prompt-affordance]` rule makes annotate mode annotation-ONLY:
 * every editor affordance the surface renders (the block grip/menu cluster,
 * the slash menu) carries that stamp, and hiding them here — rather than
 * conditionally rendering — keeps edit mode byte-identical. The shared skip
 * selector exempts `button` from targeting, so without this rule those
 * affordances would stay CLICKABLE while annotating.
 */
const ANNOTATE_CURSOR_CSS = `
  [data-annotation-targeting="true"] {
    --prompt-editor-hover-bg: transparent;
    --prompt-editor-selection-bg: transparent;
    --prompt-editor-active-line-bg: transparent;
  }
  [data-annotation-targeting="true"] [data-prompt-node-id],
  [data-annotation-targeting="true"] [data-prompt-node-id] .cursor-text,
  [data-annotation-targeting="true"] [data-prompt-node-id] .cursor-pointer {
    cursor: crosshair;
  }
  [data-annotation-targeting="true"] [data-prompt-row-text] {
    -webkit-user-select: text;
    user-select: text;
  }
  [data-annotation-targeting="true"] [data-prompt-affordance] {
    display: none;
  }
`;

function TabPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center p-5">
      <p className="max-w-52 text-center text-[12px] leading-relaxed text-muted-foreground/70">
        {children}
      </p>
    </div>
  );
}

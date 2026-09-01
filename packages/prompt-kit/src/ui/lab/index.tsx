"use client";

// The prompt lab shell (2026-08-05 redesign): the DOCUMENT carries the
// agent's identity — a Notion-style page header at the top of the document
// column (name as title, model chip, collapsible click-to-edit description).
// The GLASS PANEL is fixed furniture pinned top-right, its header an
// Edit/AI tab bar. The Edit tab holds the working zones — the VIEW
// switcher (whose system row carries the autosave whisper), FIXTURE
// (state), OUTLINE (its history icon swaps the body for the host's
// revisions zone), DETAILS (while a node is selected OR the caret sits in
// one — caret-first, the zone follows the caret silently). The AI tab IS
// annotate mode: the queue rail (or annotations pane), margin count
// bubbles, comment ticks, and the hover wash linking rows to their target
// blocks — none of which render in edit mode. Everything queues (run-now
// retired); one click-only Apply drains the batch in one session. See
// docs/20-implementation/20-editor/50-application-shell.md.
//
// STYLING CONTRACT — the host app supplies the presentation layer:
//
//   1. Tailwind utilities. These components use Tailwind class names
//      (`flex`, `text-sm`, `rounded-[3px]`, …). prompt-kit deliberately ships
//      no Tailwind config, no build step, and no CSS bundle: a consumer that
//      already runs Tailwind would otherwise end up with two copies of the
//      utility layer. The host's Tailwind must have prompt-kit's source on its
//      content/source paths so the classes are generated.
//   2. Semantic CSS custom properties. Colours resolve through the host's
//      token layer (`--background`, `--foreground`, `--muted-foreground`,
//      `--border`, `--accent`, …) so the editor inherits the surrounding app's
//      theme rather than imposing one.
//   3. The `.prompt-editor-surface` rules — row zebra/rule striping and
//      caret behaviour — which ship with the host's stylesheet. In this repo's
//      consumers that is `@agent-kernel/viewer-ui/styles`.
//
// Values a host may want to drive at runtime (font size, line height, gutter
// width, row shading) are read from `--prompt-editor-*` custom properties;
// `promptStyleVars` from `../style` produces a matching style object.

import cn from "classnames";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { History } from "lucide-react";
import {
  DEFAULT_SKIP_SELECTOR,
  useTargeting,
  type ResolvedTarget,
} from "@codecaine-ai/annotations/react";
import type { PromptDocument } from "../../index";
import { visitPrompt } from "../../document/transforms/visit";
import {
  createPromptEditorModel,
  promptBlockLabel,
} from "../editor/model";
import type {
  PromptStep,
} from "../editor/transactions";
import { estimateTokenCount } from "tokenx";

import { PromptFlowInspector } from "../editor/inspector";
import { PromptFlowXml } from "../editor/buffer";
import { buildXmlLineModel } from "../../document/render/line-model";
import type {
  PromptFlowInlineInsert,
  PromptFlowStagedRegion,
} from "../editor/buffer";
import {
  outlineSectionLabel,
  type OutlineSection,
} from "../editor/buffer/SectionOutline";
import {
  EDITOR_COLORS,
  LINE_HEIGHT_PX,
} from "../surface/editor-surface";
import {
  annotationRowElements,
  promptRangeRowElements,
  buildAnnotationParentMap,
  mapDomRangeToPromptRange,
  closestPromptRow,
  rowDisplayRegions,
} from "./annotate/annotation-targeting";
import {
  acceptDisabledReason,
  nodeRowRange,
  rejectDisabledReason,
  requestRunId,
  stagedRowPlan,
  targetAnchorRow,
  type PromptEditRequest,
  type PromptEditSession,
  type PromptRequestDisposition,
} from "./session/prompt-edit-session";
import {
  buildRequestQueue,
  requestDisposition,
  requestNodeId,
} from "./session/request-queue";
import { InlineComposer } from "./annotate/InlineComposer";
import { AmbientWash, ANNOTATE_COLORS } from "./annotate/AmbientWash";
import {
  GlassPanel,
  DOCK_DEFAULT_WIDTH,
  type LabPanelTab,
} from "./glass/GlassPanel";
import { InlineThreadBar, ProposalActionBar } from "./annotate/InlineReviewBars";
import { PanelQueue } from "./annotate/PanelQueue";
import { createPromptLabHistory } from "./session/prompt-lab-history";
import {
  loadPromptStyleSettings,
  normalizePromptStyleSettings,
  promptStyleVars,
  type PromptStyleSettings,
} from "../style/prompt-style-settings";
import { PromptPageHeader } from "./page/PageHeader";
import {
  RightMarginRail,
  type CommentIndicatorGroup,
  type CommentIndicatorThread,
} from "./annotate/RightMarginRail";
import {
  createAutosaveController,
  type AutosaveController,
  type AutosaveControllerState,
} from "./session/autosave-controller";
import { ContextSurface, type LabContextPreview } from "./page/ContextSurface";
import { contextOutlineSections } from "./page/context-outline";
import {
  PanelFixtureList,
  PanelOutlineList,
  PanelViewSwitcher,
  PanelZone,
  type PanelViewEntry,
  type LabView,
} from "./glass/zones";
import { StateSurface, type LabStateZone } from "./page/StateSurface";
import {
  formatToolsForDisplay,
  ToolsSurface,
  type LabToolsZone,
} from "./page/ToolsSurface";
import { ConfigSurface, type LabConfigZone } from "./page/ConfigSurface";
import {
  createAnnotationStore,
  type PromptAnnotationStore,
} from "../../annotations/store";
import {
  promptAnnotationSchema,
  targetFingerprintChanged,
  targetForNode,
  withTargetFingerprint,
  type PromptAnnotationIntent,
  type PromptAnnotationTarget,
} from "../../annotations/schema";
import {
  PromptAnnotationsPane,
  type PromptAnnotationRunAgentResult,
  type PromptAnnotationUndoPatchResult,
} from "./annotate/PromptAnnotationsPane";

// Directory entry point: the shell itself plus the pieces a host composes
// around it (the style rail it docks, the undo history it owns, the context
// preview and state-zone shapes it is fed).
export { PromptStyleRail, type PromptStyleRailProps } from "../style/PromptStyleRail";
export {
  PromptStyleSidebar,
  clampPromptStyleSidebarWidth,
  PROMPT_STYLE_SIDEBAR_DEFAULT_WIDTH,
  PROMPT_STYLE_SIDEBAR_MIN_WIDTH,
  PROMPT_STYLE_SIDEBAR_MAX_WIDTH,
  type PromptStyleSidebarProps,
} from "../style/PromptStyleSidebar";
export type { LabContextPreview } from "./page/ContextSurface";
export type { LabView } from "./glass/zones";
export type { LabFixture, LabStateZone } from "./page/StateSurface";
export type { LabToolsZone } from "./page/ToolsSurface";
export type { LabConfigZone } from "./page/ConfigSurface";
export {
  createPromptLabHistory,
  type PromptLabHistory,
  type PromptLabMetaPatch,
} from "./session/prompt-lab-history";
export {
  createAutosaveController,
  type AutosaveController,
  type AutosaveControllerOptions,
  type AutosaveControllerState,
  type AutosaveScheduler,
} from "./session/autosave-controller";
export {
  acceptDisabledReason,
  rejectDisabledReason,
  undoDisabledReason,
  requestRunId,
  stagedRowPlan,
  targetAnchorRow,
  type PromptEditProposal,
  type PromptEditRequest,
  type PromptEditRequestStatus,
  type PromptEditSession,
  type PromptEditThreadMessage,
  type PromptRequestDisposition,
  type PromptRequestFiling,
} from "./session/prompt-edit-session";
export {
  buildRequestQueue,
  isDisposedStatus,
  pipelineSummary,
  queuePositionLabel,
  requestDisposition,
  requestNodeId,
  type QueueEntry,
  type RecordEntry,
  type RequestQueueInput,
  type RequestQueueModel,
} from "./session/request-queue";
export { ANNOTATE_COLORS } from "./annotate/AmbientWash";

export type PromptSaveOutcome = { hash: string } | { errors: string[] };
export type ManifestSaveOutcome = { ok: true } | { errors: string[] };

/**
 * EDIT is the default authoring mode; ANNOTATE points node selection at
 * annotation targets and morphs the glass panel into the annotations
 * workspace (the session request rail, or the annotations pane).
 */
export type LabMode = "edit" | "annotate";

/** Manifest fields surfaced + editable on the page header. */
export interface LabManifest {
  name: string;
  model: string;
  description: string;
  modelAliases: string[];
  /** When false the page-header model/description are read-only. */
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
   * history survives), on `{ errors }` the messages render above the
   * surface. The lab never fetches.
   */
  onSave?: (doc: PromptDocument) => Promise<PromptSaveOutcome>;
  /**
   * Content hash of the currently saved prompt revision. Not surfaced by the
   * lab shell itself — the hash lives in the host page header and the
   * HISTORY zone — but kept in the contract for hosts that pass it.
   */
  savedHash?: string;
  /** Page-header manifest data (name/model/description + alias suggestions). */
  manifest?: LabManifest;
  /** Persists page-header edits (model/description). */
  onManifestSave?: (patch: {
    model: string;
    description: string;
  }) => Promise<ManifestSaveOutcome>;
  /** Read-only context preview shown when the dock selects CONTEXT. */
  context?: LabContextPreview;
  /**
   * Viewer-only style settings controlled by the host. When omitted, the lab
   * reads the persisted settings once while mounting.
   */
  styleSettings?: PromptStyleSettings;
  /**
   * History content (stats + history + diff). Host-composed — see
   * AgentPromptLabContainer. Reached through the document header's history
   * icon, which swaps the glass panel to a temporary History view.
   */
  revisionsZone?: React.ReactNode;
  /**
   * The STATE view: fixtures + the rendered state document for the active
   * one. When present the dock's view switcher gains a `state` entry.
   */
  stateZone?: LabStateZone;
  /**
   * The TOOLS view: the agent's runtime tool surface as a rendered document.
   * When present the dock's view switcher gains a `tools` entry.
   */
  toolsZone?: LabToolsZone;
  /** Agent configuration shown in the optional CONFIG panel zone. */
  configZone?: LabConfigZone;
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
  /**
   * The prompt-edit session (requests + staged proposals + callbacks) — see
   * `PromptEditSession` in ./prompt-edit-session for the full contract. When
   * present: staged proposals render as inline red/green diffs with
   * per-request action bars (in BOTH modes), waiting-on-human requests
   * render inline amber thread bars, a draft banner sits above the surface,
   * the COMMENTS zone (and annotate mode's rail) reads the session's
   * requests + records instead of the annotation store, and composer submits
   * route to `onFileRequest` / `onSendRequest` when the session provides
   * them.
   *
   * The three-gesture additions (`onFileRequest`, `onRunRequest`,
   * `onApplyQueue`, `onRerunRequest`) are all optional: with none of them
   * wired the lab still files notes, still shows the queue, and simply never
   * launches anything.
   */
  promptEditSession?: PromptEditSession;
}

/**
 * DOM anchors the dock outline steers by, per view. Each surface stamps its
 * own scroller and rows; the spy and click-to-scroll resolve both lazily so
 * the dock never holds an element ref across a view switch.
 */
/**
 * One open comment/request row — the COMMENTS zone and the margin bubbles
 * render from the same list, so a comment can never show in one place and
 * not the other.
 */
interface LabCommentThread extends CommentIndicatorThread {
  /** Anchored node, or null for document-level notes. */
  nodeId: string | null;
}

const OUTLINE_ANCHORS: Record<
  LabView,
  { scroller: string; row: (row: number) => string }
> = {
  system: {
    scroller: '[data-prompt-flow-scroll="xml"]',
    row: (row) => `[data-row-index="${row}"]`,
  },
  context: {
    scroller: '[data-context-scroll="context"]',
    row: (row) => `[data-prompt-row="${row}"]`,
  },
  state: {
    scroller: '[data-context-scroll="state"]',
    row: (row) => `[data-prompt-row="${row}"]`,
  },
  tools: {
    scroller: '[data-context-scroll="tools"]',
    row: (row) => `[data-prompt-row="${row}"]`,
  },
};

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
  stateZone,
  toolsZone,
  configZone,
  annotationStore,
  onAnnotationAgentRun,
  onAnnotationUndoPatch,
  promptEditSession,
}: PromptInlineLabProps) {
  const [history, setHistory] = useState(() => createPromptLabHistory(prompt));
  const [editVersion, setEditVersion] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(
    undefined,
  );
  // The buffer's live caret session: the enclosing block's id while an inline
  // editor is open (CARET-FIRST, 2026-08-06 — clicks place carets, they do
  // not select). Derivation feed ONLY: the DETAILS zone follows it silently;
  // it is never written into selectedNodeId and paints no selection chrome.
  const [caretNodeId, setCaretNodeId] = useState<string | undefined>(
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
  // The pinned annotation target — the exact thing the user clicked (node)
  // or dragged (range). What you click IS the target: there is no scope
  // breadcrumb and no widening UI (Ford, 2026-07-31 — "review is a state of
  // the file"). Cross-block drags still widen silently to the nearest common
  // ancestor inside mapDomRangeToPromptRange.
  const [annotationTarget, setAnnotationTarget] =
    useState<PromptAnnotationTarget | null>(null);
  const pinAnnotationTarget = useCallback(
    (target: PromptAnnotationTarget | null) => {
      setAnnotationTarget(target);
    },
    [],
  );
  // The glass panel's temporary History view: the document header's history
  // icon swaps the zone stack for the host's revisions zone; `‹ back`, a
  // second click, or entering annotate returns. Panel-internal, per-mount.
  const [panelHistory, setPanelHistory] = useState(false);
  // A margin-bubble click lights its sidebar COMMENTS row briefly, so the
  // click reads in both places (the document selects, the list points).
  const [highlightedCommentKey, setHighlightedCommentKey] = useState<
    string | null
  >(null);
  // The floating glass dock's current width — reserved as document-area
  // padding so text reflows beside the panel rather than under it.
  const [annotatePanelWidth, setAnnotatePanelWidth] = useState(DOCK_DEFAULT_WIDTH);
  // Apply has been pressed and the batch has not drained. It is the ONLY
  // piece of run state the lab owns — everything else (in flight, staged,
  // resolved) is read back off the session, so the narration can never
  // disagree with the requests it narrates.
  const [applyingQueue, setApplyingQueue] = useState(false);
  // Lab-owned fallback store so annotate mode works without host wiring.
  const fallbackAnnotationStore = useMemo(() => createAnnotationStore(), []);
  const activeAnnotationStore = annotationStore ?? fallbackAnnotationStore;
  // The one geometric guard: with real width the dock sits borderless in the
  // document's margin and the column centers; below the breakpoint the lab
  // degrades to a plain two-column flex with a bordered dock.
  const [dockInMargin, setDockInMargin] = useState(true);
  const rootRef = useRef<HTMLElement | null>(null);
  const [persistedStyleSettings] = useState(() =>
    styleSettings ?? loadPromptStyleSettings(),
  );

  // Page-header local edit state (model/description), reset when the source
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

  // Guards the reset below against prop-identity ECHOES: hosts refetch the
  // document after saves/accepts and hand back a new object with the same
  // content, and resetting on those wiped the open composer "randomly"
  // (2026-08-04 audit, finding 1).
  const promptContentRef = useRef<string>("");
  useEffect(() => {
    const fingerprint = JSON.stringify(prompt);
    if (promptContentRef.current === fingerprint) return;
    promptContentRef.current = fingerprint;
    setHistory(createPromptLabHistory(prompt));
    // The content genuinely changed — but keep the selection and the annotate
    // pin (the open composer) when their node SURVIVED the swap: losing a
    // half-written note because an unrelated accept landed is hostile.
    const nodeSurvives = (nodeId: string | undefined | null): boolean => {
      if (!nodeId) return false;
      let found = false;
      visitPrompt(prompt, ({ node }) => {
        if (!found && "type" in node && node.id === nodeId) found = true;
      });
      return found;
    };
    setSelectedNodeId((current) =>
      nodeSurvives(current) ? current : undefined,
    );
    setAnnotationTarget((current) =>
      current && current.nodeId !== current.docId && !nodeSurvives(current.nodeId)
        ? null
        : current,
    );
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
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const check = () =>
      setDockInMargin(element.clientWidth >= DOCK_MARGIN_MIN_WIDTH);
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
  const stateTokenCount = useMemo(
    () => estimateTokenCount(stateZone?.renderedState ?? ""),
    [stateZone?.renderedState],
  );
  const toolsTokenCount = useMemo(
    () => estimateTokenCount(toolsZone?.renderedTools ?? ""),
    [toolsZone?.renderedTools],
  );
  const explicitSelectedEntry = selectedNodeId
    ? model_.tree.find((entry) => entry.id === selectedNodeId)
    : undefined;
  // DETAILS follows the caret silently: an explicit selection wins; otherwise
  // the open edit session's enclosing block feeds the inspector (item edits
  // resolve to their list entry — item edit targets carry the LIST's id).
  // Pure derivation — no selection state is written, no chrome painted.
  const detailsEntry =
    explicitSelectedEntry ??
    (caretNodeId
      ? model_.tree.find((entry) => entry.id === caretNodeId)
      : undefined);
  const appliedStyleSettings = styleSettings ?? persistedStyleSettings;
  const styleVars = useMemo(
    () => promptStyleVars(appliedStyleSettings),
    [appliedStyleSettings],
  );
  // The document column's measure: the style rail's Content width setting,
  // verbatim (2026-08-04 audit — the old 96ch cap silently swallowed most of
  // the slider's 60–180ch range, so dragging it "did nothing"). Projected as
  // `--prompt-editor-content-width` onto the document area, it reaches every
  // surface's content column; the scrollers themselves stay full width so
  // the scrollbar sits at the region's far right.
  const docContentWidth = useMemo(
    () =>
      `${normalizePromptStyleSettings(appliedStyleSettings).contentWidth}ch`,
    [appliedStyleSettings],
  );

  const canSaveManifest = Boolean(
    manifest?.editable && Boolean(onManifestSave),
  );
  // A host may retract the state zone while the state view is showing; the
  // lab falls back to the system view rather than rendering a dead surface.
  const activeView: LabView =
    view === "state" && !stateZone
      ? "system"
      : view === "tools" && !toolsZone
        ? "system"
        : view;
  const inSystem = activeView === "system";
  const annotateActive = mode === "annotate" && inSystem;

  // The panel's History view exists only where its icon does (system view
  // with a revisions zone) — leaving either snaps the glass back to zones.
  useEffect(() => {
    if (panelHistory && (!inSystem || !revisionsZone)) setPanelHistory(false);
  }, [panelHistory, inSystem, revisionsZone]);

  // The lab's own copy of the line model PromptFlowXml renders from — the
  // build is deterministic on the prompt, so rows here and rows on screen
  // agree line-for-line. Targeting maps DOM rows onto these lines; the dock
  // outline reads its system sections from it.
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
  // Hover-chip labels, named exactly the way the details zone names nodes.
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

  // Full ancestor links (child id → parent id) — `XmlLine.parentNodeId` is
  // one level only, so the chain comes from the prompt tree, built once per
  // draft. Feeds the SILENT common-ancestor widening for cross-block drags
  // (mapDomRangeToPromptRange); there is no scope UI on top of it.
  const nodeParentMap = useMemo(
    () => buildAnnotationParentMap(model_.prompt),
    [model_.prompt],
  );

  /* ------------------------------------------------------------------ */
  /* Dock outline: sections + scroll-spy + click-to-scroll               */
  /* ------------------------------------------------------------------ */

  // System sections come from the line model (same rule the editor's old
  // outline column used: one entry per top-level open tag plus its depth-1
  // container children, names only). Context and state sections are
  // recovered from their rendered strings.
  const systemOutlineSections = useMemo<OutlineSection[]>(() => {
    const result: OutlineSection[] = [];
    const seen = new Set<string>();
    labLineModel.lines.forEach((line, index) => {
      if (line.role !== "open" || line.depth > 1) return;
      if (seen.has(line.nodeId)) return;
      seen.add(line.nodeId);
      result.push({
        row: index,
        nodeId: line.nodeId,
        label: outlineSectionLabel(line),
        depth: line.depth,
      });
    });
    return result;
  }, [labLineModel]);
  const contextOutlineList = useMemo(
    () => contextOutlineSections(context?.renderedContext ?? ""),
    [context?.renderedContext],
  );
  const stateOutlineList = useMemo(
    () => contextOutlineSections(stateZone?.renderedState ?? ""),
    [stateZone?.renderedState],
  );
  const toolsOutlineList = useMemo(
    () => contextOutlineSections(formatToolsForDisplay(toolsZone?.renderedTools ?? "")),
    [toolsZone?.renderedTools],
  );
  const outlineSections =
    activeView === "system"
      ? systemOutlineSections
      : activeView === "context"
        ? contextOutlineList
        : activeView === "tools"
          ? toolsOutlineList
          : activeView === "state"
            ? stateOutlineList
            : [];

  // Human-readable target labels for queue rows: the node's own outline
  // label, else its nearest outlined ANCESTOR's (a field inside
  // <state_structure> reads `state_structure`, not its machine id), else
  // the raw id. Rows tooltip the raw id either way.
  const targetLabelFor = useCallback(
    (nodeId: string) => {
      const labels = new Map(
        systemOutlineSections.map((section) => [section.nodeId, section.label]),
      );
      let current: string | undefined = nodeId;
      while (current) {
        const label = labels.get(current);
        if (label) return label;
        current = nodeParentMap.get(current);
      }
      return nodeId;
    },
    [systemOutlineSections, nodeParentMap],
  );

  // Scroll tracking mirrors the retired outline columns': the active entry
  // is the last section whose anchor row sits at/above the top of the
  // viewport (a two-line grace), snapping to the last section at the bottom
  // of the scroller. Rects, not offsets — rows live inside each surface's
  // own positioned wrappers.
  const [outlineActiveRow, setOutlineActiveRow] = useState<number | null>(
    null,
  );
  useEffect(() => {
    const anchors = OUTLINE_ANCHORS[activeView];
    const scroller =
      rootRef.current?.querySelector<HTMLElement>(anchors.scroller) ?? null;
    if (!scroller || outlineSections.length === 0) {
      setOutlineActiveRow(null);
      return;
    }
    const update = () => {
      const threshold =
        scroller.getBoundingClientRect().top + LINE_HEIGHT_PX * 2;
      let active = outlineSections[0]!.row;
      for (const section of outlineSections) {
        const element = scroller.querySelector<HTMLElement>(
          anchors.row(section.row),
        );
        if (element && element.getBoundingClientRect().top <= threshold) {
          active = section.row;
        }
      }
      if (
        scroller.scrollHeight > scroller.clientHeight &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      ) {
        active = outlineSections[outlineSections.length - 1]!.row;
      }
      setOutlineActiveRow((current) => (current === active ? current : active));
    };
    update();
    scroller.addEventListener("scroll", update);
    return () => scroller.removeEventListener("scroll", update);
  }, [activeView, outlineSections]);

  const scrollToOutlineSection = useCallback(
    (section: OutlineSection) => {
      // Clicking is the selection here — mark it immediately rather than
      // waiting on a smooth scroll to settle.
      setOutlineActiveRow(section.row);
      const anchors = OUTLINE_ANCHORS[activeView];
      const scroller =
        rootRef.current?.querySelector<HTMLElement>(anchors.scroller) ?? null;
      const element =
        scroller?.querySelector<HTMLElement>(anchors.row(section.row)) ?? null;
      if (!scroller || !element) return;
      // Land the section's anchor one line below the top edge — the same
      // breathing the buffer's first line gets from its top padding.
      const top =
        element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        LINE_HEIGHT_PX;
      if (typeof scroller.scrollTo === "function") {
        scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      } else {
        element.scrollIntoView?.({ block: "start", behavior: "smooth" });
      }
    },
    [activeView],
  );

  // The targeting hook owns its containerRef; this mirror lets callbacks
  // passed INTO the hook (resolve/selected/range) reach the same element.
  const targetingContainerRef = useRef<HTMLDivElement | null>(null);

  /**
   * Element → annotation target. Hover resolves the row's own stamp — for
   * item rows that is the ITEM's id, so single bullets are targetable
   * leaves. What you point at is the target; there is no modifier-driven
   * parent expansion (the scope machinery died with the breadcrumb).
   */
  const resolveTargetForElement = useCallback(
    (element: HTMLElement): ResolvedTarget<PromptAnnotationTarget> | null => {
      const row = closestPromptRow(element);
      if (!row) return null;
      const nodeId = row.getAttribute("data-prompt-node-id");
      if (!nodeId) return null;
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
    if (!annotationTarget) return null;
    const container = targetingContainerRef.current;
    if (!container) return null;
    // Range targets ring exactly the rows the drag bounded; node targets ring
    // the node's full extent.
    const rows =
      annotationTarget.kind === "prompt-range"
        ? promptRangeRowElements(
            container,
            labLineModelRef.current.lines,
            annotationTarget,
          )
        : annotationRowElements(container, annotationTarget.nodeId);
    // Text regions, not full-width rows: the selected ring auto-sizes to the
    // content's bounds (row resolution above still drives WHICH rows count).
    return rows.length > 0 ? rowDisplayRegions(rows) : null;
  }, [annotationTarget]);

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
      annotationTarget
        ? promptAnnotationSchema.targetKey(annotationTarget)
        : "none"
    }`,
    // While the inline composer is open the hover ring/chip would chase the
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
   * Clicking a row pins that row's leaf as the target; clicking a DIFFERENT
   * row re-pins. No click-again widening — what you click is the target.
   */
  function handleAnnotateClickCapture(event: React.MouseEvent<HTMLElement>) {
    if (!annotateActive) return;
    const raw = event.target;
    if (!(raw instanceof HTMLElement)) return;
    // Skip elements (the inline composer and other annotation UI included)
    // keep their own clicks — checked BEFORE the release-swallow so an armed
    // flag can never eat a click on the composer's controls.
    if (raw.closest(DEFAULT_SKIP_SELECTOR)) return;
    // The click that RELEASES a range drag must not re-pin anything — the
    // range was already pinned on mouseup and the selection is cleared, so
    // only this flag can tell the release apart from a fresh click.
    if (swallowReleaseClickRef.current) {
      swallowReleaseClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // STICKY PIN (2026-08-05): while a composer is open, document clicks
    // neither cancel nor re-target it — only its × or Escape close it. The
    // click is consumed so the surface's background-deselect never fires.
    if (annotationTarget) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const resolved = resolveTargetForElement(raw);
    if (!resolved) return;
    event.preventDefault();
    event.stopPropagation();
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    handleSelectNode(resolved.target.nodeId);
  }

  const clearAnnotationSelection = useCallback(() => {
    pinAnnotationTarget(null);
    setSelectedNodeId(undefined);
    // Cancelling an inline edit keeps the original note untouched.
    setEditingRequestAlias(null);
  }, [pinAnnotationTarget]);

  /** Scroll the system buffer so a node's first row lands near the top —
   * the queue-card click's other half (select + bring into view). */
  const scrollToNodeRow = useCallback((nodeId?: string) => {
    if (!nodeId) return;
    const range = nodeRowRange(labLineModelRef.current.lines, nodeId);
    if (!range) return;
    const anchors = OUTLINE_ANCHORS.system;
    const scroller =
      rootRef.current?.querySelector<HTMLElement>(anchors.scroller) ?? null;
    const element =
      scroller?.querySelector<HTMLElement>(anchors.row(range.start)) ?? null;
    if (!scroller || !element) return;
    const top =
      element.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop -
      LINE_HEIGHT_PX;
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    } else {
      element.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
  }, []);

  // Composer submit: every annotation is an agent request, and the gesture
  // that filed it decides where its life happens. With a session that owns
  // request creation the submit routes to `onFileRequest` (falling back to
  // the disposition-blind `onSendRequest`) — the container echoes the
  // request back through `promptEditSession.requests`; otherwise it lands in
  // the annotation store. Either way the pinned target clears, so no
  // composer is left on screen.
  const activeAnnotationStoreRef = useRef(activeAnnotationStore);
  activeAnnotationStoreRef.current = activeAnnotationStore;
  const annotationTargetRef = useRef(annotationTarget);
  annotationTargetRef.current = annotationTarget;
  const sessionRef = useRef(promptEditSession);
  sessionRef.current = promptEditSession;
  const promptRef = useRef(model_.prompt);
  promptRef.current = model_.prompt;

  /**
   * Files one note into the queue. `global` drops the node entirely (a
   * document-level request); `batch` keeps the pinned target, STAMPED with
   * its content fingerprint so the queue can notice later that the node
   * moved under it. Nothing runs until Apply.
   */
  const fileRequest = useCallback(
    (body: string, disposition: PromptRequestDisposition) => {
      // EDITING an existing note: refile with the ORIGINAL's target and
      // disposition, dismiss the original, done — the composer was just
      // the editing surface.
      const editingAlias = editingAliasRef.current;
      if (editingAlias) {
        const session = sessionRef.current;
        const original = session?.requests.find(
          (candidate) => candidate.alias === editingAlias,
        );
        if (session && original) {
          if (session.onFileRequest) {
            void session.onFileRequest({
              annotationId: newAnnotationId(),
              disposition: requestDisposition(original),
              target: original.target,
              body,
            });
          } else if (session.onSendRequest) {
            void session.onSendRequest(original.target, body);
          }
          void session.onDismissRequest?.(requestRunId(original));
        }
        setEditingRequestAlias(null);
        clearAnnotationSelection();
        return;
      }
      const pinned = annotationTargetRef.current;
      if (!pinned) return;
      const target =
        disposition === "global"
          ? null
          : withTargetFingerprint(promptRef.current, pinned);
      const session = sessionRef.current;
      let annotationId = newAnnotationId();
      if (session?.onFileRequest) {
        void session.onFileRequest({
          annotationId,
          disposition,
          target,
          body,
        });
      } else if (session?.onSendRequest) {
        void session.onSendRequest(target, body);
      } else {
        annotationId = activeAnnotationStoreRef.current.add({
          // The store has no document-level target kind: a global note falls
          // back to the pinned target, which for a ⌘K-with-no-selection
          // composer is already the document itself.
          target: target ?? pinned,
          body,
          intent: "agent-request" satisfies PromptAnnotationIntent,
          author: "you",
        }).id;
      }
      clearAnnotationSelection();
    },
    [clearAnnotationSelection],
  );

  /** The rail's document-level input files a `global` note, same as ⌘Enter. */
  const fileGlobalNote = useCallback(
    (body: string) => {
      const session = sessionRef.current;
      if (session?.onFileRequest) {
        void session.onFileRequest({
          annotationId: newAnnotationId(),
          disposition: "global",
          target: null,
          body,
        });
        return;
      }
      if (session?.onSendRequest) void session.onSendRequest(null, body);
    },
    [],
  );

  // The COMMENTS zone's population: open session requests when a session
  // drives the queue, open annotations otherwise. The store subscription is
  // cheap — the same snapshot the pane itself renders from.
  const annotationDoc = useSyncExternalStore(
    activeAnnotationStore.subscribe,
    activeAnnotationStore.document,
    activeAnnotationStore.document,
  );
  // One shape for both sources — the sidebar rows and the margin bubbles
  // read the same list, so a comment can never show in one and not the
  // other. `label` is the queue alias (session) or the author (store).
  const openCommentThreads = useMemo<LabCommentThread[]>(() => {
    if (promptEditSession) {
      return promptEditSession.requests
        .filter(
          (request) =>
            request.status === "open" ||
            request.status === "working" ||
            request.status === "waiting" ||
            request.status === "ready",
        )
        .map((request) => ({
          key: requestRunId(request),
          label: request.alias,
          body: request.body,
          agent: request.author === "agent",
          nodeId: requestNodeId(request),
        }));
    }
    return annotationDoc.annotations
      .filter((annotation) => annotation.status === "open")
      .map((annotation) => ({
        key: annotation.id,
        label: annotation.author,
        body: annotation.body,
        agent: annotation.author === "agent",
        nodeId:
          annotation.target.nodeId === annotation.target.docId
            ? null
            : annotation.target.nodeId,
      }));
  }, [promptEditSession, annotationDoc]);

  // Margin bubbles: open node-targeted comments grouped per block, anchored
  // at the block's FIRST row. Keyed on editVersion + prompt (not the
  // per-render line model) like every other row-geometry memo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commentIndicatorGroups = useMemo<CommentIndicatorGroup[]>(() => {
    const byNode = new Map<string, CommentIndicatorThread[]>();
    for (const thread of openCommentThreads) {
      if (!thread.nodeId) continue;
      const list = byNode.get(thread.nodeId) ?? [];
      list.push(thread);
      byNode.set(thread.nodeId, list);
    }
    const groups: CommentIndicatorGroup[] = [];
    for (const [nodeId, threads] of byNode) {
      const range = nodeRowRange(labLineModelRef.current.lines, nodeId);
      if (!range) continue;
      groups.push({ nodeId, row: range.start, threads });
    }
    return groups;
  }, [openCommentThreads, editVersion, prompt]);

  // COMMENT TICKS + HOVER WASH (2026-08-05, mockup B): every block with open
  // comments carries a thin violet tick down its rows; hovering its queue
  // card or margin bubble washes the whole block, so the card ↔ block link
  // is visible instead of guessed. Ranges re-derive with the document.
  const [litCommentNodeId, setLitCommentNodeId] = useState<string | null>(
    null,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commentRowRanges = useMemo(() => {
    const ranges = new Map<string, { start: number; end: number }>();
    for (const group of commentIndicatorGroups) {
      const range = nodeRowRange(labLineModelRef.current.lines, group.nodeId);
      if (range) ranges.set(group.nodeId, range);
    }
    return ranges;
  }, [commentIndicatorGroups, editVersion, prompt]);
  const commentTickCss = useMemo(() => {
    if (commentRowRanges.size === 0) return "";
    const tick: string[] = [];
    const lit: string[] = [];
    for (const [nodeId, range] of commentRowRanges) {
      for (let row = range.start; row <= range.end; row += 1) {
        const selector = `[data-prompt-flow-rows] [data-row-index="${row}"]`;
        tick.push(selector);
        if (nodeId === litCommentNodeId) lit.push(selector);
      }
    }
    // !important on background: XmlRow paints its zebra tint through the
    // inline background SHORTHAND, which would otherwise win.
    return [
      `${tick.join(",\n")} { box-shadow: inset 2px 0 0 rgb(138 122 176 / 0.55); }`,
      lit.length > 0
        ? `${lit.join(",\n")} { background: rgb(138 122 176 / 0.14) !important; box-shadow: inset 2px 0 0 var(--prompt-annotate-accent-lit, #AD9DD0); }`
        : "",
    ].join("\n");
  }, [commentRowRanges, litCommentNodeId]);

  // The bubbles portal into the editor's rows container — tracked as STATE
  // (not a ref) so the rail re-renders when the container mounts, unmounts
  // (view switches, empty tree), or is replaced.
  const [flowRowsElement, setFlowRowsElement] = useState<HTMLElement | null>(
    null,
  );
  useLayoutEffect(() => {
    setFlowRowsElement(
      rootRef.current?.querySelector<HTMLElement>("[data-prompt-flow-rows]") ??
        null,
    );
  }, [activeView, editVersion, prompt]);

  /** Margin-bubble click: select the block AND point at its sidebar row. */
  /**
   * Editing a queued note happens INLINE (Ford, 2026-08-05): clicking a
   * comment bubble reopens the composer above its block, prefilled with the
   * note's text. The session contract has no update door, so a save REFILES
   * the note (same target, same disposition, new body, fresh id) and
   * dismisses the original — the queue reads as an edit, the host sees a
   * replace.
   */
  const [editingRequestAlias, setEditingRequestAlias] = useState<
    string | null
  >(null);
  const editingAliasRef = useRef(editingRequestAlias);
  editingAliasRef.current = editingRequestAlias;

  const handleCommentIndicatorSelect = useCallback(
    (nodeId: string, firstThreadKey: string) => {
      setSelectedNodeId(nodeId);
      setHighlightedCommentKey(firstThreadKey);
      const request = sessionRef.current?.requests.find(
        (candidate) => requestRunId(candidate) === firstThreadKey,
      );
      if (request?.target) {
        pinAnnotationTarget(request.target);
        setEditingRequestAlias(request.alias);
      }
      rootRef.current
        ?.querySelector(`[data-lab-comment-row="${firstThreadKey}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
      window.setTimeout(
        () =>
          setHighlightedCommentKey((current) =>
            current === firstThreadKey ? null : current,
          ),
        1600,
      );
    },
    [pinAnnotationTarget],
  );

  /* ------------------------------------------------------------------ */
  /* The queue: every note files here; Apply drains it (run-now retired) */
  /* ------------------------------------------------------------------ */

  // "target changed since filed": an accepted change has moved a node that a
  // still-queued note was filed against. Purely client-side — the evidence
  // is the fingerprint stamped on the target at file time, compared against
  // the CURRENT draft.
  const conflictedAliases = useMemo(() => {
    const aliases = new Set<string>();
    for (const request of promptEditSession?.requests ?? []) {
      if (!request.target) continue;
      if (targetFingerprintChanged(model_.prompt, request.target)) {
        aliases.add(request.alias);
      }
    }
    return aliases;
  }, [promptEditSession, model_.prompt]);

  const requestQueue = useMemo(
    () =>
      buildRequestQueue({
        requests: promptEditSession?.requests ?? [],
        proposals: promptEditSession?.proposals ?? [],
        applying: applyingQueue,
        conflictedAliases,
      }),
    [promptEditSession, applyingQueue, conflictedAliases],
  );

  // The batch drains itself: once every queued request has a staged proposal
  // (or has left the queue) there is nothing left to narrate, so the run is
  // over and Apply comes back.
  useEffect(() => {
    if (applyingQueue && requestQueue.activeAlias === null) {
      setApplyingQueue(false);
    }
  }, [applyingQueue, requestQueue.activeAlias]);

  const startQueueRun = useCallback(() => {
    const session = sessionRef.current;
    const ids = buildRequestQueue({
      requests: session?.requests ?? [],
      proposals: session?.proposals ?? [],
      applying: false,
    })
      .queue.filter((entry) => !entry.staged)
      .map((entry) => requestRunId(entry.request));
    if (ids.length === 0) return;
    setApplyingQueue(true);
    void session?.onApplyQueue?.(ids);
  }, []);

  // Rows to wash with the working shimmer: the target extent of the queue
  // card the agent is processing right now.
  const shimmerRows = useMemo(() => {
    if (!annotateActive || requestQueue.activeAlias === null) return [];
    const active = requestQueue.queue.find(
      (entry) => entry.request.alias === requestQueue.activeAlias,
    );
    const nodeId = active ? requestNodeId(active.request) : null;
    if (!nodeId) return [];
    const range = nodeRowRange(labLineModelRef.current.lines, nodeId);
    if (!range) return [];
    const rows: number[] = [];
    for (let row = range.start; row <= range.end; row += 1) rows.push(row);
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotateActive, requestQueue, editVersion, prompt]);
  // The tab's dot beats faster while the queue is draining.
  const anyRunInFlight = requestQueue.activeAlias !== null;

  /**
   * Staged proposals → inline diff regions. Each proposal replaces its
   * changed nodes' rows with red del / green add rows plus a per-request
   * action bar; replacing the rows is also the edit-collision guard (a block
   * with a pending proposal has no editable rows until accept/reject).
   * Keyed on editVersion + prompt rather than the per-render line-model
   * object so the line diffs only recompute when the document changes.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stagedRegions = useMemo<PromptFlowStagedRegion[] | undefined>(() => {
    const session = promptEditSession;
    if (!session || session.proposals.length === 0) return undefined;
    const authors = new Map(
      session.requests.map((request) => [request.alias, request.author]),
    );
    const regions: PromptFlowStagedRegion[] = [];
    for (const proposal of session.proposals) {
      const plan = stagedRowPlan(labLineModelRef.current.lines, proposal);
      if (!plan) continue;
      regions.push({
        key: `proposal:${proposal.transactionId}`,
        rowStart: plan.rowStart,
        rowEnd: plan.rowEnd,
        delLines: plan.delLines,
        addLines: plan.addLines,
        bar: (
          <ProposalActionBar
            alias={proposal.requestAlias}
            author={authors.get(proposal.requestAlias)}
            summary={proposal.summary}
            acceptDisabledReason={acceptDisabledReason(
              session.proposals,
              proposal.requestAlias,
            )}
            rejectDisabledReason={rejectDisabledReason(
              session.proposals,
              proposal.requestAlias,
            )}
            onAccept={() => void session.onAccept?.(proposal.requestAlias)}
            onReject={() => void session.onReject?.(proposal.requestAlias)}
          />
        ),
      });
    }
    return regions.length > 0 ? regions : undefined;
  }, [promptEditSession, editVersion, prompt]);

  /**
   * In-flow widgets above their target rows: amber waiting-on-human thread
   * bars (both modes), and — in annotate mode — THE inline composer,
   * inserted directly above the pinned target so content pushes down
   * (⌘K feel). Run-now's inline threads retired 2026-08-05 with the
   * disposition: the queue narrates all agent work now.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inlineInserts = useMemo<PromptFlowInlineInsert[] | undefined>(() => {
    const inserts: PromptFlowInlineInsert[] = [];
    const lines = labLineModelRef.current.lines;
    const session = promptEditSession;
    if (session) {
      for (const request of session.requests) {
        if (request.status !== "waiting") continue;
        const row = targetAnchorRow(lines, request.target);
        if (row === null) continue;
        const lastAgent = [...(request.thread ?? [])]
          .reverse()
          .find((message) => message.author === "agent");
        inserts.push({
          key: `thread:${request.alias}`,
          row,
          element: (
            <InlineThreadBar
              alias={request.alias}
              author={request.author}
              message={lastAgent?.body ?? request.body}
              onReply={(body) =>
                void session.onReplyToRequest?.(request.alias, body)
              }
            />
          ),
        });
      }
    }
    // Queued notes no longer insert in-flow markers here — the margin
    // bubbles (RightMarginRail) carry that presence without pushing text.
    if (annotateActive && annotationTarget) {
      const composerRow = targetAnchorRow(lines, annotationTarget) ?? 0;
      const editingRequest = editingRequestAlias
        ? promptEditSession?.requests.find(
            (candidate) => candidate.alias === editingRequestAlias,
          )
        : undefined;
      inserts.push({
        key: "composer",
        row: composerRow,
        // Ring-aligned (2026-08-05): the box's edges match the dotted
        // targeting ring under it, so the pair reads as one assembly.
        align: "ring",
        element: (
          <InlineComposer
            // Remount per edit so the prefill lands (defaultValue).
            key={editingRequestAlias ?? "new"}
            initialValue={editingRequest?.body}
            onSubmit={fileRequest}
            onCancel={clearAnnotationSelection}
            documentTarget={annotationTarget.nodeId === annotationTarget.docId}
          />
        ),
      });
    }
    return inserts.length > 0 ? inserts : undefined;
  }, [
    promptEditSession,
    annotateActive,
    annotationTarget,
    editingRequestAlias,
    editVersion,
    prompt,
    fileRequest,
    clearAnnotationSelection,
  ]);

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
    // In annotate mode selection picks the annotation target; in edit mode
    // it mounts the dock's DETAILS zone — no tab steering left to do.
    if (mode === "annotate") {
      pinAnnotationTarget(
        nodeId ? targetForNode(model_.prompt, nodeId) : null,
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
  // no chrome carries buttons for them.
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

  /**
   * The manifest-save path, now fed per-field from the page header (model
   * chip pick, description blur/Enter). Each save carries BOTH fields — the
   * endpoint's contract is the whole patch — merged from the incoming edit
   * over the current local values.
   */
  async function handleManifestSave(patch: {
    model?: string;
    description?: string;
  }) {
    if (!onManifestSave || manifestSaving) return;
    const nextModel = patch.model ?? model;
    const nextDescription = patch.description ?? description;
    setModel(nextModel);
    setDescription(nextDescription);
    if (
      manifest &&
      nextModel === manifest.model &&
      nextDescription === manifest.description
    ) {
      return;
    }
    setManifestSaving(true);
    setManifestError(undefined);
    try {
      const outcome = await onManifestSave({
        model: nextModel,
        description: nextDescription,
      });
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
   * The panel's tab bar is the mode switch: AI is the annotate/AI state
   * (system view only — selecting it from another view returns to system),
   * Edit is the resting state.
   */
  function handlePanelTabSelect(next: LabPanelTab) {
    if (next === "ai") {
      if (!inSystem) setView("system");
      setAnnotateMode("annotate");
      return;
    }
    setAnnotateMode("edit");
  }

  function setAnnotateMode(next: LabMode) {
    if (next === mode) return;
    setMode(next);
    // Annotate owns the glass — a parked History view would otherwise
    // resurface, stale, on `done`.
    if (next === "annotate") setPanelHistory(false);
    // Entering annotate mode adopts the current node selection as the
    // pending target; leaving drops the target entirely.
    pinAnnotationTarget(
      next === "annotate" && selectedNodeId
        ? targetForNode(model_.prompt, selectedNodeId)
        : null,
    );
    // Leaving ends the narration too — a queue run is a thing you watch, and
    // there is nothing to watch from outside the mode.
    if (next === "edit") setApplyingQueue(false);
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
    const root = rootRef.current;
    if (!root) return;
    const target = event.target;
    const inside = target instanceof Node && root.contains(target);
    const active = root.ownerDocument.activeElement;
    if (!inside && active !== null && active !== root.ownerDocument.body) return;

    // Esc finishes the mode — the ambient chip says so. An open composer
    // owns Escape first (the targeting container clears the pinned target
    // and stops the event before it reaches here), so this only fires when
    // nothing is pinned.
    if (event.key === "Escape") {
      if (!annotateActive || annotationTarget) return;
      event.preventDefault();
      setAnnotateMode("edit");
      return;
    }
    if (!mod) return;

    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      if (inSystem) ensureController().flush();
      return;
    }
    if (key !== "z") return;
    if (!inSystem) return;
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcutRef.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  // The view switcher's rows: `state` rides along only when the host wires a
  // state zone. Each row carries the view's own token estimate.
  const dockViews: PanelViewEntry[] = [
    { id: "system", tokens: promptTokenCount },
    { id: "context", tokens: contextTokenCount },
    ...(stateZone
      ? [{ id: "state" as const, tokens: stateTokenCount }]
      : []),
    ...(toolsZone
      ? [{ id: "tools" as const, tokens: toolsTokenCount }]
      : []),
  ];

  return (
    <section
      ref={rootRef}
      style={styleVars}
      data-lab-mode={annotateActive ? "annotate" : "edit"}
      className={cn(
        // `relative` is the ambient signals' anchor: the mode's edge line and
        // its bottom-centre chip position against the lab, not the viewport,
        // so an embedded lab never paints over the page around it.
        "@container relative flex h-full min-h-0 flex-1 flex-col bg-card font-mono",
        className,
      )}
    >
      {/* THE MODE AS A TEMPERATURE: edge line, chip, dock tint, and the
          working shimmer on whatever rows are being worked right now. */}
      <AmbientWash active={annotateActive} shimmerRows={shimmerRows} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* THE DOCUMENT AREA: no chrome above it. The surfaces span the full
            region (their scrollbars land at its far right edge) and the text
            column centers inside their scrollers when the dock sits in the
            margin; the whole field shares the editor background so the
            column floats in it. */}
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          style={
            {
              background: EDITOR_COLORS.bg,
              // The glass panel's footprint, published as a variable: each
              // surface's SCROLLER pads its inside by it, so content reflows
              // beside the glass while the scrollbar stays at the region's
              // far right. Width + the style rail's panel inset + a 12px gap
              // between document and glass.
              "--prompt-editor-reserved-right":
                annotatePanelWidth > 0
                  ? `${annotatePanelWidth + appliedStyleSettings.panelInset + 12}px`
                  : "0px",
            } as React.CSSProperties
          }
        >

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

          {/* Draft banner: staged agent changes exist and nothing is saved.
              Accept all / Discard act on the whole draft (session-owned). */}
          {inSystem &&
            promptEditSession &&
            promptEditSession.proposals.length > 0 && (
              <div
                data-prompt-draft-banner=""
                className="flex shrink-0 items-center gap-3 border-b border-sky-500/40 bg-sky-500/10 px-3 py-1.5"
              >
                <span className="flex-1 text-[12px] text-sky-400">
                  {promptEditSession.proposals.length}{" "}
                  {promptEditSession.proposals.length === 1
                    ? "change"
                    : "changes"}{" "}
                  staged, nothing saved
                </span>
                <button
                  type="button"
                  aria-label="Accept all"
                  className="rounded-md bg-green-500 px-3 py-0.5 text-[12px] font-semibold text-green-950"
                  onClick={() => void promptEditSession.onAcceptAll?.()}
                >
                  Accept all
                </button>
                <button
                  type="button"
                  aria-label="Discard draft"
                  className="rounded-md border border-border px-2.5 py-0.5 text-[12px] text-muted-foreground"
                  onClick={() => void promptEditSession.onDiscardDraft?.()}
                >
                  Discard
                </button>
              </div>
            )}

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {/* The document region: the surfaces (and their scrollers) span
                its FULL width — left edge to the dock — so the vertical
                scrollbar sits at the far right, clear of the text. While the
                dock is in the margin the content column caps at the document
                width and centers INSIDE each surface's scroller (the
                projected `--prompt-editor-content-width` + `centerContent`);
                full-bleed in the narrow two-column fallback. */}
            <div
              className="flex h-full min-h-0 min-w-0 flex-1"
              style={
                dockInMargin
                  ? ({
                      "--prompt-editor-content-width": docContentWidth,
                    } as React.CSSProperties)
                  : undefined
              }
            >
              {activeView === "context" ? (
                <ContextSurface
                  context={context}
                  showOutline={false}
                  centerContent={dockInMargin}
                />
              ) : activeView === "state" && stateZone ? (
                <StateSurface
                  stateZone={stateZone}
                  centerContent={dockInMargin}
                />
              ) : activeView === "tools" && toolsZone ? (
                <ToolsSurface
                  toolsZone={toolsZone}
                  centerContent={dockInMargin}
                />
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
                  // Escape closes the inline composer and drops the pinned
                  // target (the composer's textarea lets Escape bubble here).
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && annotationTarget) {
                      event.stopPropagation();
                      clearAnnotationSelection();
                    }
                  }}
                  className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
                >
                  {/* The inline composer and thread bars travel INTO the
                      surface as in-flow inserts (above their target rows);
                      staged proposals replace their rows with the inline
                      diff. Composing is annotate-only; diffs and thread bars
                      show in both modes. */}
                  <PromptFlowXml
                    prompt={model_.prompt}
                    model={model_}
                    selectedEntry={explicitSelectedEntry}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNode}
                    onEditTargetChange={setCaretNodeId}
                    onPromptChange={handlePromptChange}
                    stagedRegions={stagedRegions}
                    inlineInserts={inlineInserts}
                    centerContent={dockInMargin}
                    // Notion-page header: part of the scrolling document, on
                    // the same content column as the rows.
                    leadContent={
                      manifest ? (
                        <PromptPageHeader
                          name={manifest.name}
                          description={description}
                          editable={canSaveManifest}
                          error={manifestError}
                          onSaveDescription={(next) =>
                            void handleManifestSave({ description: next })
                          }
                        />
                      ) : undefined
                    }
                  />
                  {targeting.overlays}
                  {/* Open comments as margin bubbles, portaled into the rows
                      container so they ride the scroll — both modes. */}
                  {/* Annotation signals live in the AI state ONLY (Ford,
                      2026-08-05): edit mode stays clean of the layer —
                      bubbles, ticks, and washes all gate on the mode. */}
                  {annotateActive && (
                    <RightMarginRail
                      container={flowRowsElement}
                      groups={commentIndicatorGroups}
                      onSelect={handleCommentIndicatorSelect}
                      onHoverNode={setLitCommentNodeId}
                    />
                  )}
                  {annotateActive && commentTickCss && (
                    <style data-lab-comment-ticks="">{commentTickCss}</style>
                  )}
                  {annotateActive && <style>{ANNOTATE_CURSOR_CSS}</style>}
                </div>
              )}
            </div>
          </div>

        </div>

        {/* THE GLASS PANEL (2026-08-05 redesign): fixed furniture with an
            Edit / AI tab bar for a header. Edit holds the zone stack; AI is
            the workspace (active runs, requests, comments) — selecting the
            AI tab IS entering the AI state, and the panel animates to that
            tab's own geometry. The document reserves the footprint in both. */}
        <GlassPanel
          tab={annotateActive ? "ai" : "edit"}
          onTabSelect={handlePanelTabSelect}
          busy={anyRunInFlight}
          topInset={appliedStyleSettings.panelTopInset}
          onWidthChange={setAnnotatePanelWidth}
        >
          {annotateActive && inSystem ? (
            <div className="flex h-full min-h-0 flex-col gap-3">
              {/* Save trouble stays visible while working the AI state — the
                  system row's whisper lives on the Edit tab. */}
              {onSave && (
                <AutosaveWhisper
                  dirty={dirty}
                  errorCount={errorCount}
                  hasSave={Boolean(onSave)}
                  pending={autosaveState.pending}
                  saving={autosaveState.saving}
                  saveErrors={saveErrors}
                  lastSavedAt={lastSavedAt}
                  retryDisabled={errorCount > 0 || !onSave}
                  onRetry={() => ensureController().retry()}
                  exceptionalOnly
                />
              )}
              {promptEditSession ? (
                <PanelQueue
                  session={promptEditSession}
                  queue={requestQueue}
                  applying={applyingQueue}
                  onApply={startQueueRun}
                  onFileGlobal={fileGlobalNote}
                  onFocusTarget={(nodeId) => {
                    setSelectedNodeId(nodeId);
                    scrollToNodeRow(nodeId);
                  }}
                  onHoverTarget={setLitCommentNodeId}
                  targetLabel={targetLabelFor}
                />
              ) : (
                <PromptAnnotationsPane
                  prompt={model_.prompt}
                  onSelectNode={handleSelectNode}
                  store={activeAnnotationStore}
                  onRunAgent={onAnnotationAgentRun}
                  onUndoPatch={onAnnotationUndoPatch}
                />
              )}
            </div>
          ) : (
            <>
          {/* VIEW — the switcher replaces the old tabs AND the old token
              readout; counts ride each row, quiet and right-aligned. */}
          <PanelZone id="view" label="View">
            <PanelViewSwitcher
              views={dockViews}
              active={activeView}
              onSelect={setView}
              // Layering rule: the system row IS the savable prompt — it
              // alone carries the save status. (History rides the OUTLINE
              // header: its body is what the toggle replaces.)
              rowSublines={{
                system: onSave ? (
                  <AutosaveWhisper
                    dirty={dirty}
                    errorCount={errorCount}
                    hasSave={Boolean(onSave)}
                    pending={autosaveState.pending}
                    saving={autosaveState.saving}
                    saveErrors={saveErrors}
                    lastSavedAt={lastSavedAt}
                    retryDisabled={errorCount > 0 || !onSave}
                    onRetry={() => ensureController().retry()}
                    exceptionalOnly
                  />
                ) : undefined,
              }}
            />
          </PanelZone>

          {configZone && (
            <PanelZone id="config" label="Config">
              <ConfigSurface configZone={configZone} />
            </PanelZone>
          )}

          {/* FIXTURE — state view only: pick the snapshot the surface shows. */}
          {activeView === "state" && stateZone && (
            <PanelZone id="fixture" label="Fixture">
              <PanelFixtureList
                fixtures={stateZone.fixtures}
                activeFixtureId={stateZone.activeFixtureId}
                onSelect={stateZone.onFixtureSelect}
              />
            </PanelZone>
          )}

          {/* OUTLINE — every view; hidden only when the document has no
              sections to map. */}
          {(outlineSections.length > 0 || (inSystem && revisionsZone)) && (
            <PanelZone
              id="outline"
              label={panelHistory ? "History" : "Outline"}
              action={
                inSystem && revisionsZone ? (
                  <button
                    type="button"
                    data-lab-history-toggle=""
                    aria-label="History"
                    aria-pressed={panelHistory}
                    title={panelHistory ? "Back to outline" : "History"}
                    onClick={() => setPanelHistory((open) => !open)}
                    className={cn(
                      "transition-colors",
                      panelHistory
                        ? "text-foreground"
                        : "text-muted-foreground/50 hover:text-foreground",
                    )}
                  >
                    <History size={12} aria-hidden />
                  </button>
                ) : undefined
              }
            >
              {/* The zone below the header IS the toggle's subject: outline
                  at rest, the revision history in its place on demand. */}
              {panelHistory && inSystem && revisionsZone ? (
                <div data-lab-panel-history="">{revisionsZone}</div>
              ) : (
                <PanelOutlineList
                  sections={outlineSections}
                  activeRow={outlineActiveRow}
                  onSelect={scrollToOutlineSection}
                />
              )}
            </PanelZone>
          )}

          {/* DETAILS — mounts while a block is selected OR the caret sits in
              one (caret-first: the inspector follows the caret silently);
              small and demoted under the outline. */}
          {inSystem && detailsEntry && (
            <PanelZone id="details" label="Details">
              <PromptFlowInspector
                prompt={model_.prompt}
                model={model_}
                selectedEntry={detailsEntry}
                onPromptChange={handlePromptChange}
              />
            </PanelZone>
          )}

          {/* COMMENTS left the Edit tab (2026-08-05 redesign): what is active
              — open requests, comments, runs — shows in the AI state; Edit
              keeps only the wayfinding zones. Margin bubbles still mark
              commented blocks in the document itself. */}
            </>
          )}
        </GlassPanel>
      </div>
    </section>
  );
}

/**
 * The lab-minted handle for a filed note. It exists before the host has seen
 * anything, so `onRunRequest` / `onApplyQueue` / `onRerunRequest` always have
 * something stable to name (`crypto.randomUUID` matches the annotation
 * store's own id minting; the counter is only for runtimes without it).
 */
let annotationIdCounter = 0;
function newAnnotationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  annotationIdCounter += 1;
  return `annotation-${Date.now()}-${annotationIdCounter}`;
}

/**
 * Below this lab-container width the dock leaves the margin: the column stops
 * centering and the dock becomes a bordered right column.
 */
const DOCK_MARGIN_MIN_WIDTH = 1280;

/** The centered document column's cap — the mockups' 96ch, in the lab's mono. */

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

/**
 * The autosave whisper: the save state as small fixed text in the document
 * area's bottom-right corner — `unsaved` / `saving…` / `save failed — retry`
 * / `saved 3:42 PM`. No box, no border; only the retry link takes pointer
 * events.
 */
function AutosaveWhisper({
  dirty,
  errorCount,
  hasSave,
  pending,
  saving,
  saveErrors,
  lastSavedAt,
  retryDisabled,
  onRetry,
  exceptionalOnly = false,
}: {
  dirty: boolean;
  errorCount: number;
  hasSave: boolean;
  pending: boolean;
  saving: boolean;
  saveErrors: string[];
  lastSavedAt?: Date;
  retryDisabled: boolean;
  onRetry: () => void;
  /** Silence as the healthy state: render nothing when plainly saved. */
  exceptionalOnly?: boolean;
}) {
  // The system row's subline speaks only when something needs attention.
  if (exceptionalOnly && !dirty) return null;
  let body: React.ReactNode;
  if (dirty && errorCount > 0) {
    body = (
      <span className="text-destructive/70">
        unsaved — {errorCount} {errorCount === 1 ? "error" : "errors"}
      </span>
    );
  } else if (dirty && hasSave && (pending || saving)) {
    body = <span className="text-muted-foreground/70">saving…</span>;
  } else if (dirty && saveErrors.length > 0) {
    const firstLine = saveErrors[0]?.split(/\r?\n/, 1)[0] ?? "Save failed";
    body = (
      <span className="text-destructive" title={firstLine}>
        save failed —{" "}
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="pointer-events-auto underline underline-offset-2 hover:text-destructive/80 disabled:cursor-not-allowed disabled:no-underline"
        >
          retry
        </button>
      </span>
    );
  } else if (dirty) {
    body = <span className="text-muted-foreground/70">unsaved</span>;
  } else {
    body = (
      <span className="text-muted-foreground/70">
        saved
        {lastSavedAt ? ` ${formatSaveTime(lastSavedAt)}` : ""}
      </span>
    );
  }

  return (
    <span
      data-lab-autosave=""
      // Lives in the floating dock's header (2026-08-04 audit: the corner
      // whisper floated over prompt text; the sidebar owns status now).
      className="pointer-events-auto select-none whitespace-nowrap text-[10px] tracking-[0.06em]"
    >
      {body}
    </span>
  );
}

function formatSaveTime(value: Date): string {
  return value.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

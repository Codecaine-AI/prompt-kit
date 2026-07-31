---
covers: The prompt lab shell around the editing surface, including view tabs, token counts, the annotate mode toggle, the collapsible inspector, the section outline, and the autosave contract.
concepts: [shell, statusbar, inspector, autosave, history]
design_refs: [10-system-design/50-validation-contract.md, 10-system-design/60-kernel-boundary.md]
---

# Application Shell

The editing surface is mounted inside a lab shell. The shell owns the document
history, the save lifecycle, and the panes; the surface owns only editing.

---

## Layout

| Region | Contents |
|--------|----------|
| Left, top | Statusbar: view tabs, token count, diagnostics, autosave status, Annotate toggle |
| Left, body | The editing surface, or the read-only context surface |
| Left, edge | Section outline column, when the pane is wide enough |
| Right | Collapsible tabbed inspector: AGENT, DETAILS, REVISIONS |
| Host | Style sidebar, owned by the host page rather than the shell |

The shell never fetches. Persistence, manifest data, revision history, and
context previews all arrive as props or callbacks.

## Views

`LabView` is `"system" | "context"`. The system view renders the editing
surface. The context view replaces it with a read-only render of the assembled
context on the same editor surface — same gutter, grid, and shading tokens —
with no hover, insert, or drag affordances. Undo, redo, and save are inert while
the context view is active, because the context is not editable. The context
view carries the same section outline column as the system view, derived from
the assembled context's tags, so jumping between sections works in both.

The statusbar's token count follows the active view: the rendered prompt in the
system view, the assembled context in the context view.

## Inspector

`LabInspectorTab` is `"agent" | "details" | "revisions"`.

| Tab | Contents |
|-----|----------|
| AGENT | Manifest name, model, description, and alias suggestions; read-only when the host provides no manifest save endpoint |
| DETAILS | The node inspector for the selected block |
| REVISIONS | Host-composed revision stats, history, and diff |

The collapsed flag and active tab persist under
`agentKernel.promptLabInspector.v1`, defaulting to open on DETAILS. A collapsed
inspector renders nothing at all. Selecting a block steers an already-open
inspector to DETAILS; a collapsed one stays collapsed.

## Section Outline

The outline is part of the editing surface rather than an option. It lists one
row per top-level container open tag, derived from the same landmark rows the
surface tints, and shares the editor's background, type, and line grid so a row
occupies exactly one editor line.

The active row is the last section whose open row sits at or above the top of
the viewport, snapping to the final section once the scroller reaches the
bottom. Clicking a row scrolls its open tag to one line below the top edge.

Two guards suppress it: a prompt with no top-level sections has nothing to list,
and below a container width of 1100 pixels the column is not rendered at all
because the editor pane left over would be too cramped.

## History

`createPromptLabHistory(baseDoc)` wraps prompt-kit's `createTransactionLog`.

```ts
interface PromptLabHistory {
  current(): PromptDocument;
  commitSteps(steps: readonly PromptStep[]): boolean;
  commitMeta(patch: PromptLabMetaPatch): boolean;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  isDirty(): boolean;
  markSaved(savedDocument?: PromptDocument): void;
  transactions(): PromptTransaction[];
}
```

Two edit channels share one undo stack. Block edits arrive as `PromptStep[]` and
go to the inner transaction log. Document-metadata edits — title and description
— are not node-scoped and therefore not representable as steps, so they live in
an overlay with their own before/after entries. The unified stack interleaves
both kinds; step entries delegate to the inner log, metadata entries restore the
overlay. Both stacks are LIFO, so the relative order of step entries always
matches.

`markSaved()` moves only the dirty baseline. The log and the unified stack are
untouched, so undo keeps working across a save, and undoing past the save point
makes the draft dirty again. Dirtiness is computed by comparing
`canonicalizePrompt(current())` against the saved canonical string.

The inner log's content hash is overridden with a cheap synchronous FNV-1a over
the canonical serialization, prefixed `local-`, so a browser host never reaches
for the Node crypto-backed hash. Those local hashes provide transaction lineage
only; authoritative hashes come from the save API.

## Autosave

`createAutosaveController` is a generic debounced-save coordinator.

```ts
interface AutosaveController<T> {
  schedule(value: T): void;
  flush(): void;
  retry(): void;
  cancelPending(): void;
  dispose(): void;
  getState(): AutosaveControllerState;
}
```

Rules as shipped:

| Rule | Behavior |
|------|----------|
| Debounce | 1500 ms after the last edit, by default |
| Concurrency | At most one request in flight |
| Trailing work | A debounce that expires during an active request queues a trailing save instead of a second request |
| Superseding | Only the newest scheduled value is ever persisted |
| Gating | The shell cancels pending work whenever the draft is clean or carries validation errors |
| Flush | Cmd+S runs the latest scheduled value immediately |
| Retry | The statusbar's retry action re-attempts the latest value immediately |
| Document swap | A new prompt disposes the controller, suppressing completions from the previous document |

Validation gates every save: the shell counts `error`-severity diagnostics from
the editor model and cancels rather than schedules while any exist. A save that
returns errors renders them under the statusbar. A save that succeeds marks the
history baseline only when the completed attempt was the latest one, so edits
made during an in-flight save stay dirty.

## Shortcuts

Cmd+Z, Cmd+Shift+Z, and Cmd+S are bound on the document rather than as React
handlers on the shell root. Clicking an affordance that then unmounts itself —
an insert palette entry, a delete button — leaves focus on `<body>`, outside the
React tree, which is exactly the moment an author reaches for undo. The listener
is scoped by a guard: it runs for events inside the lab, or when nothing at all
holds focus.

The keyboard is the only undo surface: the statusbar carries no undo/redo
buttons. With a structural selection active and no editor open, Backspace or
Delete removes the selected run as one undoable transaction (see
[80-interaction-model.md](80-interaction-model.md)).

## Module Map

| File | Responsibility |
|------|----------------|
| `lab/index.tsx` | Shell composition, history wiring, autosave gating, shortcuts |
| `lab/LabStatusBar.tsx` | View tabs, token count, diagnostics, save status, Annotate toggle |
| `lab/LabInspector.tsx` | Tab strip, collapse, persisted preference |
| `lab/AgentZone.tsx` | AGENT tab manifest fields |
| `lab/ContextSurface.tsx` | Read-only assembled-context view |
| `lab/autosave-controller.ts` | Debounce, single-flight, trailing save |
| `lab/PromptStyleRail.tsx` | Style controls, mounted by the host |
| `lab/prompt-lab-history.ts` | Unified undo/redo over steps and metadata |
| `prompt-flow/PromptFlowInspector/` | DETAILS tab node editors |

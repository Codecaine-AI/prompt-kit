---
covers: The lab shell around the editing surface — the in-document page header, the fixed glass panel with its Edit/AI tabs, views, the annotation queue, autosave, and history.
concepts: [shell, glass-panel, page-header, queue, autosave, history, annotate]
depends-on: [10-system-design/50-validation-contract.md, 10-system-design/80-kernel-boundary.md]
---

# Application Shell

The editing surface is mounted inside a lab shell. The shell owns the document
history, the save lifecycle, the annotation queue, and the panel; the surface
owns only editing. The shell never fetches: persistence, manifest data,
revision history, context previews, and the prompt-edit session all arrive as
props or callbacks.

Two places carry all the chrome: the DOCUMENT carries identity, and one fixed
GLASS PANEL carries everything else.

---

## Layout

| Region | Contents |
|--------|----------|
| Document column | Notion-style page header (title, model chip, click-to-edit description, history icon) INSIDE the scroller, then the editing surface. Left-justified at the style rail's margins. |
| Glass panel | Fixed card pinned top-right; header is an Edit/AI tab bar. Never dragged, never resized by hand. |
| Host | Style sidebar, owned by the host page. |

The document reserves the panel's footprint on each surface's scroller, so
content reflows beside the glass and the scrollbar stays at the region's far
edge.

## The Glass Panel

One element, two tabs; the active tab is the wide text tab (about 3/4 of the
bar), the inactive one collapses to an icon, and the box animates between
per-tab geometries.

| Tab | Size | Contents |
|-----|------|----------|
| EDIT | 300px wide, height fits its content | Zone stack: VIEW (switcher with token counts; the system row carries the autosave whisper subline), FIXTURE (state view only), OUTLINE (history icon swaps its body for the host's revisions zone), DETAILS (only while a node is selected) |
| AI (`✦`) | 520px wide, 80% of the region height | The annotation workspace: the queue (below), or the annotations pane for store-only hosts |

The corner is pinned: the top and right insets are style settings, both
sliders in the style rail. Selecting AI from the context/state view returns to
the system view first; Escape (with no composer open) returns to Edit.
Entering the AI tab IS entering annotate mode: document clicks pick annotation
targets, editing affordances hide, and the violet ambient tints the panel.

## Views

The shell has three views: `system`, `context`, and `state`. The system view
renders the editing surface. The context view is a read-only render of the
assembled context on the same surface tokens. The state view (present only
when the host supplies a state zone) renders the selected fixture's state
document, with the FIXTURE zone picking the snapshot. Undo, redo, and save are
inert outside the system view. Each view registers its own outline anchors, so
the OUTLINE zone works in all three.

## The Annotation Queue

Everything queues; nothing runs until Apply.

- The inline composer (Cursor-style single box, ring-aligned above the pinned
  target) files on Enter: node targets as `batch`, document targets as
  `global`. An open composer is sticky — only its × or Escape closes it.
- The AI tab's queue panel is a chat layout: TARGETS section (rows: violet
  human-readable target label, the note indented beneath, quiet state, × on
  hover), DOCUMENT section (whole-document notes plus their own input), slim
  ✓/✕ records with Undo, and a bottom dock holding the one click-only Apply.
- Apply opens ONE session over the whole queue in filing order. The agent
  surveys every request before editing, then stages one proposal per request:
  n reviewable diffs forming an ordered stack (accept from the head, reject
  from the tail, with per-action disabled reasons).
- Comment presence renders only in the AI state: margin count bubbles, a thin
  violet tick down commented rows, and a hover wash linking queue row to
  target block. Clicking a bubble reopens the inline composer prefilled with
  the note; saving refiles (same target and disposition, fresh id) and
  dismisses the original.
- Row states speak only when meaningful: `processing` (breathing dot, violet
  bar), `staged` (green), `waiting on you` (amber, with the inline reply).
  Positions and counts are not rendered — order is the list order.

## History

The shell's history wraps the transaction log with one interface:

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

Two edit channels share one undo stack. Block edits arrive as steps and go to
the inner transaction log. Document-metadata edits — title and description —
live in an overlay with their own before/after entries; the unified stack
interleaves both kinds. Marking a save moves only the dirty baseline, so undo
keeps working across a save. Dirtiness compares the canonical serialization of
the current document against the saved canonical string. The inner log's
content hash is a cheap local prefix; authoritative hashes come from the save
API.

## Autosave

Autosave is a generic debounced-save coordinator: 1500ms debounce,
single-flight with a trailing save, newest-value-wins, cancelled whenever the
draft is clean or carries validation errors, Cmd+S flushes.

Status is SILENT when healthy. Exceptional states (saving stuck, errors,
retry) whisper on the system row's subline in the VIEW zone, and repeat at the
top of the AI tab while annotating. Save errors render under the document
header.

## Shortcuts

Cmd+Z / Cmd+Shift+Z / Cmd+S bind on the document (not per-component
handlers), guarded to events inside the lab or with nothing focused. Escape
walks outward: an open composer's target clears first; with nothing pinned,
the AI tab returns to Edit. The keyboard is the only undo surface — no
undo/redo buttons exist.

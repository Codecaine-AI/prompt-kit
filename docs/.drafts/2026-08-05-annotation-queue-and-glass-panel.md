# Prompt lab: the queue-only annotation flow and the fixed glass panel — Design Record (2026-08-05)

Status: settled (Ford × Fable live dogfood session, 2026-08-05). Everything below is
implemented and verified in the lab against the live prompt-editor agent.

Successor to
[`2026-08-03-prompt-lab-layout-and-annotation-model.md`](2026-08-03-prompt-lab-layout-and-annotation-model.md)
and the intermediate 2026-08-04 iteration it spawned (floating draggable glass dock,
two-gesture composer, COMMENTS zone). This record supersedes those in every conflict:
the panel no longer floats, run-now no longer exists, and the annotation layer no
longer shows in edit mode. The machinery documents (AST transactions, session/queue
model, staged review) in the 2026-07-31 drafts still stand.

---

## 1. The glass panel is furniture, not a window

The 2026-08-04 dock could be dragged, resized, and re-homed. All of that is gone —
"we don't need the user to move the glass around; it's more like having that panel
there with the system."

- ONE fixed card, corner-pinned top-right. Top inset and right inset are style-rail
  settings (`panelTopInset`, `panelInset`), so position is designed, not dragged.
- The header is a TAB BAR: **Edit** and **AI** (`✦`). The tabs swap roles on switch —
  the active tab is the wide text tab (~3/4), the inactive collapses to an icon — and
  the box animates to the incoming tab's geometry (both heights resolve to pixels so
  the tween never jumps).
- **Edit tab**: 300px wide, height FITS its content (measured, capped at the region).
  Zones: VIEW (switcher + token counts + the save whisper subline on the system row),
  FIXTURE (state view), OUTLINE (history icon swaps its body for revisions), DETAILS
  (while a node is selected). The COMMENTS zone is deleted.
- **AI tab**: 520px × 80% region height, one consistent size. Selecting it IS entering
  annotate mode; Escape (nothing pinned) returns to Edit. The old `done` button, the
  drag strip, and the far-left violet edge line are all gone.

## 2. Edit mode is clean of the annotation layer

Margin bubbles, comment ticks, hover washes, and the host's "N open notes / Apply"
strip segment no longer render in edit mode — "it confuses the two layers." The AI
state owns all annotation presence. The host session strip survives ONLY for live
session status and errors (still the lab's only error surface; redesigning that is an
open deep-dive item).

## 3. Run-now is retired; the queue is the only path

The 2026-08-04 model had two gestures (Run now ⏎ / Queue ⌘⏎) and an inline run-thread
loop at the section. Retired wholesale:

- The composer files everything on Enter (modifier chords are forgiving aliases).
  Node targets file as `batch`, document targets as `global`. `run-now` survives in
  the wire type for legacy sessions, which now render as ordinary queue cards.
- `InlineRunThread` is deleted; staged diffs always carry the proposal action bar.
- The queue's processing card took over the run signals: target-row shimmer and the
  fast-beating tab dot follow `activeAlias`.

## 4. Batch semantics (confirmed, not changed)

Apply opens ONE session over the whole queue in filing order. The agent surveys every
request (collisions included) before editing, then proposes ONE transaction per
request against its evolving session draft. Nothing lands until accepted. The staged
diffs form an ordered stack: accept only the head ("accepts apply in staging order"),
reject only the tail, undo only the most recent applied. "Keep R2 but drop R1" when
R2 builds on R1 means peeling both and re-running — rebase-on-reject remains an open
question, alongside accept-all squashing to one revision instead of n.

## 5. The composer (Cursor-derived, one box)

- One container IS the input: borderless textarea, × top-right (red on hover),
  circular ↑ bottom-right. No printed action label.
- Custom tooltips (instant, centered above the control, dark bubble): `Close esc`,
  `Queue ⏎`.
- Ring-aligned: the box's edges match the dotted targeting ring's box (row text
  region ± 3px), so the pair reads as one assembly. Width is a style-rail setting
  (`composerWidth`), left edge stays pinned to the ring.
- STICKY: document clicks neither cancel nor re-target an open composer — only × or
  Escape close it. (⌘-drag range selection still re-targets; deliberate gesture.)
- Inserted widgets stack above the indent guides (`z-10`) so section hairlines never
  paint through the box.

## 6. The queue panel (chat layout)

The AI tab's rail was rebuilt from the mockup-A direction:

```
TARGETS                       ← section, no counts
  purpose              ×      ← violet human-readable label (outline section
      Tighten this.             name, ancestor fallback, raw id in tooltip);
  state_structure  ● processing   note INDENTED beneath its target
      Split the fields.
DOCUMENT
  document
      Keep the tone.
  [ Note about the whole document… ]   ← the doc input lives WITH its section
──────────────────────────────
✓ R4 · purpose · resolved  [Undo]     ← slim records
                       [ Apply ]      ← bottom dock: click-only, no counts
```

- Targets first, Document second. The split is wayfinding only — one Apply runs both
  as one batch.
- No alias chips, no `queued · next/#2` positions, no header counts, no pipeline
  line: order is the list order, and only meaningful states speak — `processing`
  (breathing dot + violet bar + fill), `staged` (green), `waiting on you` (amber,
  inline reply). Apply is click-only by design: no keystroke may start a run.
- Rows link to the document: hover washes the target block (and the block carries a
  persistent violet tick while noted), click selects AND scrolls to it. × dismiss
  appears on hover, red under the cursor.

## 7. Editing a queued note happens inline

Clicking a margin bubble reopens the INLINE composer above the block, prefilled with
the note (caret at end). Save REPLACES the note — the session contract has no update
door, so the lab refiles (same target, same disposition, fresh annotationId) and
dismisses the original. Consequences: the note re-aliases and moves to the end of
filing order. A real kernel-level update endpoint is the known upgrade if the
reordering grates.

## 8. Style rail additions

One theme (per 2026-08-04) plus new Layout controls: `panelInset` (right gap,
8–96px), `panelTopInset` (0–120px), `composerWidth` (320–1600px). The rows container
now sizes as `calc(100% − margin-left)` — the permanent horizontal scrollbar was the
left margin overflowing the scroller.

## 9. Open items this record does NOT close

Carried on the deep-dive list: reload amnesia (mid-session reload loses run marking;
kernel-side disposition persistence is the sketch), error surfacing (the host strip
is still the only error UI), accept-all revision granularity, stale-base rebase,
fixture directory conventions, and the 19 orphaned prompt-edit containers in canvas's
trace db.

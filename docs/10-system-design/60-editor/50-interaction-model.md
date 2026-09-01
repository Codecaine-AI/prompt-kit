---
covers: The pointer interaction model of the editing surface — the one-handle drag model, plain-drag object selection, native text selection, annotate mode, and read-mode inline rendering.
concepts: [drag, structural-selection, gestures, native-selection, annotate, inline-rendering]
depends-on: [10-system-design/60-editor/10-editing-model.md, 10-system-design/30-rendering-model.md]
---

# Interaction Model

> Cross-surface standard: [Core Annotate-Agent UX](../../../../docs/annotate-agent-ux.md).

The surface renders a structured document, and every pointer gesture acts on
structure. The address system is node ids, rings, and runs — not lines or
characters — and ONE BOUNDARY splits the vocabulary, Notion-style, with no
modifier: plain gestures within a unit edit text, and the same gestures
crossing unit boundaries act on structure. Command is annotate mode's modifier
only — in edit mode Cmd+click is a plain click.

---

## Gesture Language

| Gesture | Result |
|---------|--------|
| Hover | The one drag handle appears at the unit under the pointer |
| Click | Caret / inline edit ONLY — never a block selection (caret-first) |
| Shift+click on a bullet | Extend a contiguous item-range selection |
| Plain drag WITHIN one unit's text | NATIVE browser text selection; a release confined to one editable row opens the inline editor with the dragged range pre-selected (type to replace) |
| Plain drag CROSSING unit boundaries | OBJECT selection: the anchor-to-pointer row band live-resolves to a structural run (ring) on every move, kept on release |
| Plain drag inside the selection ring | Move the selected run |
| Backspace / Delete (selection active, no editor open) | Remove the run as one transaction |
| Escape / plain click elsewhere | Clear the selection (Escape mid-drag abandons the band) |

A unit is the list item under the pointer or, failing that, the owning block
node. The drag stays completely inert — native selection and click-to-edit
untouched — until the pointer leaves the pressed unit; only then does the
surface clear the native selection and suppress text selection, and only for
the remainder of that gesture. A drag that crosses out and ends back on its
anchor unit rings just the anchor unit (the drag route to a single-block
selection; the grip remains the explicit single-block handle).

## Caret-First Clicks

Clicking or typing in text is a CARET gesture, Notion-style: the caret plus
the unit-scoped edit wash (hover strength) is the entire treatment — no
selection fill, no accent rail, no gutter tint. Placing the caret never
selects the block it lands in; if a block selection exists when the caret
lands (click, arrow-key caret hop, typing on a selected block), the selection
is CLEARED, not retargeted. Commits made while an edit session is live also
suppress the change callback's selection echo, so hosts cannot re-select the
edited block on a keystroke.

Explicit selection keeps its reach: non-editable rows (close tags, attributed
open tags, code fences), the block grip, outline clicks, and queue focus rows
still select through the host's selection callback. Selection paint follows
"flood never, rail for extent" with one container rule — CONTAINERS NEVER
STRIPE: a selected section fills exactly its own open/close tag rows; a
selected LIST paints no per-row fill at all (its rendered rows are its
items'), keeping only the full-extent rail.

Quiet panels follow the caret by DERIVATION: the surface reports the edit
session's enclosing node, and the shell's details zone shows the explicit
selection if one exists, else that entry — without writing selection state or
painting selection chrome.

## Annotate Mode

In the AI state (the glass panel's `✦` tab) the vocabulary changes owner: the
shared annotations package drives hover rings, click-to-pin, and Cmd+drag
range annotation, and every editing affordance is hidden. While a composer is
open the pin is STICKY — document clicks neither cancel nor re-target it; only
its × or Escape close it. See the annotations package
(`@codecaine-ai/annotations`) for the mode's standard and
[60-application-shell.md](60-application-shell.md) for the queue it feeds.

## The One-Handle Drag Model

- At most ONE drag handle exists at any moment: the handle of the deepest
  draggable unit under the pointer, floating at that unit's left content
  edge — the indentation margin for a nested bullet, the gutter for a
  top-level block.
- Item rows resolve to the ITEM (bullets are draggable units in their own
  right); every other row resolves to its owning block. A list never owns a
  hover handle, because all of its rendered rows are its items'.
- Dragging a unit carries its children, so multi-line items move whole.
- The block handle doubles as the block-menu trigger; item handles are
  drag-only. Glyph sizes encode the hierarchy (block larger, item smaller).

The ghost is a compact token, not a copy of the block: the unit's first
rendered line, DOM-faithful (entities decoded exactly as displayed), plus a
muted "+N more" for multi-line drags. The thin drop indicator and the dimmed
source rows are the placement feedback.

Item reorders and block-run moves each commit as one undoable transaction.

## Structural Selection

- A covered row band (a plain drag's anchor-to-pointer rows, a shift-click
  range's extent) resolves to the SHALLOWEST contiguous sibling run that
  exactly covers the rows: bullets within one list select an item run;
  crossing a list boundary promotes to the block run at the common parent (a
  partial list promotes to the whole list); a band across sections selects
  the top-level run. The result is one object in the AST.
- The selection paints as ONE ring overlay, not per-row washes; hover washes,
  accent bars, and gutter tints are suppressed inside it. One ring = one
  object.
- The run moves by dragging its body (plain drag anywhere inside the ring) or
  by grabbing any handle inside it — both are the same group drag. Backspace
  or Delete removes it. Both are single transactions; one undo restores.
- Selection state survives host re-renders by VALIDATION, not identity: hosts
  rebuild the prompt object every render, so the state is kept while the
  document still materializes the run and retired only when it genuinely
  cannot.

No drag draws a selection rectangle, and there is no modifier-click unit
selection: the selection gesture is the modifier-free plain drag across unit
boundaries, live-resolved through the row-band rule on every pointer move.

## Read-Mode Inline Rendering

Prose and bullet rows render the decoded document, not the serialized XML:

- XML entities decode for display (`&lt;state&gt;` shows as `<state>`). Item
  and paragraph/field content rows decode; tag, code, and raw rows stay
  verbatim.
- Inline XML-ish tokens in prose take the tag palette; backtick spans render
  as inline code chips with the ticks visible but dimmed.
- Edit mode shows raw source in the editor — standard editor behavior.
- Annotation range mapping shares the same policy: the display-to-model
  offset walk is entity-aware, so Cmd+drag annotations over decoded rows
  still store exact model offsets and model-slice quotes.

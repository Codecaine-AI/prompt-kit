---
covers: The pointer interaction model of the editing surface — the one-handle drag model, marquee structural selection, the Command gesture language, annotate mode, and read-mode inline rendering.
concepts: [drag, structural-selection, marquee, gestures, annotate, inline-rendering]
design_refs: [10-system-design/20-authoring-model.md, 10-system-design/30-rendering-model.md]
---

# Interaction Model

The surface renders a structured document, and every pointer gesture acts on
structure. The address system is node ids, rings, and runs — not lines or
characters — and one modifier splits the vocabulary: plain gestures edit,
Command gestures act on structure.

---

## Gesture Language

| Gesture | Result |
|---------|--------|
| Hover | The one drag handle appears at the unit under the pointer |
| Click | Caret / inline edit ONLY — never a block selection (caret-first) |
| Shift+click on a bullet | Extend a contiguous item-range selection |
| Cmd+drag | Draw a marquee; the covered span becomes ONE structural selection |
| Cmd+click | Select the unit under the cursor as a one-object selection |
| Plain drag inside the selection ring | Move the selected run |
| Backspace / Delete (selection active, no editor open) | Remove the run as one transaction |
| Escape / plain click elsewhere | Clear the selection |

### Caret-First Clicks (2026-08-06)

Clicking or typing in text is a CARET gesture, Notion-style: the caret plus
the unit-scoped edit wash (hover strength) is the entire treatment — no
selection fill, no accent rail, no gutter tint. `focusEdit` never selects the
block it lands in; if a block selection exists when the caret lands (click,
arrow-key caret hop, typing on a selected block), the selection is CLEARED,
not retargeted. Commits made while an edit session is live also suppress the
change callback's selection echo, so hosts cannot re-select the edited block
on a keystroke.

Explicit selection keeps its reach: non-editable rows (close tags, attributed
open tags, code fences), the block grip, outline clicks, and queue focus rows
still select through `onSelectNode`. Selection paint follows "flood never,
rail for extent" with one container rule — CONTAINERS NEVER STRIPE: a
selected section fills exactly its own open/close tag rows; a selected LIST
paints no per-row fill at all (its rendered rows are its items'), keeping
only the full-extent rail.

Quiet panels follow the caret by DERIVATION: the buffer reports the edit
session's enclosing node through `onEditTargetChange`, and the lab's DETAILS
zone shows the explicit selection if one exists, else that entry — without
writing selection state or painting selection chrome.

In the AI state (the glass panel's `✦` tab) the vocabulary changes owner: the
shared annotations package drives hover rings, click-to-pin, and Cmd+drag range
annotation, and every editing affordance is hidden. While a composer is open
the pin is STICKY — document clicks neither cancel nor re-target it; only its
× or Escape close it. See the annotations package README
(`@codecaine-ai/annotations`) for the mode's standard and
[50-application-shell.md](50-application-shell.md) for the queue it feeds.

## The One-Handle Drag Model

`buffer/drag-handle.ts` (`resolveDragHandleUnit`) is the canonical
model, shared conceptually with docs-system:

- At most ONE drag handle exists at any moment: the handle of the deepest
  draggable unit under the pointer, floating at that unit's left content edge —
  the indentation margin for a nested bullet, the gutter for a top-level block.
- Item rows resolve to the ITEM (bullets are draggable units in their own
  right); every other row resolves to its owning block. A list never owns a
  hover handle, because all of its rendered rows are its items'.
- Dragging a unit carries its children: extents come from
  `computeNodeRanges` / `computeItemRanges`, so multi-line items move whole.
- The block handle doubles as the block-menu trigger; item handles are
  drag-only. Glyph sizes encode the hierarchy (block 20px, item 14px).

The ghost is a compact token, not a copy of the block: the unit's first
rendered line (DOM-faithful — entities decoded exactly as displayed) plus a
muted "+N more" for multi-line drags. The thin drop indicator and the dimmed
source rows are the placement feedback.

Item reorders commit through `moveListItemStep` / `moveListItemsStep`, block
runs through `block-run-steps.ts` — always one undoable transaction.

## Structural Selection

`structural-selection.ts` (`resolveMarqueeSelection`) is the canonical
resolution — the docs-system editor mirrors it:

- A Cmd+drag past 4px draws a live marquee. The rectangle's vertical band
  resolves to the SHALLOWEST contiguous sibling run that exactly covers the
  swept rows: bullets within one list select an item run; crossing a list
  boundary promotes to the block run at the common parent (a partial list
  promotes to the whole list); sweeping across sections selects the top-level
  run. The result is one object in the AST.
- The selection paints as ONE ring overlay (`data-prompt-selection-ring`),
  not per-row washes; hover washes, accent bars, and gutter tints are
  suppressed inside it. One ring = one object.
- The run moves by dragging its body (plain drag anywhere inside the ring) or
  by grabbing any handle inside it — both are the same group drag. Backspace
  or Delete removes it. Both are single transactions; one undo restores.
- Selection state survives host re-renders by VALIDATION, not identity: hosts
  rebuild the prompt object every render, so the state is kept while the
  document still materializes the run and retired only when it genuinely
  cannot (`structuralSelectionRun` is the validity check).

## Read-Mode Inline Rendering

Prose and bullet rows render the decoded document, not the serialized XML:

- XML entities decode for display (`&lt;state&gt;` shows as `<state>`); the
  policy lives in `lineRendersDecodedEntities` (item and paragraph/field
  content rows decode; tag, code, and raw rows stay verbatim).
- Inline XML-ish tokens in prose take the tag palette; backtick spans render
  as inline code chips with the ticks visible but dimmed.
- Edit mode shows raw source in the textarea — standard editor behavior.
- Annotation range mapping shares the same policy: the DOM→model offset walk
  in `lab/annotate/annotation-targeting.ts` is entity-aware, so Cmd+drag annotations
  over decoded rows still store exact model offsets and model-slice quotes.

## Module Map

| Module | Owns |
|--------|------|
| `buffer/drag-handle.ts` | Canonical one-handle resolution + rail geometry |
| `buffer/drag-controller.tsx` | Drag physics, ghost, slots, group commits |
| `structural-selection.ts` | Canonical marquee resolution + run materialization |
| `block-run-steps.ts` | Block-run move/remove transactions |
| `list-item-steps.ts` | Item and item-run move/remove steps |
| `lab/annotate/annotation-targeting.ts` | Annotate-mode DOM↔model bridging |

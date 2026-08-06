---
covers: The pure step producers behind the editor's structural gestures, the decline-by-null contract, and why moves are expressed as remove plus insert.
concepts: [steps, transactions, structure, ids, purity]
design_refs: [10-system-design/40-composition-and-transforms.md, 10-system-design/10-canonical-prompt-object.md]
---

# Structure Steps

Every block-level shape change is a pure function of the document. It reads a
`PromptDocument`, never mutates it, and returns the steps that produce the next
one.

---

## Result Contract

```ts
interface StructureStepResult {
  prompt: PromptDocument;
  steps: PromptStep[];
  focusNodeId?: string;
  focusItemIndex?: number;
  caretOffset?: number;
}
```

A producer returns `null` when the gesture does not apply. Null means "fall
through", not "failed": Enter falls back to splitting at the caret, Tab is
simply swallowed. Returning an empty result instead would force every caller to
distinguish "nothing to do" from "did nothing", so the distinction is carried in
the type.

`focusItemIndex` is set only when the focus target is a list, and `caretOffset`
only when the target has editable text — a section's tag line has none until the
caller decides to select it.

## Producers

All of the following live in `editor/steps/structure-steps.ts`.

| Function | Gesture | Declines when |
|----------|---------|---------------|
| `escapeListStep` | Enter on an empty list item | The item has text (the caller may pass its own emptiness verdict — the keymap passes the textarea's, which can be a keystroke ahead of the document), or a TOP-LEVEL item carries nested children (dropping it would discard them). A NESTED item with children no longer declines: the outdent carries the subtree, and trailing former siblings become the item's children (see `unnestListItemStep`) |
| `outdentParagraphStep` | Shift+Tab on a paragraph, Enter on a trailing empty one | The paragraph is at the document root or its parent is not a section |
| `indentParagraphIntoSectionStep` | Tab on a paragraph | The previous sibling is not a section |
| `demoteSectionStep` | Tab on a section | The previous sibling is not a section |
| `promoteSectionStep` | Shift+Tab on a section | The section is at the root or its parent is not a section |
| `convertParagraphToStep` | Slash command, markdown autoformat | The node is missing or is not a paragraph |
| `convertBlockToParagraphStep` | Backspace restoring a swallowed marker | The node is missing or already a paragraph |

List-item mechanics live one level up, in
`editor/steps/list-item-steps.ts`, and follow the same shape:
`splitListItemStep`, `mergeListItemsStep`, `nestListItemStep`,
`unnestListItemStep`, `insertListItemStep`, `removeListItemStep`,
`removeListWithStep`, `setListItemContentStep`.

## Moves Are Remove Plus Insert

`outdentParagraphStep`, `indentParagraphIntoSectionStep`, `demoteSectionStep`,
and `promoteSectionStep` all reparent a block through one shared helper:
`removePromptBlockNodeByIdWithStep` followed by
`insertPromptBlockNodeWithStep` against the new anchor.

The ordering matters. Removing first frees the subtree's ids, so
`prepareBlockForInsert` re-attaches the **same** ids rather than minting new
ones. Ids are part of the canonical document, so preserving them across a
reparent is what keeps the content hash stable for a move that changed only
nesting — and what lets the caller keep the caret in the block it just moved.

`escapeListStep` inverts the order in one case: when the list has a single item,
the paragraph is inserted **before** the list is removed, because the list is
the only anchor for that position.

## Conversions Keep Their Id

`convertParagraphToStep` replaces a paragraph with a differently-shaped block in
place, keeping the paragraph's id and position, as a single update step. The
paragraph's inline content is carried into the new node's first editable slot —
the first list item, the code body, or the section's first child paragraph — so
the conversion is safe on a paragraph that already holds text. Structured inline
nodes survive, and adjacent plain runs are coalesced so the result is identical
to typing the same characters.

New descendants arrive without ids, so the replacement runs through
`ensurePromptNodeIds` before the update step is recorded. Settling ids before
the step is captured is what stops undo and redo from re-minting them.

The caret lands at the end of the carried text. The composition root overrides
that for `section`: the producer points at the section's first body paragraph,
but a section the author just asked for is unnamed, so the caret goes to its tag
with the placeholder name **selected**. Typing renames it; Enter drops into the
body.

## Transactions

A gesture that takes several steps hands them over as one array. The host
commits the array as one transaction, so a single undo restores the whole move.

| Gesture | Steps |
|---------|-------|
| Split a paragraph | update + insert |
| Merge two paragraphs | update + remove |
| Reparent a block | remove + insert |
| Escape a single-item list | insert + remove |
| Escape a multi-item list | remove-item + insert |
| Convert a paragraph | update |

## Tree Walking

Two different walks coexist deliberately.

`locateBlock` mirrors the prompt-kit editor tree: it descends through `section`,
`example`, `field`, and `contextUsage` bodies but **not** into list items, whose
children are addressed through the list-step helpers instead.

`findListNodeById` walks everything, including lists nested inside list items,
because escaping a list has to inspect the very nesting the editor tree hides.
The surface compensates by registering synthetic tree entries for nested lists
(`registerNestedLists`) so their items stay inline-editable and item operations
resolve by id.

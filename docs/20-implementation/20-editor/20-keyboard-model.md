---
covers: Every keyboard gesture the prompt editing surface implements, the order handlers see a key in, and the deliberate deviations from conventional editor behavior.
concepts: [keyboard, keymap, gestures, caret, autoformat]
design_refs: [10-system-design/40-composition-and-transforms.md]
---

# Keyboard Model

One handler serves every editor on the surface — list items, paragraphs, fields,
raw and code — so a key means the same thing wherever the caret is.

---

## Handler Order

A key reaches four consumers in order. The first to call `preventDefault` wins.

| Order | Consumer | Claims |
|-------|----------|--------|
| 1 | Slash-menu handler | Arrow up/down, Enter, Tab, Escape while a slash menu is open on this line |
| 2 | Marker-undo handler | Backspace on the caret a markdown conversion just placed |
| 3 | `handleEditorKey` | Enter, Backspace, Delete, arrows, Tab |
| 4 | `GrowTextArea` guard | Escape (blur), and a bare Enter on a single-line editor |

`handleEditorKey` returns immediately when `metaKey`, `ctrlKey`, or `altKey` is
held. Modifier chords are left untouched so the shell's undo/redo/save
shortcuts reach it and native word-motion keeps working in the textarea.

## Gestures

| Gesture | Context | Behavior |
|---------|---------|----------|
| Enter | Section open tag | Moves the caret to the section's first editable row |
| Enter | Empty list item, nested | Outdents one level, landing after its former parent item. The item's own children ride along, and trailing former siblings become its children (standard outliner outdent). Emptiness is the TEXTAREA's verdict, passed down explicitly, so a just-emptied row outdents even before the document catches up |
| Enter | Empty list item, top level | Drops the item and opens a new paragraph after the list (declines while the item still carries children — dropping it would discard them) |
| Enter | Empty list item, only item | Removes the list; the paragraph takes its place |
| Enter | Empty paragraph that is the last child of a section | Moves the paragraph out to be the section's next sibling |
| Enter | Paragraph or list item with text | Splits at the caret; text after the caret becomes a new sibling below, caret at its start |
| Enter | List item with text carrying a nested child list | Splits at the caret; the new item becomes the FIRST item of the first child list — the row directly below the caret — and the children stay with the original item. The caret follows into the child list (`focusListId`) |
| Enter | Field | Leaves the editor with the row still selected — there is no sibling to split into |
| Enter | `raw` / `codeBlock` | Literal newline |
| Shift+Enter | Any row | Not claimed by the keymap; the textarea inserts a literal newline |
| Backspace at offset 0 | List item with text, previous caret target in the same list | Merges into the previous item, caret at the join |
| Backspace at offset 0 | Empty list item | Removes the item, or the whole list when it was the only one |
| Backspace at offset 0 | Paragraph with text, previous caret target is a sibling paragraph | Merges into it, caret at the join |
| Backspace at offset 0 | Empty paragraph | Removes it |
| Backspace at offset 0 | No safe merge (field, raw, code, or a boundary) | Moves focus to the end of the previous editable row |
| Backspace at offset 0 | First editable row of the document, carrying text | No-op |
| Delete at end of value | List item, next caret target in the same list | Absorbs the next item |
| Delete at end of value | Paragraph, next caret target is a sibling paragraph | Absorbs it |
| Delete at end of value | Anything else | No-op |
| ArrowUp / ArrowDown | Caret at the row's first/last position, or anywhere in a row that renders as one visual line | Lands on the previous/next editable row, caret at its end (up) or start (down) |
| Tab | List item after the first | Nests it under the previous item |
| Tab | Paragraph directly after a section | Moves it in as that section's last child |
| Tab | Section after a sibling section | Nests it as that section's last child |
| Shift+Tab | Nested list item | Hoists it out to sit after its former parent item; its own children ride along and trailing former siblings become its children, so it never jumps below its old context |
| Shift+Tab | Paragraph inside a section | Moves it out to be the section's next sibling |
| Shift+Tab | Nested section | Lifts it out to be its parent's next sibling |
| Tab / Shift+Tab | Nothing applies | Swallowed |
| Escape | Editing | Blurs the editor; the row stays selected |
| Escape | Slash menu open | Closes the menu; the caret keeps blinking |
| `/` | Empty paragraph, typed as the first character | Opens the slash menu |
| Printable character | A block is selected but not being edited | Enters the editor with the character appended |

Structural gestures land the caret in the block they moved, at the same offset
where possible, so a level change is never a reason to stop typing.

## Deliberate Deviations

**Backspace at offset 0 is never a dead keystroke.** When no structural change
is safe the resolution still moves focus to the previous editable row's end. A
browser's own Backspace at offset 0 is a no-op, so preventing it costs nothing.

**Merges never cross a container boundary.** Items merge only into items of the
*same* list; an intervening nested list breaks adjacency because its items
become the previous caret targets. Paragraphs merge only when both rows are
paragraphs and their `parentPath` values are equal.

**Typing on a selected block appends rather than replaces.** A stray keystroke
must never silently destroy a block's text, so the character is appended to the
current value and the caret lands after it. The handler is a window listener
that stands down whenever another input, textarea, select, or contenteditable
holds focus.

**Tab is a level key, never a focus key.** It calls `preventDefault`
unconditionally, including where no move applies, so the caret cannot be tabbed
out of the buffer mid-sentence.

**Arrow keys step rows from anywhere in a single-line row.** A row occupying one
line of its own metrics has no inner vertical motion, so pressing Up from the
middle of a short item must not first park the caret at offset 0. The surface
measures `scrollHeight` against the computed line height to decide.

**Enter prefers structure over splitting.** An empty row asking to leave its
container beats splitting it into two empty rows, so the structural branch runs
first and Enter falls through to a split only when no structural step applies.

## Markdown Autoformat

Typing a marker at the start of an empty paragraph converts the block.

| Typed | Becomes |
|-------|---------|
| `- ` or `* ` | `bulletList` |
| `1. ` or `1) ` (any digits) | `orderedList` |
| ` ``` ` | `codeBlock`, trailing text taken as the fence language |

`resolveAutoformat(previous, next)` fires only when `next` names a marker,
`previous` did not, `previous` is a prefix of `next` (the edit appended), and
`previous` was shorter than the marker. The last clause keeps `- ` from firing
when the caret is parked at the start of a paragraph that already carries prose.

There is deliberately no `# ` heading rule: the surface has no headings, and a
section is a wrapper the author names rather than a rank.

**Backspace restores the marker.** After a conversion the surface remembers the
literal text that was swallowed and the caret placement it produced. Backspace
on that exact caret converts the block back into a paragraph carrying the
literal characters, so the keystroke means "I did not want a list" instead of
"delete this block". Any other keystroke retires the offer. The restore is
itself a step, so undo can also take the marker back.

## Slash Menu

Typing `/` as the first character of an empty **paragraph** opens a caret-anchored
command menu. It is paragraph-only in both directions: the trigger checks the
row's node type, and the underlying `convertParagraphToStep` returns `null` for
anything that is not a paragraph, so offering it elsewhere would be a menu of
commands that decline.

| Key | Effect |
|-----|--------|
| Typing | Extends the query; the menu re-filters and the selection resets to the top |
| ArrowUp / ArrowDown | Moves the selection, wrapping at both ends |
| Enter / Tab | Runs the selected command |
| Escape | Closes the menu, leaving the typed text as literal prose |

The menu never takes focus, so the caret keeps blinking behind it. It retires
when the `/` is removed, when the query matches nothing, or when the caret moves
to another row. Running a command drops the literal `/query` text — it was the
command, not content.

`matchSlashCommands(query)` ranks case-insensitively: label prefix, then alias
prefix, then label substring, then alias substring, with ties keeping canonical
order. An empty query returns every command.

## Tested Surface

| Test | Covers |
|------|--------|
| `editor-keymap.test.ts` | Key dispatch and the resulting steps |
| `edit-navigation.test.ts` | Edit points and Backspace/Delete resolutions |
| `structure-steps.test.ts` | Structural step producers |
| `node-mutations.test.ts` | Paragraph split/merge/remove |
| `list-item-steps.test.ts` | List item split/merge/nest/unnest/remove |
| `autoformat.test.ts` | Marker matching and the trigger rule |
| `slash-commands.test.ts`, `slash-session.test.ts` | Ranking and the menu state machine |
| `click-caret.test.ts` | Click point to caret offset |

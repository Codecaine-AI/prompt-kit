---
covers: The behavioral design of the prompt editor, covering the editing model, keyboard gestures, presentation contract, block vocabulary, pointer interactions, and the lab shell.
type: overview
concepts: [editor, editing-model, keyboard, presentation, interaction]
depends-on: [10-system-design/10-canonical-prompt-object.md, 10-system-design/30-rendering-model.md]
---

# Prompt Editor

The prompt editor presents a `PromptDocument` as editable XML-tagged Markdown.
The document is canonical: the text on screen is a rendered projection, every
gesture commits as a structural step, and the rendered string is never parsed
back into nodes.

These pages specify the editor's behavior — what a keystroke, click, or drag
means — independent of any host application.

---

## Design Commitments

- **One source of truth.** Every row knows which node it projects and which
  property it edits; commits write that property back into the document.
- **Steps, not snapshots.** Structural changes are expressed as steps and
  committed as transactions, so one gesture is one undo.
- **Caret-first.** Clicking or typing in text is a caret gesture, never a
  block selection; explicit selection has its own gestures.
- **Presentation is separate.** Style is a token contract; no style choice
  changes the document or its content hash.

## Contents

### [10-editing-model.md](10-editing-model.md)

How the document projects into editable rows, how text and structure commit,
and how the caret survives structural moves.

### [20-keyboard-model.md](20-keyboard-model.md)

Every keyboard gesture the surface implements, including the deliberate
deviations from conventional editor behavior.

### [30-presentation.md](30-presentation.md)

The CSS variable contract shared by the editable surface and the read-only
prompt view, and the style settings that project it.

### [40-block-vocabulary.md](40-block-vocabulary.md)

The block types an author can create, how the rest of the node set behaves in
the editor, and why a section's name is its tag.

### [50-interaction-model.md](50-interaction-model.md)

The pointer model: the one drag handle, plain-drag object selection, native
text selection, and annotate mode.

### [60-application-shell.md](60-application-shell.md)

The lab shell around the surface: views, the glass panel, the annotation
queue, history, and autosave.

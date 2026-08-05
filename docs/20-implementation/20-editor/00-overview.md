---
covers: The prompt-editing UI architecture built on prompt-kit, including the editing model, keyboard model, structural steps, presentation contract, application shell, block vocabulary, and the current package split.
type: overview
concepts: [editor, ui, editing-model, keyboard, presentation]
design_refs: [10-system-design/10-canonical-prompt-object.md, 10-system-design/30-rendering-model.md]
---

# Prompt Editing UI

A working prompt editor exists for prompt-kit documents. It presents a
`PromptDocument` as editable XML-tagged Markdown, commits every gesture as a
transaction step, and never treats the rendered text as a source of truth.

This area documents that editor's architecture. Its canonical implementation
lives in `packages/prompt-kit/src/ui/`; see
[70-package-split.md](70-package-split.md) for the package boundary.

---

## File Tree

```text
20-editor/
├── 00-overview.md              (this file) Editing UI entry point
├── 10-editing-model.md         Document as source, projection, steps, caret continuity
├── 20-keyboard-model.md        Every keyboard gesture as shipped
├── 30-structure-steps.md       Structural gestures as pure step producers
├── 40-presentation-contract.md CSS variable contract and style settings
├── 50-application-shell.md     Page header, glass panel, queue, autosave, history
├── 60-block-vocabulary.md      Creatable blocks versus the full node set
├── 70-package-split.md         What lives where today and where it is headed
└── 80-interaction-model.md     Drag handles, marquee selection, the Command gesture language
```

## Contents

### [10-editing-model.md](10-editing-model.md)

Explains why the document is canonical, how the line model guarantees the
editor's rows equal `renderXmlMarkdown` output, how text commits flow through
the transaction helpers, and how the caret survives structural moves.

### [20-keyboard-model.md](20-keyboard-model.md)

Tabulates every keyboard gesture the surface implements, including the
deliberate deviations from conventional editor behavior.

### [30-structure-steps.md](30-structure-steps.md)

Documents the pure step producers behind Enter, Tab, the slash menu, and
markdown autoformat, and why moves are expressed as remove-plus-insert.

### [40-presentation-contract.md](40-presentation-contract.md)

Documents the `--prompt-editor-*` variable contract shared by the editable
surface and the read-only prompt view, and the settings object that projects it.

### [50-application-shell.md](50-application-shell.md)

Documents the lab shell around the editing surface: the in-document page
header, the fixed glass panel (Edit/AI tabs, zones, the annotation queue),
views, undo/redo, and autosave.

### [60-block-vocabulary.md](60-block-vocabulary.md)

Documents the five creatable block types against the full prompt-kit node set,
and records that a `section`'s `title` property is never rendered.

### [70-package-split.md](70-package-split.md)

Records the current package boundary between prompt-kit and the host viewer,
and the seam along which the editing work could move into prompt-kit.

## Source Map

Paths are relative to `packages/prompt-kit/src/ui/`. Host viewers consume these
modules through prompt-kit's exported UI entry points; see
[70-package-split.md](70-package-split.md).

| Area | Path |
|------|------|
| Line model | `document/render/line-model.ts` |
| Editing surface | `editor/buffer/` |
| List-item steps | `editor/steps/list-item-steps.ts` |
| Node inspector | `editor/inspector/` |
| Lab shell | `lab/` |
| Edit history | `lab/prompt-lab-history.ts` |
| Style settings | `style/prompt-style-settings.ts`, `style/use-prompt-style-settings.ts` |
| Surface tokens | `surface/editor-surface.ts`, `surface/xml-highlight.tsx` |
| Read-only view | `view/PromptView.tsx` |

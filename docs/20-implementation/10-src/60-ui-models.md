---
covers: How prompt-kit exposes lightweight UI-facing models for prompt preview and future prompt editor surfaces.
concepts: [ui, preview, editor, models]
design_refs: [10-system-design/60-kernel-boundary.md]
---

# UI Models

The UI module exposes headless models that a host viewer or editor can consume.
It does not define a full UI application.

---

## Files

| File | Responsibility |
|------|----------------|
| `src/ui/index.ts` | UI barrel export |
| `src/ui/renderers/index.ts` | `createPromptPreviewModel` |
| `src/ui/editors/index.ts` | `createPromptEditorModel` |

## Preview Model

`createPromptPreviewModel(prompt)` returns the source prompt and the default
rendered XML Markdown string:

```ts
interface PromptPreviewModel {
  prompt: PromptDocument;
  rendered: string;
}
```

This is enough for an agent viewer to show both the structured prompt source and
the rendered prompt text.

## Editor Model

`createPromptEditorModel(prompt)` currently returns the prompt and optional
selected node id:

```ts
interface PromptEditorModel {
  prompt: PromptDocument;
  selectedNodeId?: string;
}
```

The model is intentionally minimal. Rich editing behavior can grow around the
canonical prompt object without putting UI framework code inside prompt-kit.

## Direction

A full prompt-editing UI has since been built on these models, and is being
relocated into this package behind separate `./ui/react` and friends
specifiers with React as an optional peer dependency. See
[20-editor/00-overview.md](../20-editor/00-overview.md) for its architecture and
[20-editor/70-package-split.md](../20-editor/70-package-split.md) for the
migration state. The boundary statement above needs revising to describe that
arrangement.


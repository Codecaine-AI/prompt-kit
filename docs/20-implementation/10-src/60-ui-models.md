---
covers: How prompt-kit exposes lightweight UI-facing models for prompt preview and future prompt editor surfaces.
concepts: [ui, preview, editor, models]
design_refs: [10-system-design/60-kernel-boundary.md]
---

# UI Models

The UI module exposes headless models that host viewers and editors can consume.
Prompt-kit also provides a full prompt-editing application shell under
`packages/prompt-kit/src/ui/lab`, with React-facing modules isolated behind
dedicated package entry points and React declared as an optional peer
dependency.

---

## Files

| File | Responsibility |
|------|----------------|
| `packages/prompt-kit/src/ui/index.ts` | UI barrel export |
| `packages/prompt-kit/src/ui/editors/index.ts` | `createPromptEditorModel` |

The earlier preview model (`createPromptPreviewModel` in `src/ui/renderers/`)
was removed 2026-08-05 as unused; it is recoverable from git history.

## Editor Model

`createPromptEditorModel(prompt, options)` prepares the prompt for editing and
returns its selection, flattened tree, rendered output, and validation result:

```ts
interface PromptEditorModel {
  prompt: PromptDocument;
  selectedNodeId?: string;
  selectedEntry?: PromptEditorTreeEntry;
  tree: PromptEditorTreeEntry[];
  rendered: string;
  validation: PromptValidationResult;
}
```

Unless `ensureIds` is false, the returned prompt has stable block IDs. The tree
contains path, depth, sibling, label, and summary metadata for every block. A
valid requested selection is preserved; otherwise the first tree entry is
selected. Rendering accepts runtime variables, while validation accepts the
set of declared variable names.

The headless model supports the full application shell without depending on
React or the DOM. See [20-editor/00-overview.md](../20-editor/00-overview.md) for
the editor architecture and
[20-editor/70-package-split.md](../20-editor/70-package-split.md) for the package
boundary and entry points.

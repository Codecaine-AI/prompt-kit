---
covers: Where the prompt-editing UI lives, the headless and React entry points prompt-kit exposes for it, and the state of its relocation out of the host viewer package.
concepts: [package-boundary, entry-points, portability, migration]
design_refs: [00-foundation/10-purpose-and-boundary.md, 10-system-design/60-kernel-boundary.md]
---

# Package Split

The editing UI was built inside `agent-kernel`'s `viewer-ui` package and was
relocated into prompt-kit. The original copies were removed, and host viewers
now consume prompt-kit's exported UI entry points.

---

## Entry Points

The relocation splits the package's UI surface along a headless/React line.

| Entry | Contents |
|-------|----------|
| `@codecaine-ai/prompt-kit` | Core prompt document, rendering, validation, and node APIs |
| `@codecaine-ai/prompt-kit/annotations` | Headless annotation types and helpers |
| `@codecaine-ai/prompt-kit/ui` | Editor models, tree, node access, steps, transaction log — no React, no DOM |
| `@codecaine-ai/prompt-kit/ui/annotations` | UI-facing annotation models and helpers |
| `@codecaine-ai/prompt-kit/ui/react` | Every React-facing piece, re-exporting the five entries below |
| `@codecaine-ai/prompt-kit/ui/prompt-flow` | Editing surface, node inspector, line model, change-handler types |
| `@codecaine-ai/prompt-kit/ui/lab` | Lab shell, glass panel, annotation queue, autosave, history, style rail |
| `@codecaine-ai/prompt-kit/ui/style` | Style settings, presets, variable projection, React hook |
| `@codecaine-ai/prompt-kit/ui/surface` | Surface tokens and the XML highlighter |
| `@codecaine-ai/prompt-kit/ui/view` | Read-only prompt view |

React and React DOM are declared as **optional** peer dependencies, so the
headless `./ui` entry stays usable from servers, scripts, and tests. Keeping the
React components behind a separate specifier is what preserves that.

## Headless Layer

These modules are pure logic over `PromptDocument`. None renders, none reads the
DOM, and each has its own unit tests.

| Module | Contents |
|--------|----------|
| `ui/editors/` | Editor model, tree, node access, id handling, text bridging |
| `ui/editors/transactions.ts` | Steps, step algebra, transaction log |
| `ui/prompt-flow/xml-line-model.ts` | Row projection mirroring the XML renderer |
| `ui/prompt-flow/PromptFlowXml/edit-navigation.ts` | Edit points, Backspace and Delete resolutions |
| `ui/prompt-flow/PromptFlowXml/structure-steps.ts` | Structural step producers |
| `ui/prompt-flow/PromptFlowXml/autoformat.ts` | Markdown marker matching and the trigger rule |
| `ui/prompt-flow/PromptFlowXml/slash-commands.ts` | Command vocabulary and ranking |
| `ui/prompt-flow/PromptFlowXml/slash-session.ts` | Slash-menu state machine |
| `ui/prompt-flow/list-item-steps.ts` | List-item step producers |
| `ui/prompt-flow/PromptFlowInspector/attrs.ts` | Attribute row projection and key sanitation |
| `ui/lab/autosave-controller.ts` | Debounced single-flight save coordinator |
| `ui/lab/prompt-lab-history.ts` | Unified undo/redo over steps and metadata |
| `ui/style/prompt-style-settings.ts` | Settings shape, presets, normalization, variable projection |

Two caveats qualify that list:

- `prompt-style-settings.ts` type-imports React's `CSSProperties` for the return
  type of `promptStyleVars`. The import is erased at build time; the logic is
  framework-free.
- `structure-steps.ts` imports `findUnnestLocation` from
  `PromptFlowXml/node-mutations.ts`, which is a React module. The imported
  function is itself pure, so the dependency is one misplaced helper rather than
  a real coupling.
## React Layer

| Module | Contents |
|--------|----------|
| `ui/prompt-flow/PromptFlowXml/` | `index.tsx`, `XmlRow`, `ItemRow`, `SectionTagRow`, `InlineEditor`, `GrowTextArea`, `BlockCluster`, `BlockMenu`, `SectionOutline`, `SlashMenu`, `drag-controller`, the `node-geometry` hook |
| `ui/prompt-flow/PromptFlowInspector/` | Node detail editors |
| `ui/lab/` | Shell, glass panel, queue rail, composer, context/state surfaces, style rail |
| `ui/surface/` | Style tokens typed as React `CSSProperties`, XML highlighter returning JSX |
| `ui/style/use-prompt-style-settings.ts` | React hook over the settings module |
| `ui/view/PromptView.tsx` | Read-only prompt view |

## Styling Contract

The components ship no CSS bundle, no Tailwind config, and no build step. The
host supplies the presentation layer in three parts:

1. **Tailwind utilities.** The components use Tailwind class names. A consumer
   that already runs Tailwind would otherwise end up with two copies of the
   utility layer, so the host's Tailwind must have prompt-kit's source on its
   content paths.
2. **Semantic tokens.** Colors resolve through the host's token layer
   (`--background`, `--foreground`, `--muted-foreground`, `--border`,
   `--accent`), so the editor inherits the surrounding app's theme.
3. **`.prompt-editor-surface` rules.** Row striping and caret behavior ship with
   the host's stylesheet.

Runtime-tunable values are read from `--prompt-editor-*` custom properties; see
[40-presentation-contract.md](40-presentation-contract.md).

## Migration State

The relocation was completed in commit `3002647` and subsequent work:

| Fact | State |
|------|-------|
| Modules present under `packages/prompt-kit/src/ui/` | Yes, committed in prompt-kit |
| Subpath exports declared in `package.json` | Yes |
| React declared as an optional peer dependency | Yes |
| Original copies removed from `agent-kernel/packages/viewer-ui/src/` | Yes |
| Host viewer package importing from the new entry points | Yes |

During relocation, internal imports were adjusted to resolve prompt-kit through
relative paths instead of the package name. The prompt-kit modules are now the
canonical implementation used by host applications.

---

## Boundary Consequence

[00-foundation/10-purpose-and-boundary.md](../../00-foundation/10-purpose-and-boundary.md)
and [10-src/60-ui-models.md](../10-src/60-ui-models.md) describe the boundary as
it now stands. Prompt-kit includes React UI, but the optional peer dependency
and separate React-facing specifiers preserve a framework-free default and
headless surface. A consumer that imports only the core, annotation, or
headless UI entries does not pull React in.

---
covers: Where the prompt-editing UI lives, the headless and React entry points prompt-kit exposes for it, and the state of its relocation out of the host viewer package.
concepts: [package-boundary, entry-points, portability, migration]
design_refs: [00-foundation/10-purpose-and-boundary.md, 10-system-design/60-kernel-boundary.md]
---

# Package Split

The editing UI was built inside `agent-kernel`'s `viewer-ui` package and is
being relocated into prompt-kit. Both copies exist in the working tree. This
page records that state rather than pretending either half of it away.

---

## Entry Points

The relocation splits the package's UI surface along a headless/React line.

| Entry | Contents |
|-------|----------|
| `@codecaine-ai/prompt-kit/ui` | Editor models, tree, node access, steps, transaction log — no React, no DOM |
| `@codecaine-ai/prompt-kit/ui/react` | Every React-facing piece, re-exporting the four entries below |
| `@codecaine-ai/prompt-kit/ui/prompt-flow` | Editing surface, node inspector, line model, change-handler types |
| `@codecaine-ai/prompt-kit/ui/lab` | Lab shell, statusbar, inspector, autosave, history, style rail |
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

Three caveats qualify that list:

- `prompt-style-settings.ts` type-imports React's `CSSProperties` for the return
  type of `promptStyleVars`. The import is erased at build time; the logic is
  framework-free.
- `structure-steps.ts` imports `findUnnestLocation` from
  `PromptFlowXml/node-mutations.ts`, which is a React module. The imported
  function is itself pure, so the dependency is one misplaced helper rather than
  a real coupling.
- `PromptFlowXml/editor-keymap.ts` is pure decision logic, but its entry point
  takes a React keyboard event. `PromptFlowXml/click-caret.ts` and
  `PromptFlowXml/caret-rect.ts` are free of React but require a DOM.

## React Layer

| Module | Contents |
|--------|----------|
| `ui/prompt-flow/PromptFlowXml/` | `index.tsx`, `XmlRow`, `ItemRow`, `SectionTagRow`, `InlineEditor`, `GrowTextArea`, `BlockCluster`, `BlockMenu`, `SectionOutline`, `SlashMenu`, `drag-controller`, the `node-geometry` hook |
| `ui/prompt-flow/PromptFlowInspector/` | Node detail editors |
| `ui/lab/` | Shell, statusbar, inspector, agent zone, context surface, style rail |
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

At the time of writing the relocation is uncommitted and incomplete:

| Fact | State |
|------|-------|
| Modules present under `prompt-kit/src/ui/` | Yes, as an unstaged copy |
| Subpath exports declared in `package.json` | Yes |
| React declared as an optional peer dependency | Yes |
| Original copies still in `agent-kernel/packages/viewer-ui/src/` | Yes |
| Host viewer package importing from the new entry points | No |

The relocated copies differ from the originals only by import specifier — the
prompt-kit copies resolve prompt-kit through relative paths instead of the
package name. Behavior is identical, so everything the rest of this area
documents applies to both.

Until the host viewer package switches over, `viewer-ui` remains the copy the
running application uses.

---

## Boundary Consequence

[00-foundation/10-purpose-and-boundary.md](../../00-foundation/10-purpose-and-boundary.md)
and [10-src/60-ui-models.md](../10-src/60-ui-models.md) both state that
prompt-kit deliberately keeps UI framework code out of the package. The optional
peer dependency and the separate `./ui/react` specifier soften that boundary
rather than erasing it: the default and headless entries remain React-free, and
a consumer that never imports `./ui/react` never pulls React in.

Those two statements still need revising to describe the boundary as it now
stands. That is a decision about the package's identity rather than an editorial
cleanup, so it is flagged here rather than made.

---
covers: The CSS variable contract shared by the editable prompt surface and the read-only prompt view, and the settings object that projects it.
concepts: [presentation, css-variables, style-settings, tokens]
design_refs: [10-system-design/30-rendering-model.md]
---

# Presentation Contract

Presentation is a set of CSS custom properties. The editable surface and the
read-only prompt view read the same tokens, so switching between them reads as
toggling editability rather than opening a different document.

---

## Viewer-Only Guarantee

Nothing in this contract touches the document. Style settings change no node, no
rendered string, and no content hash; they are not persisted with the prompt and
they are not part of a save. Row shading, guides, and line numbers are painted
with zero-layout-cost backgrounds and visibility multipliers so toggling them
never changes row geometry either.

## Variable Contract

A host may set any `--prompt-editor-*` property on the surface element or one of
its ancestors. Every token has a literal fallback, so the components render
correctly with no host variables set at all.

`PROMPT_EDITOR_ROOT_CLASS` (`"prompt-editor-surface"`) marks the scoped root, so
descendants can observe style changes on it.

### Metrics

| Token | Default | Drives |
|-------|---------|--------|
| `--prompt-editor-font-family` | System mono stack | Row and editor type |
| `--prompt-editor-font-size` | `13px` | Row and editor type |
| `--prompt-editor-line-height` | `22px` | Row pitch, rule spacing, editor minimum height |
| `--prompt-editor-letter-spacing` | `0em` | Row and editor tracking |
| `--prompt-editor-indent-width` | `2ch` | Visual width of one renderer indent unit |
| `--prompt-editor-content-width` | `136ch` | Measure of the buffer column |
| `--prompt-editor-gutter-width` | `5ch` | Line-number gutter width |
| `--prompt-editor-grip-size` | `14px` | Drag-handle size |
| `--prompt-editor-drop-line-width` | `2px` | Drop-indicator thickness |

### Visibility

| Token | Values | Effect |
|-------|--------|--------|
| `--prompt-editor-show-rules` | `0` / `1` | Ruled-paper hairline intensity |
| `--prompt-editor-show-zebra` | `0` / `1` | Alternating row tint intensity |
| `--prompt-editor-show-guides` | `0` / `1` | Indent-guide visibility |
| `--prompt-editor-guides-display` | `block` / `none` | Indent-guide display |
| `--prompt-editor-show-line-numbers` | `0` / `1` | Gutter number visibility |
| `--prompt-editor-line-numbers-display` | `block` / `none` | Gutter number display |

### Color

Colors come in two forms. Semantic tokens such as `--prompt-editor-bg`,
`--prompt-editor-fg`, `--prompt-editor-guide`, `--prompt-editor-rule`,
`--prompt-editor-landmark`, `--prompt-editor-selection-bg`,
`--prompt-editor-active-line-bg`, and `--prompt-editor-hover-bg` are consumed
directly by the components. Syntax tokens —
`--prompt-editor-syntax-punctuation`, `-tag`, `-attribute`, `-value`,
`-variable`, `-reference`, `-list-marker` — drive the shared XML highlighter.
Several semantic tokens are additionally published in split
`*-color` / `*-opacity` form so a host UI can bind a picker and a slider
independently.

The semantic tokens also accept a legacy `--editor-*` fallback layer, which
keeps the components usable in hosts that predate the prompt style rail.

## Helpers

| Export | Purpose |
|--------|---------|
| `EDITOR_METRICS` | Metric tokens as CSS expressions, not frozen pixels |
| `EDITOR_COLORS` | Color tokens with fallback chains |
| `editorTypeStyle` | Base type metrics for row and editor containers |
| `editorRuleBackground` | Ruled-paper background, one hairline per line row |
| `promptEditorZebraBackground(lineIndex)` | Tint for odd zero-based rows |
| `promptEditorGutterWidth(fallback)` | Host gutter width with a content-aware fallback |
| `promptEditorIndentForSpaces(count)` | Visual width for a rendered indent prefix |
| `promptEditorIndentForDepth(depth)` | Visual width for a known nesting depth |

The two indent helpers exist because rows measure the indent they actually
rendered, while overlays (indent guides, the drop indicator) know a node's depth
without reading its text.

## Style Settings

`PromptStyleSettings` is the host-facing settings object. It is a flat record of
metrics, toggles, and colors, normalized on every read and write.

| Export | Purpose |
|--------|---------|
| `PromptStyleSettings` | The settings shape |
| `PromptRowShading` | `"none" \| "rules" \| "zebra"` |
| `PromptMonoFontFamily` | `"system" \| "sf-mono" \| "jetbrains-mono" \| "ibm-plex-mono"` |
| `PromptStylePresetId` | `"dense" \| "balanced" \| "reading"` |
| `PROMPT_STYLE_PRESETS` | The three presets |
| `PROMPT_STYLE_DEFAULTS` | The `balanced` preset |
| `PROMPT_STYLE_STORAGE_KEY` | `"agentKernel.promptEditorStyle.v1"` |
| `normalizePromptStyleSettings` | Clamps numbers, validates enums, applies fallbacks |
| `loadPromptStyleSettings` / `savePromptStyleSettings` | Storage round trip |
| `promptStyleVars(settings)` | Projects settings into the `--prompt-editor-*` record |

Row shading is one three-way choice rather than two independent toggles, because
rules and zebra are alternative answers to the same question. `promptStyleVars`
maps the choice onto the two visibility multipliers.

`usePromptStyleSettings()` wraps the storage round trip in React state and
listens for `storage` events, so open tabs stay in sync.

## Host Wiring

The host owns the settings and the sidebar that edits them. The lab shell takes
a `styleSettings` prop, calls `promptStyleVars`, and applies the result as
inline custom properties on its root; when the prop is omitted it reads the
persisted settings once on mount.

The read-only prompt view takes an `inheritStyle` flag for exactly this case: a
host that already projects live variables passes `true` so rail changes apply
without a remount, instead of the view applying persisted settings locally.

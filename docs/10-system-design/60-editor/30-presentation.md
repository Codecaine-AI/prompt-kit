---
covers: The CSS variable contract shared by the editable prompt surface and the read-only prompt view, and the style settings that project it.
concepts: [presentation, css-variables, style-settings, tokens]
depends-on: [10-system-design/30-rendering-model.md]
---

# Presentation

Presentation is a set of CSS custom properties. The editable surface and the
read-only prompt view read the same tokens, so switching between them reads as
toggling editability rather than opening a different document.

---

## Viewer-Only Guarantee

Nothing in this contract touches the document. Style settings change no node,
no rendered string, and no content hash; they are not persisted with the
prompt and they are not part of a save. Row shading, guides, and line numbers
are painted with zero-layout-cost backgrounds and visibility multipliers, so
toggling them never changes row geometry either.

## Variable Contract

A host may set any `--prompt-editor-*` property on the surface element or one
of its ancestors. Every token has a literal fallback, so the components render
correctly with no host variables set at all. A stable root class marks the
scoped element, so descendants can observe style changes on it.

### Metrics

| Token | Default | Drives |
|-------|---------|--------|
| `--prompt-editor-font-family` | System mono stack | Row and editor type |
| `--prompt-editor-font-size` | `13px` | Row and editor type |
| `--prompt-editor-line-height` | `22px` | Row pitch, rule spacing, editor minimum height |
| `--prompt-editor-letter-spacing` | `0em` | Row and editor tracking |
| `--prompt-editor-indent-width` | `2ch` | Visual width of one renderer indent unit |
| `--prompt-editor-content-width` | `136ch` | Measure of the buffer column |
| `--prompt-editor-gutter-width` | `36px` (collapsed) | Gutter width; hosts widen it when line numbers are on |
| `--prompt-editor-grip-size` | `20px` | Block drag-handle glyph size |
| `--prompt-editor-item-grip-size` | `14px` | List-item drag-handle glyph size (smaller = item, larger = block) |
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

Line numbers default off: the flow renders a structured document whose address
system is node ids and targeting rings, not source lines. The "Line numbers"
toggle (and the `classic` preset) restores the numbered gutter, which then
tracks the raw view line for line. With numbers off the gutter collapses to
the width the drag affordances need.

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
independently. The semantic tokens also accept a legacy `--editor-*` fallback
layer for hosts that predate the style rail.

Indent geometry has two behavioral forms because rows measure the indent they
actually rendered, while overlays (indent guides, the drop indicator) know a
node's depth without reading its text; both resolve to the same visual width.

## Style Settings

The host-facing settings object is a flat record of metrics, toggles, and
colors, normalized on every read and write: numbers clamp, enums validate, and
missing values fall back.

| Setting concept | Behavior |
|-----------------|----------|
| Row shading | One three-way choice — `none`, `rules`, or `zebra` — because rules and zebra are alternative answers to the same question; the choice maps onto the two visibility multipliers |
| Mono font | A named font choice from a small vetted set |
| Presets | Named bundles (`dense`, `balanced`, `reading`); `balanced` is the default |
| Persistence | Settings round-trip through local storage under a versioned key; open tabs stay in sync by observing storage events |

Projecting settings yields the full `--prompt-editor-*` record, ready to apply
as inline custom properties.

## Host Wiring

The host owns the settings and the sidebar that edits them. The lab shell
takes a settings prop, projects it, and applies the result on its root; when
the prop is omitted it reads the persisted settings once on mount.

The read-only prompt view takes an inherit-style flag for exactly this case: a
host that already projects live variables passes it so rail changes apply
without a remount, instead of the view applying persisted settings locally.

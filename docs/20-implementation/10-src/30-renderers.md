---
covers: How prompt-kit implements XML-tagged Markdown rendering, including indentation, escaping, variables, and context usage rendering.
concepts: [renderer, XML, markdown, escaping]
design_refs: [10-system-design/30-rendering-model.md]
---

# Renderers

The renderer module turns `PromptDocument` objects into text. The current
renderer is XML-tagged Markdown.

---

## Files

| File | Responsibility |
|------|----------------|
| `packages/prompt-kit/src/document/render/render.ts` | Public `renderXmlMarkdown` function |
| `packages/prompt-kit/src/document/render/render-node.ts` | Node-specific rendering logic |
| `packages/prompt-kit/src/document/render/escaping.ts` | XML text and attribute escaping plus tag-name validation |
| `packages/prompt-kit/src/document/render/indentation.ts` | Indentation helpers |
| `packages/prompt-kit/src/document/render/render.test.ts` | Renderer behavior tests |

## Rendering Flow

`renderXmlMarkdown` creates a render context and renders the prompt's top-level
nodes. Each block node is dispatched by type:

- `section` renders as an XML tag around rendered children
- `paragraph` renders inline content
- `bulletList` and `orderedList` render Markdown lists
- `field` renders `label: value`
- `codeBlock` renders fenced code
- `example` renders as an `example` section
- `raw` renders as provided with indentation
- `contextUsage` renders a context usage section with `context_id`

## Variable Rendering

Variables read from the render context's `variables` map. Missing variables use
the configured behavior:

- `placeholder`: render `{{variableName}}`
- `empty`: render an empty string
- `error`: throw an error

## Test Coverage

Renderer tests currently cover nested sections and lists, variable substitution,
placeholder fallback, and context usage rendering.

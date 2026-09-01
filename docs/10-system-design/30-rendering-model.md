---
covers: How prompt-kit renders prompt documents, why XML-tagged Markdown is the default target, and how custom renderers fit the model.
concepts: [rendering, XML, markdown, variables]
depends-on: [10-system-design/10-canonical-prompt-object.md]
---

# Rendering Model

Prompt-kit separates prompt structure from rendered output. The default renderer
turns the AST into XML-tagged Markdown, which keeps the final prompt readable for
agents and inspectable for humans.

---

## Default Render Target

XML-tagged Markdown gives each major prompt section a semantic boundary:

```xml
<purpose>
    - Find and evaluate sources.
</purpose>

<workflow>
    1. Read the assignment.
    2. Search for relevant evidence.
</workflow>
```

Markdown remains useful inside tags because agents read it naturally. XML tags
make section boundaries explicit and easier to inspect in traces, viewers, and
debug output.

## Renderer Contract

`renderXmlMarkdown(prompt, options)` accepts a `PromptDocument` and produces a
string. Current options include:

| Option | Purpose |
|--------|---------|
| `indentText` | Controls indentation, defaulting to four spaces |
| `variables` | Provides values for `variable()` inline nodes |
| `missingVariable` | Controls missing variables: `placeholder`, `empty`, or `error` |

The default missing variable behavior is `placeholder`, producing
`{{variableName}}`.

## Node Rendering

Each block node type has one rendered form:

| Node | Rendered as |
|------|-------------|
| `section` | An XML tag pair around its rendered children |
| `paragraph` | Its inline content as a paragraph line |
| `bulletList` / `orderedList` | Markdown list items, nested children indented beneath their item |
| `field` | A `label: value` line |
| `codeBlock` | A fenced code block, with the language on the opening fence |
| `example` | An `<example>` tag pair, the node's title emitted as a `title="…"` attribute |
| `raw` | Its value as provided, indented to position |
| `contextUsage` | A context usage tag carrying `context_id`, wrapping its instructions |

A section's optional `title` property is never rendered; the open tag is
composed from `tag` and `attrs` only. The one consumer of a title is the
`example` node, which turns it into an attribute.

## Line Projection

Alongside the rendered string, the render module projects a document into a
line model: one record per rendered line, each carrying its source node, its
depth, and a role (open tag, close tag, content, list item, fence, gap). The
invariant is that joining the projected lines equals the rendered string
exactly — same indentation, same blank lines, same framing. This is what lets
an editing surface address rendered lines while mutating only the document;
the editor built on it is specified in
[60-editor/10-editing-model.md](60-editor/10-editing-model.md).

## Escaping

Text and attribute values are XML-escaped by the renderer. This keeps authored
content from accidentally breaking section tags. `raw` nodes are the explicit
escape hatch for already-rendered material.

## Custom Renderers

The AST is not coupled to XML-tagged Markdown. Consumers can write renderers for:

- visual prompt editors
- documentation pages
- compact diff views
- model-specific prompt formats
- diagnostics and lint output

Custom renderers should read the same `PromptDocument` source instead of parsing
the default rendered string.


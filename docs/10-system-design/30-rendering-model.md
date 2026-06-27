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


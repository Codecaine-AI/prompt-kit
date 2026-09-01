---
covers: How prompt documents are authored as plain data, in JSON, and through the editor, including archetypes, sections, variables, and context usage nodes.
concepts: [authoring, definePrompt, JSON, archetypes, sections, variables]
depends-on: [10-system-design/10-canonical-prompt-object.md]
---

# Authoring Model

A prompt is authored as data. There is no builder DSL between the author and
the document: a `PromptDocument` is a plain object tree, and every authoring
surface — TypeScript source, JSON files, the interactive editor — produces the
same canonical shape.

---

## Three Authoring Surfaces

| Surface | How it produces a document |
|---------|----------------------------|
| TypeScript | Node object literals, typed by the node model, assembled with `definePrompt` |
| JSON | A serialized `PromptDocument`, checked against the published document schema |
| Editor | The prompt editing surface, which commits structural steps against the same document |

All three converge on one object. Nothing about a document records which
surface authored it, so a prompt written by hand can be opened in the editor,
and an editor-authored prompt can be reviewed as JSON.

## Documents As Plain Data

`definePrompt(input)` is the document constructor. It fills in the envelope —
`kind: "prompt"` and the current `schemaVersion` — and applies defaults, so
authors supply only the identity and body:

```ts
import { definePrompt } from "@codecaine-ai/prompt-kit";

const prompt = definePrompt({
  id: "researchPrompt",
  archetype: "workflow",
  nodes: [
    {
      type: "section",
      tag: "purpose",
      children: [
        { type: "paragraph", content: ["Research the request."] },
      ],
    },
  ],
});
```

Nodes are object literals. `createNode(node)` is an identity helper that
type-checks a single node literal in place, which keeps large documents
readable without wrapping every node in a constructor call:

```ts
import { createNode } from "@codecaine-ai/prompt-kit";

const rules = createNode({
  type: "section",
  tag: "rules",
  id: "sourceRules",
  children: [
    {
      type: "bulletList",
      items: [{ type: "listItem", content: ["Prefer primary sources."] }],
    },
  ],
});
```

Because documents are plain data, composition is ordinary programming:
spread shared node arrays, map over configuration, or apply the id-targeted
transforms described in
[40-composition-and-transforms.md](40-composition-and-transforms.md).

## The JSON Form

A `PromptDocument` serializes directly to JSON, and hosts persist prompts as
JSON documents alongside their agent definitions. Two validation layers keep
that form trustworthy:

- A published JSON Schema (draft 2020-12) describes `PromptDocument` and every
  node type, for registries, save endpoints, and external tooling.
- `validatePromptDocumentShape(value)` performs the same structural check in
  TypeScript against an untrusted value, returning `{ valid, errors }` with a
  path-qualified message per problem, so callers do not need a JSON Schema
  runtime.

Shape validation answers "is this a `PromptDocument` at all". Semantic
diagnostics — duplicate ids, invalid tags, undeclared variables — belong to
the validation contract described in
[50-validation-contract.md](50-validation-contract.md).

## The Editor

The prompt editor is the interactive authoring surface. It presents the
document as editable XML-tagged Markdown, commits every gesture as a
structural step, and never treats the rendered text as a source of truth. Its
behavior is specified in [60-editor/00-overview.md](60-editor/00-overview.md).

## Archetypes

`archetype` is document metadata describing broad intent. `"singleOutput"`
marks a bounded-completion prompt and `"workflow"` marks a multi-step or
process prompt, but the type is deliberately open — any string is valid — so
new prompt families do not require a schema change. Tooling may use the
archetype to pick defaults or grouping; nothing in rendering or validation
depends on it.

## Sections

Sections are the main structural unit because rendered prompts are read
linearly. A section has a `tag`, optional attributes, and child block nodes.

Common tags include:

- `purpose`
- `rules`
- `key_knowledge`
- `goal`
- `background`
- `workflow`
- `tool_policy`
- `state_protocol`
- `output_format`
- `success_criteria`
- `reminders`

These names are conventions, not the only allowed tags. Validation only
requires section tags to be valid XML names. The model-facing conventions for
choosing and ordering sections live in
[70-prompt-structure/00-overview.md](70-prompt-structure/00-overview.md).

## Variables

Variables are inline reference nodes with an optional inline fallback:

```ts
{
  type: "paragraph",
  content: [
    "Current request: ",
    { type: "variable", name: "userPrompt" },
  ],
}
```

Variable declarations usually live in the host system. Prompt-kit validation
can check references against declarations when the host provides them, and the
renderer substitutes values at render time (see
[30-rendering-model.md](30-rendering-model.md)).

Generic `reference` nodes are the parallel inline form for non-variable
placeholders such as tools; they carry a `kind` and a `name` and render as
placeholders for consumers that resolve them later.

## Context Usage

A `contextUsage` node is a prompt-side note that a named runtime context
packet is expected:

```ts
{
  type: "contextUsage",
  contextId: "researchMemory",
  instructions: [
    { type: "paragraph", content: ["Use loaded notes as evidence."] },
  ],
}
```

This does not load context. It documents prompt behavior and renders a
structured context usage tag. The host runtime still owns context loaders and
failure handling.

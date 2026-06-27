---
covers: The canonical prompt object model used by prompt-kit, including PromptDocument, block nodes, inline nodes, metadata, and stable ids.
concepts: [PromptDocument, nodes, schema, ids]
depends-on: [00-foundation/20-authoring-principles.md]
---

# Canonical Prompt Object

The canonical prompt object is a `PromptDocument`. It is the source of truth for
prompt authoring and the input to renderers, validators, transforms, and preview
models.

---

## Document Shape

Every prompt document has a schema version and an id:

```ts
interface PromptDocument {
  kind: "prompt";
  schemaVersion: "prompt-kit/v1";
  id: string;
  title?: string;
  description?: string;
  archetype?: "singleOutput" | "workflow" | (string & {});
  nodes: PromptBlockNode[];
  metadata?: Record<string, unknown>;
}
```

The document is intentionally generic. `archetype` helps templates and tooling
understand broad intent, while `nodes` carries the real prompt body.

## Block Nodes

Prompt-kit uses a compact block vocabulary:

| Node | Purpose |
|------|---------|
| `section` | Semantic XML-rendered grouping such as `purpose`, `rules`, or `workflow` |
| `paragraph` | Inline text rendered as a paragraph line |
| `bulletList` | Unordered list with optional child blocks on each item |
| `orderedList` | Numbered list with optional child blocks on each item |
| `field` | Label/value pair, optionally with child detail |
| `codeBlock` | Fenced code or format examples |
| `example` | Example section with optional title |
| `raw` | Escape hatch for already-rendered text |
| `contextUsage` | Prompt-side instruction that names a runtime context packet |

This set covers common prompt structure without forcing a fixed document layout.

## Inline Nodes

Inline content can be strings, variable references, or generic references:

```ts
type PromptInline = string | VariableReferenceNode | ReferenceNode;
```

Variables render from a provided variable map, use a fallback when present, or
fall back to `{{variableName}}` placeholders depending on renderer options.
References render as placeholders such as `{{tool:search}}` for consumers that
want to resolve them later.

## Stable Ids

Every node can carry an optional `id`. Ids are not required for simple prompts,
but they become important when a host wants to compose a prompt by replacing,
omitting, or inserting a particular section.

Good ids are stable and semantic:

```ts
section("rules", ["Prefer primary sources."], { id: "sourceRules" });
```

Avoid ids based on position or phrasing. A node id should survive copy edits.

## Metadata

Documents and nodes can carry arbitrary metadata. Metadata is for tooling,
editor state, provenance, tags, or package-specific conventions. Core renderers
ignore metadata unless a renderer explicitly chooses to use it.


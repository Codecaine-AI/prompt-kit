---
covers: How prompt-kit implements canonical nodes and builder helpers for constructing prompt documents.
concepts: [nodes, builders, PromptDocument, helpers]
design_refs: [10-system-design/10-canonical-prompt-object.md, 10-system-design/20-authoring-model.md]
---

# Nodes And Builders

Nodes define the canonical AST. Builders provided the practical authoring API
that created those nodes from readable TypeScript; the builder module
(`src/builders/`) was removed 2026-08-05 — it had no production consumers and
is recoverable from git history. The sections below describing builders are
kept as a historical reference.

---

## Node Files

| File | Responsibility |
|------|----------------|
| `packages/prompt-kit/src/document/nodes/types.ts` | Schema version, `PromptDocument`, block nodes, inline nodes, and node unions |
| `packages/prompt-kit/src/document/nodes/create-node.ts` | `definePrompt` and generic `createNode` helpers |
| `packages/prompt-kit/src/document/nodes/guards.ts` | Runtime guards for prompt documents, block nodes, list items, and variables |
| `packages/prompt-kit/src/document/nodes/index.ts` | Node module barrel export |

`definePrompt` sets `kind: "prompt"` and defaults `schemaVersion` to
`prompt-kit/v1`.

## Builder Files

| File | Builders |
|------|----------|
| `packages/prompt-kit/src/builders/section.ts` | `section` |
| `packages/prompt-kit/src/builders/lists.ts` | `item`, `bulletList`, `orderedList` |
| `packages/prompt-kit/src/builders/text.ts` | `inline`, `paragraph`, `variable`, `reference` |
| `packages/prompt-kit/src/builders/fields.ts` | `field` |
| `packages/prompt-kit/src/builders/examples.ts` | `example` |
| `packages/prompt-kit/src/builders/code.ts` | `codeBlock`, `raw` |
| `packages/prompt-kit/src/builders/context.ts` | `usesContext` |
| `packages/prompt-kit/src/builders/normalize.ts` | string-to-node normalization helpers |

## Normalization Pattern

The builder layer accepts simple strings where useful. A string passed as a
block becomes a paragraph. A string passed to `bulletList` or `orderedList`
becomes a list item. This keeps prompt source concise while preserving a
complete AST after construction.

## Extension Pattern

New node types should be added only when the existing block vocabulary cannot
represent a common prompt structure. New builders are lower risk because they
can return existing nodes while improving authoring ergonomics.

---
covers: How prompt-kit implements prompt tree traversal and immutable transforms for finding, inserting, replacing, and omitting nodes by id.
concepts: [transforms, traversal, immutable, ids]
design_refs: [10-system-design/40-composition-and-transforms.md]
---

# Transforms

Transforms manipulate prompt documents through AST traversal. They preserve the
document shape and avoid string-based prompt rewriting.

---

## Files

| File | Responsibility |
|------|----------------|
| `packages/prompt-kit/src/transforms/visit.ts` | Tree traversal and `VisitEntry` paths |
| `packages/prompt-kit/src/transforms/find.ts` | `findNodeById`, `findNodes`, `findSectionsByTag` |
| `packages/prompt-kit/src/transforms/insert.ts` | `insertBeforeId`, `insertAfterId` |
| `packages/prompt-kit/src/transforms/replace.ts` | `replaceNodeById` |
| `packages/prompt-kit/src/transforms/omit.ts` | `omitNodeById` |
| `packages/prompt-kit/src/transforms/tree-utils.ts` | Recursive block mapping helpers |
| `packages/prompt-kit/src/transforms/transforms.test.ts` | Transform behavior tests |

## Traversal

`visitPrompt` visits the prompt document, block nodes, list items, and inline
variable/reference nodes. Each visit includes the node, optional parent, and path
from the prompt root.

## Immutable Mapping

Insert, replace, and omit transforms return new prompt documents. The recursive
mapper rebuilds only the affected block tree shape and preserves unrelated
nodes.

## Current Scope

Transforms target block nodes by id. Inline transforms can be built on top of
`visitPrompt` when consumers need them, but the core package currently focuses
on section and block composition because that is the primary prompt substitution
surface.

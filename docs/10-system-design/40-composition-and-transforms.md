---
covers: How prompt-kit supports prompt composition through stable ids, traversal, find, insert, replace, and omit transforms.
concepts: [composition, transforms, ids, traversal]
depends-on: [10-system-design/10-canonical-prompt-object.md]
---

# Composition And Transforms

Prompt-kit composition happens on the AST. Stable ids let callers replace or
insert prompt sections without parsing rendered Markdown.

---

## Stable Id Composition

A shared prompt can expose intentional replacement points:

```ts
const base = workflowPrompt({
  id: "researchPrompt",
  sections: [
    section("purpose", ["Research the request."], { id: "purpose" }),
    section("workflow", ["Gather evidence."], { id: "workflow" }),
  ],
});
```

A consumer can then replace one part:

```ts
const specialized = replaceNodeById(
  base,
  "workflow",
  section("workflow", ["Gather local repository evidence."], { id: "workflow" }),
);
```

The rendered prompt changes, but the source remains a valid prompt document.

## Transform Surface

Prompt-kit currently provides:

| Function | Purpose |
|----------|---------|
| `findNodeById` | Return one matching node and its path |
| `findNodes` | Collect nodes matching a predicate |
| `findSectionsByTag` | Collect sections with a tag |
| `insertBeforeId` | Insert block nodes before a matching block id |
| `insertAfterId` | Insert block nodes after a matching block id |
| `replaceNodeById` | Replace a matching block node with one or more nodes |
| `omitNodeById` | Remove a matching block node |
| `visitPrompt` | Traverse documents, blocks, list items, and inline nodes |

Transforms return new prompt documents and preserve the rest of the tree.

## Why Not String Replacement

Rendered prompts are output artifacts. String replacement against rendered text
is brittle because formatting, indentation, escaping, and phrasing can shift.
AST transforms target semantic nodes and survive normal prompt edits.


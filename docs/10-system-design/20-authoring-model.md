---
covers: How prompt authors use builders, templates, archetypes, sections, variables, and context usage nodes to create prompt documents.
concepts: [builders, templates, archetypes, variables]
depends-on: [10-system-design/10-canonical-prompt-object.md]
---

# Authoring Model

Prompt-kit authors write TypeScript prompt documents with builders. Builders keep
the authoring surface readable while producing the canonical AST.

---

## Builders

Builders convert plain authoring inputs into nodes:

```ts
import {
  bulletList,
  field,
  item,
  orderedList,
  paragraph,
  section,
  variable,
  workflowPrompt,
} from "@codecaine-ai/prompt-kit";
```

Most block builders accept either already-built nodes or strings. Strings become
paragraph nodes or list items depending on the builder.

## Templates

Templates provide common document skeletons:

| Template | Archetype | Purpose |
|----------|-----------|---------|
| `singleOutputPrompt` | `singleOutput` | Bounded completion prompts with purpose, instructions, and output format |
| `workflowPrompt` | `workflow` | Multi-step or process prompts with purpose, rules, workflow, and output format |
| `agentPrompt` | `workflow` | Convenience workflow template with a `reminders` section |

Templates are convenience functions. They are not a closed taxonomy. A consumer
can call `definePrompt` directly or build custom templates around the same node
types.

## Sections

Sections are the main structural unit because rendered prompts are read
linearly. A section has a `tag`, optional attributes, optional title metadata,
and child block nodes.

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

These names are conventions, not the only allowed tags. Validation only requires
section tags to be valid XML names.

## Variables

Variables are inline references:

```ts
paragraph(["Current request: ", variable("userPrompt")]);
```

Variable declarations usually live in the host system. Prompt-kit validation can
check references against declarations when the host provides them.

## Context Usage

`usesContext` creates a prompt-side note that a named runtime context packet is
expected:

```ts
usesContext("researchMemory", {
  instructions: ["Use loaded notes as evidence."],
});
```

This does not load context. It documents prompt behavior and renders a structured
context usage tag. The host runtime still owns context loaders and failure
handling.


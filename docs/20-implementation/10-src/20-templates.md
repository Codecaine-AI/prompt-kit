---
covers: How prompt-kit implements reusable prompt templates for single-output prompts, workflow prompts, and agent-oriented workflow prompts.
concepts: [templates, singleOutput, workflow, agentPrompt]
design_refs: [10-system-design/20-authoring-model.md]
---

# Templates

Templates are small functions that assemble common prompt section layouts from
the canonical node builders. They are convenience helpers, not a closed prompt
taxonomy.

---

## Files

| File | Responsibility |
|------|----------------|
| `src/templates/task.ts` | `singleOutputPrompt` and `taskSection` |
| `src/templates/workflow.ts` | `workflowPrompt` |
| `src/templates/agent.ts` | `agentPrompt` |
| `src/templates/index.ts` | Template barrel export |

## `singleOutputPrompt`

`singleOutputPrompt` creates a prompt with optional `purpose`, `instructions`,
`output_format`, and additional sections. It sets `archetype` to
`singleOutput`.

## `workflowPrompt`

`workflowPrompt` creates a prompt with optional `purpose`, `rules`, `workflow`,
`output_format`, and additional sections. It sets `archetype` to `workflow`.

## `agentPrompt`

`agentPrompt` is a thin workflow template that appends an optional `reminders`
section. It uses the workflow archetype because prompt-kit does not model agent
runtime behavior directly.

## Adding Templates

Prefer a template when several prompts share the same section skeleton. Prefer
plain builders when only one prompt needs the shape. Templates should stay broad
enough to be reused outside one host application.


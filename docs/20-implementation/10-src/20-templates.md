---
covers: How prompt-kit implements reusable prompt templates for single-output prompts, workflow prompts, and agent-oriented workflow prompts.
concepts: [templates, singleOutput, workflow, agentPrompt]
design_refs: [10-system-design/20-authoring-model.md]
---

# Templates

Templates were small functions that assembled common prompt section layouts
from the canonical node builders. The template module (`src/templates/`) was
removed 2026-08-05 along with the builders — it had no production consumers and
is recoverable from git history. The sections below are kept as a historical
reference.

---

## Files

| File | Responsibility |
|------|----------------|
| `packages/prompt-kit/src/templates/task.ts` | `singleOutputPrompt` and `taskSection` |
| `packages/prompt-kit/src/templates/workflow.ts` | `workflowPrompt` |
| `packages/prompt-kit/src/templates/agent.ts` | `agentPrompt` |
| `packages/prompt-kit/src/templates/index.ts` | Template barrel export |

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

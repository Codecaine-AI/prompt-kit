# Agent Prompt Section Guide
> Distilled from docs/30-prompt-structure/10-agent-prompt.md — keep in sync.
Use this block when creating or reviewing the section layout of an agent system prompt.

## Canonical order

Use these sections in this order:

1. `<purpose>`
2. `<goal>`
3. `<state_structure>`
4. `<workflow>`
5. `<error_handling>`
6. `<success_criteria>`
7. `<rules>`

## 1. Purpose

- State what the agent does in one to three concrete sentences.
- Describe standing behavior.
- Exclude personas, backstory, current assignments, live state, and reference material.

## 2. Goal

- Name the end state the workflow must reach.
- Include only when the end state adds information beyond `purpose`.
- Exclude restatements of `purpose` and quality checks.

## 3. State structure

- Declare each live state field and its meaning.
- Use field names that expose workflow navigation conditions.
- Include state fields only.
- Exclude current values, context inventories, reference blocks, tools, and schemas.

## 4. Workflow

- Define named phases with objectives and numbered steps.
- Select, repeat, and exit phases by inspecting declared state fields.
- Keep situational instructions in the phase where they apply.
- Exclude turn-count navigation and process-wide invariants.

## 5. Error handling

- Include only for known failures that require a specific response.
- Name each failure condition and its recovery, retry, preservation, or escalation action.
- Exclude generic advice and tool schema details.

## 6. Success criteria

- Include only when completion needs a testable quality bar.
- State checks the agent can verify before finishing.
- Exclude vague quality language, goal restatements, and checks already fixed by the workflow or output contract.

## 7. Rules

- Place `rules` last to preserve recency.
- Keep at most 7 process-wide non-negotiables.
- Use direct, absolute language for absolute requirements.
- Exclude situational guidance, phase-local branches, duplicated instructions, and reminders.

## Section constraints

- Omit optional sections that add no distinct instruction.
- Do not add a `<tools>` section.
- Do not add a context inventory.
- Do not add a `<reminders>` section.

# Single-Output Prompt Section Guide
> Distilled from docs/30-prompt-structure/30-single-output.md — keep in sync.
Use this block when creating or reviewing a prompt that transforms bounded input into one defined output.

## Canonical order

Use these sections in this order:

1. `<purpose>`
2. `<instructions>`
3. `<workflow>` when earned
4. `<output_format>`
5. `<constraints>`

Omit optional sections that do not change the result.

## 1. Purpose

- State what to produce in one or two imperative sentences.
- Make success measurable from the output.
- Treat the task as the role.
- Exclude personas, backstory, runtime input, and procedure.

## 2. Instructions

- Supply the input through an explicit runtime boundary.
- Explain how to handle the input.
- Resolve judgment calls and priority conflicts that affect the transformation.
- Use a `PromptDocument` variable or another explicit boundary for runtime data.
- Exclude persona language, live input pasted into standing prose, output scaffolding, and hard limits.

## 3. Workflow

- Include only when internal staging fixes an observed failure mode.
- Name the stages required before producing the single visible output.
- Keep all stages within one call and carry no live process state between calls.
- Exclude staging added only for complexity, agent-style state navigation, and turn-based procedure.

## 4. Output format

- Provide a literal skeleton the model can copy.
- Expose every required field and fixed structural element.
- Use the required JSON, XML, table, or Markdown shape directly.
- Keep placeholders descriptive and input-free.
- Exclude live runtime data and indirect prose descriptions of the response shape.

```markdown
## Summary
[Two sentences]

## Findings
1. [Finding supported by the input]
2. [Finding supported by the input]
```

## 5. Constraints

- Place `constraints` last.
- Include only hard, concrete, testable requirements.
- State length, tone, must-include items, forbidden content, and conflict priority when required.
- Exclude duplicated instructions and requirements already guaranteed by the output skeleton.

## Context boundary

- Do not add an `<examples>` prompt section.
- Supply needed examples as self-describing context blocks.
- State what each example demonstrates and when to consult it.
- Skip examples when the literal output skeleton is sufficient.

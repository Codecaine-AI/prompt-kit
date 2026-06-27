---
covers: Why prompt-kit exists as a standalone prompt AST package and what responsibilities stay outside it.
concepts: [prompt-kit, package-boundary, runtime, AST]
---

# Purpose And Boundary

Prompt-kit is a small package for writing prompts as typed, composable prompt
documents. It is not an agent runtime, a kernel, or a tool registry.

---

## Problem

Agent prompts need to be both human-readable and machine-manipulable. A plain
Markdown prompt is easy to read, but hard to validate, transform, substitute, or
preview consistently. A rigid schema is easy to validate, but can become too
constraining for real prompt-writing work.

Prompt-kit sits between those poles. Authors write a structured TypeScript
object with builders such as `workflowPrompt`, `section`, `bulletList`, and
`variable`. Consumers can render that object into XML-tagged Markdown, inspect
the tree, replace sections, validate identifiers, and build UI preview models.

## Package Boundary

Prompt-kit owns generic prompt structure:

- canonical prompt document and node types
- ergonomic builders for sections, lists, fields, examples, variables, and raw text
- broad prompt templates such as `singleOutputPrompt` and `workflowPrompt`
- renderers, starting with XML-tagged Markdown
- transforms keyed by stable node ids
- validation diagnostics for prompt tree integrity
- lightweight UI models for prompt preview and editing surfaces

Prompt-kit does not own runtime behavior:

- agent registry discovery
- model selection or turn limits
- dynamic context loading
- conversation history
- Pi SDK session creation
- shared or private tool registration
- trace emission
- subagent orchestration
- application memory layout

Those concerns belong to a kernel or host application. A kernel can import
prompt-kit, render prompt documents, and wire them into its own runtime packet.
Prompt-kit remains reusable because it does not know which runtime consumes the
rendered prompt.

## Source Of Truth

The canonical source is the `PromptDocument` object. Rendered Markdown is an
output artifact, not the authored source.

This matters for authoring tools. A prompt viewer can display the rendered text,
but editing should generally happen through the structured prompt source or a UI
that edits the structured prompt object. Hand-editing the rendered text creates a
second source of truth and breaks transforms, validation, and stable ids.


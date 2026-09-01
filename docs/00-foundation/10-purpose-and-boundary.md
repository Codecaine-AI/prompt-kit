---
covers: Why prompt-kit exists as a standalone prompt document library and what responsibilities stay outside it.
concepts: [prompt-kit, package-boundary, runtime, AST]
---

# Purpose And Boundary

Prompt-kit is a library for writing prompts as typed, composable prompt
documents. It is not an agent runtime, a kernel, or a tool registry. The
library lives in `packages/prompt-kit`; the agent host that consumes it lives
in `packages/prompt-kit-agent`.

---

## Problem

Agent prompts need to be both human-readable and machine-manipulable. A plain
Markdown prompt is easy to read, but hard to validate, transform, substitute, or
preview consistently. A rigid schema is easy to validate, but can become too
constraining for real prompt-writing work.

Prompt-kit sits between those poles. Prompts are authored as structured
documents — in code, as JSON documents, or through the editor UI — and
consumers can render them to linear text, inspect the tree, replace pieces,
validate integrity, and drive editing surfaces from the same object. The
mechanics of that object and its operations live in
[System Design](../10-system-design/00-overview.md).

## Package Boundary

Prompt-kit owns generic prompt structure: the canonical prompt document, its
node vocabulary, rendering to model-facing text, transformation and
composition, validation, and the UI for viewing and editing prompt documents.

Prompt-kit does not own runtime behavior:

- agent registry discovery, model selection, or turn limits
- dynamic context loading and conversation history
- session creation and tool registration
- trace emission and subagent orchestration
- application memory layout

Those concerns belong to a kernel or host application. A kernel imports
prompt-kit, renders prompt documents, and wires them into its own runtime
packet. Prompt-kit remains reusable because it does not know which runtime
consumes the rendered prompt. The agent host in `packages/prompt-kit-agent` is
one such consumer, and the seam between the two is specified in
[80-kernel-boundary.md](../10-system-design/80-kernel-boundary.md).

## Source Of Truth

The canonical source is the structured prompt document. Rendered text is an
output artifact, not the authored source.

This matters for authoring tools. A prompt viewer can display the rendered
text, but editing must commit to the structured document. Hand-editing the
rendered text creates a second source of truth and breaks transforms,
validation, and stable ids. The editor follows this rule by presenting the
rendered output as an editable projection while committing every gesture to the
structured document; its design lives in
[60-editor/](../10-system-design/60-editor/).

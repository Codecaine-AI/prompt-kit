---
covers: How agent kernels consume prompt-kit documents while retaining ownership of runtime context, tools, registry behavior, traces, and Pi integration.
concepts: [kernel, integration, context, tools]
depends-on: [00-foundation/10-purpose-and-boundary.md, 10-system-design/30-rendering-model.md]
---

# Kernel Boundary

Prompt-kit is a prompt authoring and rendering layer. A kernel consumes its
prompt documents as one part of a larger runtime packet.

---

## Host Registry Flow

A host keeps a `PromptDocument` as the source of truth for each agent's system
prompt. The host registry imports that document, validates it with host
declarations (declared variables, host-specific checks), renders it, and
passes the rendered system prompt to the runtime. The document — not the
rendered string — is what the host stores, diffs, and edits.

## Runtime Packet Split

The broader runtime packet usually has several parts:

- stable system prompt rendered from `PromptDocument`
- dynamic context assembled by the kernel or app
- conversation history and current user turn
- tool definitions and tool policies
- model and turn configuration
- trace/session metadata

Prompt-kit only owns the first part. It can include prompt-side instructions
about context or tools, but the executable runtime systems live outside it.

## Tool Boundary

Prompt-kit should not register tools. A prompt can include a `tool_policy`
section or a reference placeholder, but the host decides which shared tools,
private tools, or Pi-compatible registrations are available.

This keeps prompt text aligned with runtime behavior without coupling the prompt
AST package to one SDK.

## Viewer Boundary

Viewer systems can import prompt-kit UI helpers such as
`createPromptEditorModel`, a headless model that returns the prompt with
stable ids, its flattened tree, rendered output, and validation result. The
React-facing surfaces — the editing surface, the lab shell, the style
settings, and the read-only prompt view — sit behind dedicated UI entry
points; their behavior is specified in
[60-editor/00-overview.md](60-editor/00-overview.md). None of this defines a
full UI framework or host app shell.

The kernel viewer can render:

- authored prompt AST preview
- rendered system prompt for a specific run
- resolved variables
- runtime context preview
- tool configuration from the host registry

Prompt-kit provides the prompt-specific pieces only.


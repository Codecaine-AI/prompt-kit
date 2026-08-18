---
covers: How agent kernels consume prompt-kit documents while retaining ownership of runtime context, tools, registry behavior, traces, and Pi integration.
concepts: [kernel, integration, context, tools]
depends-on: [00-foundation/10-purpose-and-boundary.md, 10-system-design/30-rendering-model.md]
---

# Kernel Boundary

Prompt-kit is a prompt authoring and rendering layer. A kernel consumes its
prompt documents as one part of a larger runtime packet.

---

## Host Agent Shape

A kernel or host app can organize an agent bundle like this:

```text
agent-catalog/<agent-name>/
  agent.ts              # runtime manifest and registry entry point
  prompt.ts             # PromptDocument source of truth
  context.ts            # optional dynamic context resolver
  tools.ts              # optional private tools
  fixtures/             # optional rendered-context fixtures and snapshots
```

In that layout, `prompt.ts` exports a prompt-kit document. The registry imports
it, validates it with host declarations, renders it, and passes the rendered
system prompt into the runtime.

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
`createPromptEditorModel`. Those helpers produce simple serializable models.
(The earlier `createPromptPreviewModel` helper was removed 2026-08-05; it is
recoverable from git history.)
They do not define a full UI framework, styling system, or app shell.

The kernel viewer can render:

- authored prompt AST preview
- rendered system prompt for a specific run
- resolved variables
- runtime context preview
- tool configuration from the host registry

Prompt-kit provides the prompt-specific pieces only.


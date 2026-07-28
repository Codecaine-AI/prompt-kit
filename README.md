# @codecaine-ai/prompt-kit

Prompt-kit is the prompt authoring package for Codecaine agents. It turns typed
prompt objects into readable prompt text while keeping the source structured
enough to validate, transform, preview, and compose — and it ships the UI an
author edits them through.

It provides:

- a canonical prompt AST
- TypeScript builders
- XML-tagged Markdown rendering
- prompt transforms
- validation diagnostics
- headless UI models (tree, selection, undoable steps)
- the React authoring surface: the XML editor, node inspector, prompt lab
  shell, style model, and read-only prompt view

The Agent Kernel consumes prompt-kit, but prompt-kit does not depend on the kernel.

## Entry points

| Import | Contents |
| --- | --- |
| `@codecaine-ai/prompt-kit` | AST, builders, renderers, transforms, validation |
| `@codecaine-ai/prompt-kit/ui` | Headless UI models — no React, no DOM |
| `@codecaine-ai/prompt-kit/ui/react` | Every React export below, in one import |
| `@codecaine-ai/prompt-kit/ui/prompt-flow` | `PromptFlowXml`, `PromptFlowInspector` |
| `@codecaine-ai/prompt-kit/ui/lab` | `PromptInlineLab`, `PromptStyleRail`, undo history |
| `@codecaine-ai/prompt-kit/ui/style` | Persisted style settings + `usePromptStyleSettings` |
| `@codecaine-ai/prompt-kit/ui/surface` | Editor metrics, palette, XML highlighting |
| `@codecaine-ai/prompt-kit/ui/view` | `PromptView` — read-only prompt rendering |

React is a peer dependency, and the components are unstyled beyond Tailwind
utility classes: the host app supplies the Tailwind layer and the semantic
token variables they resolve against. See the styling contract at the top of
`src/ui/react.ts`.

The editor UI's architecture is documented in
`docs/20-implementation/20-editor/`. `EDITOR-UI-HANDOFF.md` carries the working
state — what was built, known bugs, pending decisions, and the traps worth
knowing before touching it.

## Quick Start

```ts
import {
  bulletList,
  item,
  orderedList,
  paragraph,
  renderXmlMarkdown,
  section,
  variable,
  workflowPrompt,
} from "@codecaine-ai/prompt-kit";

export const prompt = workflowPrompt({
  id: "sourceScoutPrompt",
  title: "Source Scout",
  purpose: [
    bulletList(["Find and evaluate sources for a focused research assignment."]),
  ],
  workflow: [
    orderedList([
      item("Read the assignment.", [
        section("input", [paragraph(["Focus: ", variable("focus")])]),
      ]),
      "Search for relevant evidence.",
      "Write source notes with uncertainty called out.",
    ]),
  ],
});

const rendered = renderXmlMarkdown(prompt, {
  variables: { focus: "Agent kernel prompt system" },
});
```

Rendered output uses Markdown inside semantic XML tags:

```xml
<purpose>
    - Find and evaluate sources for a focused research assignment.
</purpose>

<workflow>
    1. Read the assignment.
        <input>
            Focus: Agent kernel prompt system
        </input>
    2. Search for relevant evidence.
    3. Write source notes with uncertainty called out.
</workflow>
```

## Documentation

Prompt-kit carries its own docs because it is a separate package and repository
boundary.

- [Documentation overview](docs/00-overview.md) is the package docs entry point.
- [Foundation](docs/00-foundation/00-overview.md) explains why prompt-kit exists
  and what boundaries it keeps.
- [System Design](docs/10-system-design/00-overview.md) explains the AST,
  authoring model, rendering model, transforms, validation, and kernel boundary.
- [Implementation](docs/20-implementation/00-overview.md) maps the current source
  tree and public API surfaces.

## Package Boundary

Prompt-kit owns generic prompt structure and rendering. It does not own agent
runtime behavior, context loading, tool registration, traces, model settings, Pi
SDK integration, or subagent orchestration. Those are kernel responsibilities.

The intended split is:

- `@codecaine-ai/prompt-kit`: structured prompts, builders, renderers,
  transforms, validation, editor models, and the authoring UI.
- Agent Kernel: agent definitions, runtime context, tool binding, Pi sessions,
  traces, and viewer integration.

## Development

From this repository's root:

```bash
bun install
bun run typecheck
bun test src
```

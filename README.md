# @codecaine-ai/prompt-kit

Prompt-kit is the headless prompt authoring package for Codecaine agents. It
turns typed prompt objects into readable prompt text while keeping the source
structured enough to validate, transform, preview, and compose.

It provides:

- a canonical prompt AST
- TypeScript builders
- XML-tagged Markdown rendering
- prompt transforms
- validation diagnostics
- lightweight UI preview models

The Agent Kernel consumes prompt-kit, but prompt-kit does not depend on the kernel.

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
  transforms, validation, and preview/editor models.
- Agent Kernel: agent definitions, runtime context, tool binding, Pi sessions,
  traces, and viewer integration.

## Development

From the workspace root:

```bash
bun run typecheck:prompt-kit
bun test ./packages/prompt-kit/src
```

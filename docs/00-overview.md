---
covers: The documentation entry point for the prompt-kit workspace and its Foundation, System Design, and Implementation layers.
type: overview
concepts: [documentation, prompt-kit, navigation]
---

# Prompt-Kit Documentation

Prompt-kit documentation is organized in three layers: Foundation for intent,
System Design for behavior, schemas, and state models, and Implementation for
the structural decisions that shape the current code. The repository is a bun
workspace containing `packages/prompt-kit` (the headless prompt AST and React
UI library) and `packages/prompt-kit-agent` (the kernel/agent host with its
prompt catalog). Start here when reading the workspace as a standalone
repository.

---

## File Tree

```text
docs/
├── 00-overview.md          (this file) Documentation entry point
├── 00-foundation/          Purpose, boundaries, and authoring principles
├── 10-system-design/       Prompt object, authoring, rendering, transforms,
│                           validation, editor, prompt structure, kernel boundary
└── 20-implementation/      Structural decisions about the current packages
```

## Layers

### [00-foundation/00-overview.md](00-foundation/00-overview.md)

Read this layer to understand why prompt-kit exists, what it owns, what it
intentionally avoids, and the principles behind authoring prompts as structured
documents. Intent and rationale only — no mechanics.

### [10-system-design/00-overview.md](10-system-design/00-overview.md)

Read this layer to understand how the system behaves: the canonical prompt
object, the authoring model, the rendering model, composition and transforms,
the validation contract, the editor design
([10-system-design/60-editor/](10-system-design/60-editor/)), the model-facing
prompt-structure conventions
([10-system-design/70-prompt-structure/](10-system-design/70-prompt-structure/)),
and the kernel integration boundary
([10-system-design/80-kernel-boundary.md](10-system-design/80-kernel-boundary.md)).

### [20-implementation/00-overview.md](20-implementation/00-overview.md)

Read this layer when changing source code. It records the structural decisions
governing how the packages are organized and why — the shape additions must
conform to — for `packages/prompt-kit`
([20-implementation/10-prompt-kit/00-overview.md](20-implementation/10-prompt-kit/00-overview.md),
split into the document layer and the UI layer) and `packages/prompt-kit-agent`
([20-implementation/20-prompt-kit-agent.md](20-implementation/20-prompt-kit-agent.md)).
It is not a map of the current source tree.

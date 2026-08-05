---
covers: The documentation entry point for prompt-kit and its Foundation, System Design, Implementation, and Prompt Structure layers.
type: overview
concepts: [documentation, prompt-kit, navigation]
---

# Prompt-Kit Documentation

Prompt-kit documentation is organized in four layers: Foundation for intent,
System Design for package behavior, Implementation for current TypeScript source
structure, and Prompt Structure for model-facing authoring conventions. Start
here when reading the package as a standalone repository.

---

## File Tree

```text
docs/
├── 00-overview.md          (this file) Documentation entry point
├── 00-foundation/          Purpose, boundaries, and authoring principles
├── 10-system-design/       AST, rendering, transforms, validation, and kernel boundary
├── 20-implementation/      Current source tree, editing UI, and development notes
└── 30-prompt-structure/    Placement, prompt shapes, workflow, quality, and techniques
```

## Layers

### [00-foundation/00-overview.md](00-foundation/00-overview.md)

Read this layer to understand why prompt-kit exists, what it owns, what it
intentionally avoids, and how prompt documents should be authored.

### [10-system-design/00-overview.md](10-system-design/00-overview.md)

Read this layer to understand the canonical prompt object, authoring model,
renderer boundary, transform model, validation contract, and kernel integration
boundary.

### [20-implementation/00-overview.md](20-implementation/00-overview.md)

Read this layer when changing source code. It maps the current package modules,
public exports, tests, and development commands, and documents the prompt-editing
UI architecture built on top of them.

### [30-prompt-structure/00-overview.md](30-prompt-structure/00-overview.md)

Read this layer when deciding whether material belongs in the system prompt,
context, or state, and when shaping agent prompts, workflows, and single-output
prompts.

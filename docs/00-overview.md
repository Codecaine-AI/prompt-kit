---
covers: The documentation entry point for prompt-kit and its Foundation, System Design, and Implementation layers.
type: overview
concepts: [documentation, prompt-kit, navigation]
---

# Prompt-Kit Documentation

Prompt-kit documentation is organized in three layers: Foundation for intent,
System Design for package behavior, and Implementation for current TypeScript
source structure. Start here when reading the package as a standalone repository.

---

## File Tree

```text
docs/
├── 00-overview.md          (this file) Documentation entry point
├── 00-foundation/          Purpose, boundaries, and authoring principles
├── 10-system-design/       AST, rendering, transforms, validation, and kernel boundary
└── 20-implementation/      Current source tree, editing UI, and development notes
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

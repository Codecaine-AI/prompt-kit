---
covers: The implementation overview for prompt-kit, including package architecture, public exports, tests, and source documentation links.
type: overview
concepts: [implementation, package, source-map, API]
design_refs: [10-system-design/10-canonical-prompt-object.md, 10-system-design/30-rendering-model.md]
---

# Prompt-Kit Implementation

Prompt-kit is implemented in `packages/prompt-kit/src/` as a TypeScript package
with a small public API and no kernel dependency. The source tree is grouped by
AST nodes, builders, templates, renderers, transforms, validation, and
lightweight UI models.

---

## File Tree

```text
20-implementation/
├── 00-overview.md       (this file) Implementation entry point
├── 10-src/              Source package documentation
│   └── 00-overview.md
├── 20-editor/           Prompt-editing UI architecture
│   └── 00-overview.md
└── 99-appendix/         Development and operational notes
    └── 00-overview.md
```

## Public Package Exports

The root export re-exports the core package surfaces:

```ts
export * from "./builders";
export * from "./nodes";
export * from "./renderers";
export * from "./templates";
export * from "./transforms";
export * from "./validation";
```

The `./ui` export exposes lightweight editor and preview models:

```ts
export * from "./editors";
export * from "./renderers";
```

## Main Source Areas

### [10-src/00-overview.md](10-src/00-overview.md)

Documents the source tree and links to implementation notes for nodes, builders,
templates, renderers, transforms, validation, and UI models.

### [20-editor/00-overview.md](20-editor/00-overview.md)

Documents the prompt-editing UI built on this package: the editing model,
keyboard model, structural steps, presentation contract, application shell,
block vocabulary, and the current package split. That UI is implemented in
`packages/prompt-kit/src/ui/` and consumed by host viewers.

### [99-appendix/00-overview.md](99-appendix/00-overview.md)

Documents development commands and package-level operational notes.

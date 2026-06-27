---
covers: The source-level implementation map for prompt-kit, organized around nodes, builders, templates, renderers, transforms, validation, and UI models.
type: overview
concepts: [src, modules, API, implementation]
design_refs: [10-system-design/10-canonical-prompt-object.md]
---

# Source Modules

The `src/` directory is organized by public capability rather than by runtime
integration. Each module owns one layer of the prompt document lifecycle.

---

## File Tree

```text
10-src/
├── 00-overview.md              (this file) Source module entry point
├── 10-nodes-and-builders.md    Canonical nodes and authoring helpers
├── 20-templates.md             Prompt template helpers
├── 30-renderers.md             XML Markdown renderer
├── 40-transforms.md            AST traversal and transforms
├── 50-validation.md            Validation diagnostics
└── 60-ui-models.md             Lightweight preview and editor models
```

## Source Tree

```text
src/
├── builders/       Authoring helpers that create prompt nodes
├── nodes/          Canonical AST types, guards, and definePrompt
├── renderers/      PromptDocument to rendered output
├── templates/      Reusable prompt skeletons
├── transforms/     Tree traversal, find, insert, replace, omit
├── ui/             Headless preview and editor models
├── validation/     Prompt diagnostics
└── index.ts        Root public export
```

## Read Order

Start with [10-nodes-and-builders.md](10-nodes-and-builders.md) to understand
the data model and authoring API. Then read renderer, transform, and validation
docs based on the behavior you are extending.


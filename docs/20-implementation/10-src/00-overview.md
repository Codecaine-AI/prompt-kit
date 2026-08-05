---
covers: The source-level implementation map for prompt-kit, organized around nodes, builders, templates, renderers, transforms, validation, and UI models.
type: overview
concepts: [src, modules, API, implementation]
design_refs: [10-system-design/10-canonical-prompt-object.md]
---

# Source Modules

The `packages/prompt-kit/src/` directory is organized by public capability
rather than by runtime integration. Each module owns one layer of the prompt
document lifecycle.

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
packages/prompt-kit/src/
├── nodes/          Canonical AST types, guards, and definePrompt
├── renderers/      PromptDocument to rendered output
├── transforms/     Tree traversal, find, insert, replace, omit
├── ui/             Headless editor models and React surfaces
├── validation/     Prompt diagnostics
└── index.ts        Root public export
```

The authoring builder and template modules (`builders/`, `templates/`) were
removed 2026-08-05; they had no production consumers and are recoverable from
git history.

## Read Order

Start with [10-nodes-and-builders.md](10-nodes-and-builders.md) to understand
the data model and authoring API. Then read renderer, transform, and validation
docs based on the behavior you are extending.

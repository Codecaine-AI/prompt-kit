---
covers: The system design layer for prompt-kit, covering AST shape, authoring, rendering, transforms, validation, and kernel integration boundaries.
type: overview
concepts: [system-design, AST, renderer, transforms]
---

# Prompt-Kit System Design

Prompt-kit is designed around one canonical prompt object that can be authored,
rendered, validated, transformed, and previewed. These documents describe that
model without depending on a specific host runtime.

---

## File Tree

```text
10-system-design/
├── 00-overview.md                    (this file) Design entry point
├── 10-canonical-prompt-object.md     PromptDocument and node model
├── 20-authoring-model.md             Builders, templates, archetypes, and sections
├── 30-rendering-model.md             XML-tagged Markdown and renderer separation
├── 40-composition-and-transforms.md  Stable id transforms and tree traversal
├── 50-validation-contract.md         Diagnostics and variable declaration checks
└── 60-kernel-boundary.md             How kernels consume prompt-kit without being inside it
```

## Contents

### [10-canonical-prompt-object.md](10-canonical-prompt-object.md)

Defines the package's central data model: a `PromptDocument` with a schema
version, metadata, archetype, and nested block nodes.

### [20-authoring-model.md](20-authoring-model.md)

Explains the builder API, templates, section conventions, and the flexible
archetype strategy.

### [30-rendering-model.md](30-rendering-model.md)

Explains why XML-tagged Markdown is the default rendering target and how the AST
stays independent from any one renderer.

### [40-composition-and-transforms.md](40-composition-and-transforms.md)

Explains stable node ids, traversal, find/insert/replace/omit transforms, and
why prompt composition avoids string manipulation.

### [50-validation-contract.md](50-validation-contract.md)

Explains the validation surface and the distinction between static prompt
validation and dynamic runtime context failures.

### [60-kernel-boundary.md](60-kernel-boundary.md)

Explains how agent kernels consume prompt-kit while keeping runtime-specific
systems such as tools, context loaders, traces, and Pi integration outside it.


---
covers: The system design layer for prompt-kit, covering AST shape, authoring, rendering, transforms, validation, editor behavior, prompt-structure conventions, and kernel integration boundaries.
type: overview
concepts: [system-design, AST, renderer, transforms, editor]
---

# Prompt-Kit System Design

Prompt-kit is designed around one canonical prompt object that can be authored,
rendered, validated, transformed, and edited. These documents describe that
model without depending on a specific host runtime.

---

## File Tree

```text
10-system-design/
├── 00-overview.md                    (this file) Design entry point
├── 10-canonical-prompt-object.md     PromptDocument and node model
├── 20-authoring-model.md             Document-as-data authoring, JSON form, archetypes, sections
├── 30-rendering-model.md             XML-tagged Markdown, node rendering, line projection
├── 40-composition-and-transforms.md  Stable id transforms and tree traversal
├── 50-validation-contract.md         Diagnostics, shape checks, variable declarations
├── 60-editor/                        Editing behavior of the prompt editor
├── 70-prompt-structure/              Model-facing prompt-shape conventions
└── 80-kernel-boundary.md             How kernels consume prompt-kit without being inside it
```

## Contents

### [10-canonical-prompt-object.md](10-canonical-prompt-object.md)

Defines the package's central data model: a `PromptDocument` with a schema
version, metadata, archetype, and nested block nodes.

### [20-authoring-model.md](20-authoring-model.md)

Explains how prompts are authored as plain data with `definePrompt` and typed
node literals, as schema-validated JSON documents, and through the editor —
plus archetypes, section conventions, variables, and context usage.

### [30-rendering-model.md](30-rendering-model.md)

Explains why XML-tagged Markdown is the default rendering target, how each
node type renders, the per-line projection, and how the AST stays independent
from any one renderer.

### [40-composition-and-transforms.md](40-composition-and-transforms.md)

Explains stable node ids, traversal, find/insert/replace/omit transforms, and
why prompt composition avoids string manipulation.

### [50-validation-contract.md](50-validation-contract.md)

Explains the validation surface: structural shape checks for untrusted input,
semantic diagnostics, and the distinction between static prompt validation and
dynamic runtime context failures.

### [60-editor/](60-editor/00-overview.md)

Specifies the editing behavior of the prompt editor: the editing model,
keyboard gestures, presentation contract, block vocabulary, pointer
interactions, and the lab shell.

### [70-prompt-structure/](70-prompt-structure/00-overview.md)

Model-facing prompt-shape conventions: how agent, workflow, and single-output
prompts are structured for the model that reads them.

### [80-kernel-boundary.md](80-kernel-boundary.md)

Explains how agent kernels consume prompt-kit while keeping runtime-specific
systems such as tools, context loaders, traces, and Pi integration outside it.

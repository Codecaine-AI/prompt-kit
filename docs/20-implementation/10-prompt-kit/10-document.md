---
covers: Structural decisions for the document model — node-vocabulary extension, structure conventions over existing nodes, AST-only transforms, and the host dependency boundary.
concepts: [document, AST, nodes, transforms, validation]
design_refs: [10-system-design/10-canonical-prompt-object.md, 10-system-design/40-composition-and-transforms.md, 10-system-design/50-validation-contract.md]
---

# Document Model

`packages/prompt-kit/src/document` implements the canonical prompt object: the
node vocabulary, document schema, canonical form and hashing, rendering,
transforms, and validation. Everything else in the workspace consumes prompt
documents through this area.

---

## Governed by

- [Canonical prompt object](../../10-system-design/10-canonical-prompt-object.md)
- [Authoring model](../../10-system-design/20-authoring-model.md)
- [Rendering model](../../10-system-design/30-rendering-model.md)
- [Composition and transforms](../../10-system-design/40-composition-and-transforms.md)
- [Validation contract](../../10-system-design/50-validation-contract.md)

## Decisions

### Node vocabulary stays small and closed

**Decision.** New node types are added only when the existing block vocabulary
cannot represent a common prompt structure. Prompt-structure conventions map
onto the existing vocabulary rather than getting their own node types: a
workflow is a `section` tagged `workflow` with nested phase sections, steps
are `orderedList` nodes, constraints are lists, and single-output skeletons
use `codeBlock` inside an output-format section. No workflow-specific or
technique-specific node types exist.

**Why.** A small closed vocabulary keeps renderers, transforms, and validation
total over one canonical AST — every consumer handles every node.

**Applies to.** A new prompt convention is expressed with existing nodes
first; a vocabulary extension needs a structure the current nodes cannot
represent.

### Dynamic values enter through `variable` nodes

**Decision.** Runtime values enter a prompt through `variable` nodes —
declared runtime boundaries — never through raw text placeholders. `raw` nodes
are reserved for content no structured node can express.

**Why.** Raw placeholders and host string interpolation defeat validation
(undeclared variables go undetected) and structural diffing.

**Applies to.** Any new injection point for runtime data is a `variable`
node; adding placeholder syntax inside text content is a restructure, not an
extension.

### Transforms operate on AST nodes, never strings

**Decision.** Transforms are immutable and id-targeted — insert, replace, and
omit address nodes by id and return new documents. They operate at block
scope only; inline transforms build on `visitPrompt` when needed.

**Why.** String rewriting breaks the canonical shape and destroys stable node
ids, which addressing, diffing, and annotation all depend on.

**Applies to.** Every new transform takes and returns documents, targets ids,
and never mutates its input.

### Host declarations are parameters, not imports

**Decision.** The validator accepts host declarations (for example
`declaredVariables`) as parameters. The document core never imports from a
host.

**Why.** Prompt-kit stays host-independent while still supporting
host-specific validation.

**Applies to.** New validation rules that need host knowledge take it as an
option; a host import in `src/document` is a boundary violation.

## Modules

| Module | Responsibility |
| --- | --- |
| `nodes` | Node types, guards, id generation, node construction |
| `schema` | Document schema and shape validation |
| `canonical` | Canonical form and content hashing |
| `render` | XML-tagged Markdown rendering and the line model |
| `transforms` | Id-targeted find/insert/replace/omit and traversal |
| `validate` | Tree validation and diagnostics |

---
covers: The validation contract for prompt-kit documents, including schema checks, ids, XML tags, context usage, and declared variables.
concepts: [validation, diagnostics, variables, schema]
depends-on: [10-system-design/10-canonical-prompt-object.md]
---

# Validation Contract

Prompt-kit validation checks prompt tree integrity without freezing prompt style.
It catches structural problems that make rendering and transformation unsafe.

---

## Validation Result

`validatePrompt(prompt, options)` returns:

```ts
interface PromptValidationResult {
  ok: boolean;
  diagnostics: PromptDiagnostic[];
}
```

Diagnostics include severity, code, message, path, and optional node id. The
result is `ok` when no diagnostic carries `severity: "error"`; warnings do not
block. The validator runs document-level checks first, then traverses the full
tree — blocks, list items, and inline nodes — collecting ids and checking each
node in place, so one pass reports every problem rather than stopping at the
first.

## Two Validation Layers

Semantic validation assumes it is looking at a `PromptDocument`. For untrusted
input — a JSON file, a save-endpoint body — the schema module's shape check
(`validatePromptDocumentShape`, mirroring the published JSON Schema) runs
first and reports structural mismatches by path. See
[20-authoring-model.md](20-authoring-model.md) for the JSON authoring form.

## Current Checks

The validator reports errors for:

- unsupported schema version
- missing prompt id
- duplicate node ids
- invalid XML section tags
- context usage nodes with empty context ids
- variables not present in `declaredVariables`, when declarations are provided

## Variable Declarations

Prompt-kit does not own the runtime variable catalog. A host can provide
`declaredVariables` during validation:

```ts
validatePrompt(prompt, {
  declaredVariables: ["userPrompt", "focus"],
});
```

This catches references such as `variable("unknownName")` before rendering.

## Static Versus Runtime Validation

Prompt-kit can validate the static prompt object. It cannot prove that a runtime
context loader will succeed, that a tool exists in a host registry, or that a
conversation packet is available. Those failures should be surfaced by the host
runtime through its own diagnostics or trace events.

## Flexible By Design

Custom section tags, metadata, and archetype strings are valid when they satisfy
the small structural requirements. The validator provides a safety floor while
leaving room for new prompt families.


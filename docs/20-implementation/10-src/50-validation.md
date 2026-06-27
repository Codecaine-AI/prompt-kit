---
covers: How prompt-kit implements validation diagnostics for schema version, prompt ids, duplicate node ids, XML tag names, context ids, and declared variables.
concepts: [validation, diagnostics, schema, variables]
design_refs: [10-system-design/50-validation-contract.md]
---

# Validation

Validation checks the static prompt tree and returns diagnostics that callers can
display in editors, traces, tests, or CI.

---

## Files

| File | Responsibility |
|------|----------------|
| `src/validation/validate-tree.ts` | `validatePrompt` implementation |
| `src/validation/diagnostics.ts` | Diagnostic and result types |
| `src/validation/index.ts` | Validation barrel export |
| `src/validation/validate-tree.test.ts` | Validation behavior tests |

## Validator Flow

`validatePrompt` starts with document-level checks, then traverses the tree with
`visitPrompt`. It collects ids, checks section tag names, checks context usage
ids, and checks variable names against an optional declaration set.

## Diagnostics

Diagnostics include:

- `severity`
- `code`
- `message`
- optional `path`
- optional `nodeId`

The result is considered ok when no diagnostic has `severity: "error"`.

## Host Declarations

The validator accepts `declaredVariables` because variables usually belong to
the host agent definition. This keeps prompt-kit independent while allowing
host-specific validation.


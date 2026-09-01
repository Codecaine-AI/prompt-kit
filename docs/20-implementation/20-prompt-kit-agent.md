---
covers: Structural decisions for the agent host package — catalog layout, the prompt document as sole prompt source, workflow-in-AST, the context/state sidecar split, and catalog-adjacent tests.
concepts: [agent-host, catalog, kernel, prompt-document, sidecars]
design_refs: [10-system-design/80-kernel-boundary.md, 10-system-design/70-prompt-structure/00-overview.md]
---

# Agent Host Package

`@codecaine-ai/prompt-kit-agent` is the agent host: a standalone kernel
harness plus the agent catalog it mounts. The harness lives in
`packages/prompt-kit-agent/src`; the catalog lives in
`packages/prompt-kit-agent/catalog`.

---

## Governed by

- [Kernel boundary](../10-system-design/80-kernel-boundary.md)
- [Prompt structure](../10-system-design/70-prompt-structure/00-overview.md)

## Decisions

### One directory per agent under `catalog/`

**Decision.** Each agent is a directory under `catalog/` containing:
`agent.json` (the manifest — name, description, model alias, turn budget);
`prompt/prompt.json` (the prompt document, the directory's source of truth)
alongside the rendered `prompt/system.md`; optional `context/` (markdown
blocks plus an `index.ts` sidecar); optional `state/` (an `index.ts` sidecar
plus JSON fixtures); and `annotations.json`. Fragments shared across agents
live in `catalog/_shared/blocks/`, and catalog-wide helpers in
`catalog/shared/`.

**Why.** Keeping the prompt as a document — data, not rendered text — is what
enables structural editing, validation, and diffing; one directory per agent
keeps every face of an agent addressable in one place.

**Applies to.** New agents follow this layout; the kernel mounts `catalog/` as
a catalog root and discovers agents by directory.

### The prompt document is the only prompt source

**Decision.** An agent's prompt text lives only in its prompt document
(`prompt/prompt.json`); the rendered `system.md` is an artifact, not the
source. No prompt fragments are assembled at runtime from host strings.

**Why.** Only a document-form prompt can be transformed, validated, and
diffed structurally; text scattered across host code defeats validation and
review.

**Applies to.** New prompt content is edited into the document; host code
that concatenates prompt text is a restructure, not an addition.

### Workflow structure lives in the prompt AST

**Decision.** An agent's workflow is a `workflow` section in its prompt
document with ordered steps, not host code that interpolates step text. The
rejected alternative — step templates in TypeScript — keeps steps out of
reach of the editor and validator.

**Why.** Workflow steps in the AST are addressable, diffable, and editable
like any other prompt structure.

**Applies to.** New phases and steps are edits to the workflow section, not
host-side string assembly.

### Standing knowledge and live state split into sidecars

**Decision.** Reference material (face ②) is assembled by the `context/`
sidecar from named markdown blocks, each rendered as its own XML tag via
kernel file loaders. Per-session data (face ③) — the target render, applied
diffs, the request queue — is rendered by the `state/` sidecar from session
data, with fixtures standing in when no live session exists. The context
sidecar never reads session data.

**Why.** The two faces have different lifecycles: context changes with the
docs, state changes every turn. Mixing them makes both harder to change and
the model's picture less reliable.

**Applies to.** New reference material is a context block; new live data is a
state field. Neither belongs in the prompt document.

### Catalog contract tests live beside the catalog

**Decision.** Tests that pin the catalog's assembled output (prompt assembly,
prompt-edit integration) live in `catalog/` next to what they test, and the
package test script runs both roots: `bun test ./test ./catalog`.

**Why.** The catalog is data with a contract; its tests move with it.

**Applies to.** A new agent's assembly tests land in `catalog/`; harness
tests land in `test/`.

## Harness modules

| Module | Responsibility |
| --- | --- |
| `src/kernel.ts` | Boot: database, manifest, catalog roots, model aliases |
| `src/app.ts` | Elysia app wiring catalog, trace-read, and health routes |
| `src/prompt-edit.ts` | Prompt-edit session service and per-spawn tool binding |
| `src/server.ts` | Process entry: port, listen, shutdown |

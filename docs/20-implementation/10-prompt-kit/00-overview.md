---
covers: Package-level structural decisions for the prompt-kit library, including the entry-point split, the optional React peer, import direction, and test layout.
type: overview
concepts: [package, exports, entry-points, react, imports]
design_refs: [10-system-design/00-overview.md]
---

# Library Package

`@codecaine-ai/prompt-kit` is the library package. Its source lives in
`packages/prompt-kit/src`, grouped into `document/` (the prompt AST and its
operations), `annotations/` (the headless annotation surface), and `ui/`
(editor models and the React authoring surface).

---

## Governed by

The [system design tier](../../10-system-design/00-overview.md) constrains this
package's shape:

- [Canonical prompt object](../../10-system-design/10-canonical-prompt-object.md)
- [Authoring model](../../10-system-design/20-authoring-model.md)
- [Rendering model](../../10-system-design/30-rendering-model.md)
- [Composition and transforms](../../10-system-design/40-composition-and-transforms.md)
- [Validation contract](../../10-system-design/50-validation-contract.md)
- [Editor](../../10-system-design/60-editor/00-overview.md)

## Decisions

### Entry-point split

**Decision.** The package exposes six entry points, split by what they may
depend on. The root export carries the headless document APIs (nodes, schema,
canonical form, render, transforms, validation). `./annotations` carries the
headless annotation schema and store. `./ui` carries headless UI models —
editor model and transactions — with no React and no DOM. `./ui/lab`,
`./ui/style`, and `./ui/surface` carry the React surface.

**Why.** The default import stays framework-free, so servers, scripts, and
kernels consume prompt documents without pulling in React.

**Applies to.** Every new module is exported through the specifier matching its
dependencies. React code never lands behind the root export or `./ui`.

### Optional React peer

**Decision.** `react` and `react-dom` are optional `peerDependencies`.

**Why.** Servers, scripts, and tests consume the headless entries and must
install without React.

**Applies to.** New dependencies on React stay peer-side and optional; headless
entries never require them at runtime.

Two consumer-facing constraints ride on this entry:

- React deduplication is maintained in three places — each consumer's Vite
  `dedupe`/`optimizeDeps` settings, the agent-kernel root `tsconfig.json`
  `@types/react` pin, and this repository's `react-dedup.ts` bun test
  preload. Preserve all three.
- Consumer builds (the agent-kernel example, the canvas viewer, and
  observatory) hard-code Tailwind content globs and Vite `fs.allow` entries at
  `prompt-kit/packages/prompt-kit/src`. Moving the package source requires
  updating those consumers.

### Downward-only imports

**Decision.** Imports flow one way: `ui` → `annotations` → `document`.
`document` imports from neither of the other two.

**Why.** The document model stays headless and extractable; nothing above it
can leak into it.

**Applies to.** New modules import only downward. A `document` module that
needs UI or annotation types is in the wrong layer.

### Tests mirror source

**Decision.** Tests live under `tests/`, mirroring the `src/` directory
structure (`tests/document/render/` tests `src/document/render/`, and so on).

**Applies to.** A new module's tests land at the mirrored path under `tests/`.

## Areas

| Area | Responsibility |
| --- | --- |
| [`src/document`](10-document.md) | The prompt AST: nodes, schema, canonical form, rendering, transforms, validation |
| `src/annotations` | Headless annotation schema and store over prompt documents |
| [`src/ui`](20-ui.md) | Headless editor models and the React authoring surface |

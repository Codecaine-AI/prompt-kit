---
covers: Development commands and repository notes for working on prompt-kit inside the agent-kernel workspace or as a standalone package.
concepts: [development, testing, typecheck, submodule]
---

# Development

Prompt-kit can be worked on inside the agent-kernel workspace or as its own
package repository. The package source is self-contained and does not import the
kernel.

---

## Commands From Workspace Root

```bash
bun run typecheck:prompt-kit
bun test ./packages/prompt-kit/src
```

The workspace also includes prompt-kit in the broader checks:

```bash
bun run typecheck
bun run test
```

## Package Exports

`package.json` exposes:

```json
{
  ".": "./src/index.ts",
  "./ui": "./src/ui/index.ts"
}
```

The root export is for prompt construction, rendering, transforms, and
validation. The `./ui` export is for headless prompt preview/editor models.

## Repository Boundary

Prompt-kit is designed as its own repository and can live as a submodule inside
the agent-kernel workspace. Documentation, README, package metadata, source, and
tests should remain self-contained inside the package.

When changing prompt-kit APIs, update this package's docs first and then update
kernel integration docs where the host behavior changes.

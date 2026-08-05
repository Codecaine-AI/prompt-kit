---
covers: Standalone development commands, package exports, known issues, and integration traps for prompt-kit.
concepts: [development, testing, typecheck, exports, integration]
---

# Development

Prompt-kit is a Bun workspace. The library source is self-contained and does
not import the Agent Kernel; the sibling agent harness depends on both the
library and Agent Kernel.

---

## Commands From Repository Root

Install dependencies from the `Core` root or this repository root. Typecheck
and test both workspace packages from this repository root:

```bash
bun install
bun run typecheck
bun run test
```

To check only the library, run `bun run --cwd packages/prompt-kit typecheck` or
`bun run --cwd packages/prompt-kit test`. Replace the cwd with
`packages/prompt-kit-agent` for the harness; its test script runs
`bun test ./test ./catalog`, so catalog tests are included.

## Package Exports

`packages/prompt-kit/package.json` exposes six entry points:

```json
{
  ".": "./src/index.ts",
  "./annotations": "./src/annotations/index.ts",
  "./ui": "./src/ui/index.ts",
  "./ui/lab": "./src/ui/lab/index.tsx",
  "./ui/style": "./src/ui/style/index.ts",
  "./ui/surface": "./src/ui/surface/index.ts"
}
```

The root export covers prompt construction, rendering, transforms, and
validation. `./annotations` exposes the headless annotation surface. `./ui`
stays React-free; the remaining `./ui/*` entry points expose the React
authoring surface and its supporting modules.

## Repository Boundary

Documentation and working-state notes remain at the repository root. Library
source and tests live in `packages/prompt-kit`; the agent catalog, authoring
skill, kernel, and tests live in `packages/prompt-kit-agent`. When a prompt-kit
API changes, update this package's docs first, then update integration docs when
host behavior changes.

## Known issues

1. **Shift+Enter inserts a literal newline into a paragraph.** The paragraph
   key handler returns on `shiftKey` without preventing the default action, and
   the textarea guard suppresses only bare Enter. The newline is committed to
   inline content and `escapeXmlText` leaves it literal, violating the editor's
   one-row-per-paragraph line model.
2. **Pure structure steps depend on a client UI module.**
   `structure-steps.ts` imports `findUnnestLocation` from the `"use client"`
   module `node-mutations.ts`, coupling otherwise-pure structural logic to the
   client editor layer.

## Traps

1. **Lab autosave writes through to disk.** About 1.5 seconds after typing, the
   lab sends `PUT **/kernel/catalog/agents/*/prompt`. Browser tests must
   intercept that request and fulfil it locally; never write and then restore.
2. **Two React copies crash hooks.** React is an optional peer dependency.
   Deduplication is maintained in three places: each consumer's Vite
   `dedupe`/`optimizeDeps` settings, Agent Kernel's root `tsconfig.json` paths
   pinning `@types/react`, and this repository's `react-dedup.ts` Bun test
   preload. Preserve all three.
3. **Consumer builds hard-code this repository's location and package layout.**
   The Tailwind globs in `agent-kernel/examples/simple-research-kernel`,
   `canvas/packages/canvas-agent/src/viewer`, and `observatory/src/ui` now point
   at `prompt-kit/packages/prompt-kit/src/**/*.{ts,tsx}`. Their Vite `fs.allow`
   settings also refer to this checkout. Moving the package source requires all
   three consumers to change.
4. **The development loop spans separate processes.** Canvas uses the viewer
   on `:4830` at `/config` with its harness on `:4820`. The standalone
   prompt-kit kernel uses `:4850`; start it with `bun run dev:agent` from this
   repository root. Start Observatory with `bun run dev` from `../observatory`.

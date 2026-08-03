---
covers: Standalone development commands, package exports, known issues, and integration traps for prompt-kit.
concepts: [development, testing, typecheck, exports, integration]
---

# Development

Prompt-kit is a standalone repository. Its source is self-contained and does
not import the Agent Kernel.

---

## Commands From Repository Root

Install dependencies, typecheck the package, and run its source tests from this
repository's root:

```bash
bun install
bun run typecheck
bun test src
```

## Package Exports

`package.json` exposes ten entry points:

```json
{
  ".": "./src/index.ts",
  "./annotations": "./src/annotations/index.ts",
  "./ui": "./src/ui/index.ts",
  "./ui/annotations": "./src/ui/annotations/index.ts",
  "./ui/react": "./src/ui/react.ts",
  "./ui/prompt-flow": "./src/ui/prompt-flow/index.ts",
  "./ui/lab": "./src/ui/lab/index.tsx",
  "./ui/style": "./src/ui/style/index.ts",
  "./ui/surface": "./src/ui/surface/index.ts",
  "./ui/view": "./src/ui/view/index.ts"
}
```

The root export covers prompt construction, rendering, transforms, and
validation. `./annotations` and `./ui/annotations` expose the headless and React
annotation surfaces. `./ui` stays React-free; the remaining `./ui/*` entry
points expose the React authoring surface and its supporting modules.

## Repository Boundary

Documentation, package metadata, source, and tests remain self-contained in
this repository. When a prompt-kit API changes, update this package's docs
first, then update integration docs when host behavior changes.

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
3. **Consumer builds hard-code this repository's location and `src/` layout.**
   Tailwind source paths (`@source` or `content`) and Vite `fs.allow` settings
   refer to this checkout from `agent-kernel/examples/simple-research-kernel`,
   `canvas/packages/canvas-agent/src/viewer`, and `observatory/src/ui`. Renaming
   or moving `src/` breaks all three consumers.
4. **The development loop spans separate processes.** Canvas uses the viewer
   on `:4830` at `/config` with its harness on `:4820`. The standalone
   prompt-kit kernel uses `:4850`; start it with `bun run dev:prompt-kit` from
   `../agent-kernel`. Start Observatory with `bun run dev` from
   `../observatory`.

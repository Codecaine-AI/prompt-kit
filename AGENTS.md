# Prompt Kit agent notes

Prompt Kit is a Bun workspace with four packages. The parent Codecaine core
workspace installs the dependencies. Run `bun install` in the core folder, not
here.

| Package | Folder | Test root |
| --- | --- | --- |
| `@codecaine-ai/prompt-kit` (document model, authoring, annotations, React UI) | `packages/prompt-kit` | `packages/prompt-kit/tests` |
| `@codecaine-ai/prompt-kit-server` (store, routes, guidance) | `packages/prompt-kit-server` | `packages/prompt-kit-server/tests` |
| `@codecaine-ai/prompt-kit-mcp` (MCP tools, CLI, install, daemon) | `packages/prompt-kit-mcp` | `packages/prompt-kit-mcp/src` |
| `@codecaine-ai/prompt-kit-studio` (Studio app and its API) | `packages/studio` | `packages/studio/server` |

Other core packages import `@codecaine-ai/prompt-kit` and
`@codecaine-ai/prompt-kit-server`. Before you remove an export, search the
whole core tree with `git grep -w <name>` in each member repo.

## Test commands

Diff base for the changed-files gate: `origin/main`.

### Tier 1: every agent change

| Check | Command |
| --- | --- |
| Typecheck | `bun run typecheck` |
| Lint | No code lint |
| Focused tests on changed files | The command below |

```bash
{ git diff --name-only --diff-filter=d origin/main; git ls-files --others --exclude-standard; } \
  | grep -E '\.test\.tsx?$' \
  | while read -r f; do p=$(echo "$f" | cut -d/ -f1-2); (cd "$p" && bun test "./${f#$p/}"); done
```

- Each test runs from its own package folder. `packages/prompt-kit` needs its
  `bunfig.toml` preloads (happy-dom and the React dedup), so a run from the
  repo root fails.
- Keep the `./` prefix. Without it `bun test` treats a path as a name filter.

### Tier 2: before a PR

| Check | Command |
| --- | --- |
| Changed-files gate | None. Run the Tier 3 full suite. |
| Touched-area keeper suites, without quarantined tests | None yet. The package Bun suite of each area owns its flows. |

- The repo has no CI workflow. Run Tier 2 locally before a PR.
- A change under `packages/prompt-kit/src/**` also runs the server, MCP and
  Studio suites, because those packages import it.
- Before a PR that changes Studio or the editor UI, also run the agent check:
  start Studio with `bun run dev:studio` and use the changed flow on a scratch
  prompt root. The agent check runs outside CI.

### Tier 3: before a release or a big merge

| Check | Command |
| --- | --- |
| Full suite | `bun run typecheck && bun run test` (the four package suites in order) |
| All keeper suites, with quarantined tests | None yet |
| Screenshot comparisons | None yet |

### Product areas

| Area | Main user flows | Keeper tests | Package globs |
| --- | --- | --- | --- |
| Document model | Parse, validate, transform, canonicalize and render a prompt document | `packages/prompt-kit/tests/document/**` | `packages/prompt-kit/src/document/**` |
| Authoring and annotations | Author operations, annotation anchors and routing | `packages/prompt-kit/tests/{authoring,annotations}/**` | `packages/prompt-kit/src/{authoring,annotations}/**` |
| Editor | Edit a prompt in the buffer, steps and inspector, undo, save | `packages/prompt-kit/tests/ui/editor/**` | `packages/prompt-kit/src/ui/editor/**` |
| Lab | Run a session, annotate, page view | `packages/prompt-kit/tests/ui/lab/**` | `packages/prompt-kit/src/ui/lab/**` |
| Surface, view and style | Render a prompt read-only, style tokens | `packages/prompt-kit/tests/ui/{surface,view,style}/**` | `packages/prompt-kit/src/ui/{surface,view,style}/**` |
| Server | Store reads and writes, path confinement, annotation routes, guidance bundle | `packages/prompt-kit-server/tests/**` | `packages/prompt-kit-server/**` |
| MCP and CLI | Agent tools, capabilities and guidance, install, daemon lifecycle | `packages/prompt-kit-mcp/src/*.test.ts` | `packages/prompt-kit-mcp/**` |
| Studio | Studio API | `packages/studio/server/**` | `packages/studio/**` |

Routing rules:

- A file that matches more than one area runs every matched area.
- A file that matches no area, such as `package.json`, `bun.lock` or
  `packages/prompt-kit/src/index.ts`, runs the full suite.

### Quarantine

No quarantined tests.

| Test title | Owner | Expiry |
| --- | --- | --- |

### Budget and runner setup

- Measured 2026-11-27 on dev-01: the full suite takes about 7 s (847 tests).
- An over-budget run is a finding. Never add retries or cut keeper tests to fit.

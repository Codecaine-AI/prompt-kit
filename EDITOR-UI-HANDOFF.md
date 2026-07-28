# Prompt editor UI — build log and handoff

Working-state document for the prompt-authoring UI that now lives in
`src/ui/`. Written 2026-07-25 at the end of the session that built and moved
it, so a fresh thread can pick the work up without re-deriving anything.

Architecture reference lives in `docs/20-implementation/20-editor/`. This file
is the *state of play*: what changed, why, what is unfinished, and the traps.

---

## Status at a glance

| Thing | State |
|---|---|
| Editor UI location | `prompt-kit/src/ui/` (moved here from agent-kernel) |
| prompt-kit typecheck | Clean (`bun run typecheck`) — first time ever; the tsconfig previously extended a nonexistent file |
| prompt-kit tests | 245 pass / 0 fail (`bun test`) |
| agent-kernel | typecheck clean; `packages/viewer-ui` 31 tests pass |
| canvas-agent | typecheck clean |
| Committed? | **No.** Everything below is uncommitted in three repos |
| Pushed / dependency re-pinned? | **No.** Deliberately not done — needs owner approval |

---

## What the UI is

An XML-shaped prompt editor. The document is a canonical `PromptDocument`; the
XML/Markdown text is a *rendered projection* of it, and the editor's rows
concatenate to exactly `renderXmlMarkdown` output — that invariant is what keeps
line numbers aligned with the read-only view.

The owner's non-negotiable: **the editable surface must keep looking like the
rendered XML prompt.** Not cards, not a rich-text projection, not a
Notion-style document. Every design decision below serves that.

Every edit is a *step* committed through the history, so undo/redo and autosave
behave uniformly. Style settings are viewer-only and must never change
serialization, hashes, dirty state, or revisions.

---

## Layout

```
src/ui/
  editors/      pre-existing headless editor model (createPromptEditorModel, steps, transactions)
  renderers/    pre-existing headless preview model
  prompt-flow/  the editing surface
    PromptFlowXml/    rows, inline editing, keymap, structure gestures, slash menu, outline, drag
    PromptFlowInspector/  the DETAILS panel
  lab/          application shell: statusbar, tabbed inspector, autosave, style rail, agent zone
  style/        prompt-style-settings + usePromptStyleSettings hook
  surface/      editor-surface metrics/palette + xml-highlight
  view/         PromptView — the read-only renderer (also used by the trace viewer)
```

Entry points (`package.json` exports): `.`, `./ui` (headless, React-free),
`./ui/react` (barrel over all components), `./ui/prompt-flow`, `./ui/lab`,
`./ui/style`, `./ui/surface`, `./ui/view`.

React/react-dom are **optional peer dependencies** (two React copies crash
hooks). `classnames`, `lucide-react`, `tokenx` are regular dependencies.

Components use Tailwind utility classes and `--prompt-editor-*` custom
properties resolved by the **host** app's stylesheet — prompt-kit ships no CSS
build. agent-kernel still exports the token layer as
`@agent-kernel/viewer-ui/styles`.

---

## What was built this session (in order)

1. **Host-owned Style sidebar.** Removed the style rail from inside the lab;
   `usePromptStyleSettings` + a pure `PromptStyleRail` are exported and the host
   app owns placement (docked ≥1440px, overlay drawer below, resizable, closes
   to zero width).
2. **Readability overhaul.** New defaults: 13/22 type, dimmed punctuation and
   line numbers, softened tag lavender, selection = quiet wash + accent bar
   (hover = wash only). Full-width row shading, blank-edge trim on selection.
3. **Row shading modes + measure.** `showRules` became
   `rowShading: none | rules | zebra` (zebra is the default; legacy `showRules`
   booleans migrate). Content measure widened over several rounds to **136ch**,
   content left-justified.
4. **Shell restructure (V1+V4 from the design explorations).** Statusbar above
   the editor (view tabs · per-view token count · undo/redo · autosave status)
   and a collapsible 400px inspector with AGENT/DETAILS/REVISIONS tabs that
   collapses to *nothing*. **Autosave replaced the Save button** — debounced
   1.5s, valid-only, never concurrent, ⌘S flushes.
5. **Continuous keyboard model.** Enter splits; Enter on an empty bullet
   escapes/outdents; Enter on an empty trailing paragraph climbs out of its
   section; Backspace at offset 0 merges like-kind siblings, deletes empties, or
   at minimum moves the caret back (never a dead keystroke, never across a
   container boundary); arrows walk rows; Tab/Shift+Tab nest and
   promote/demote with the caret following.
6. **Slash menu + autoformat.** `/` on an empty paragraph opens a filtered
   menu (Text, Section, Bullets, Steps, Code); `- `, `1. `, ``` convert in
   place; Backspace immediately after restores the literal marker.
7. **Affordance cleanup.** Removed the between-block insert line and the `[+]`
   hover button (creation is typing now); the drag grip remains. Single click
   places the caret exactly where clicked, in paragraphs and list items alike.
8. **Section outline.** Always-on column of top-level tags to the right of the
   buffer, scroll-synced, click-to-jump. Hidden below a 1100px lab container.
9. **DETAILS panel cleanup.** `TAG` → `NAME`, dead section `TITLE` removed,
   attributes editor added (that's how you add "fields" to a section),
   `codeBlock.language` picker, `orderedList.start`, preview removed, node id
   behind an Advanced disclosure.
10. **Migration into prompt-kit** (this repo) — components and headless logic
    both, per the owner's decision.

Design exploration mockups that drove step 4 live at
`canvas/packages/canvas-agent/PROMPT-LAB-UI-EXPLORATIONS.html` (four full
layout variants + comparison table).

---

## Correctness findings worth keeping

- **A section's `title` renders nothing.** `renderSection` builds the open tag
  from `tag` + `attrs` only; `title` is read solely by `renderExample`. The UI
  used to show a Title field for sections that silently swallowed input. Pinned
  by a test now. Section "fields" are `attrs`.
- **The insert palette was dead code at HEAD.** Its row was computed as the
  node's last row, but gap rows are excluded from node ranges — the condition
  could never be true. Both add paths were unreachable.
- **⌘Z was silently lost** whenever focus fell to `<body>` (clicking an
  affordance that unmounts itself). Undo is a document-level listener now.
- **Split→merge used to be lossy**: merges left un-coalesced inline runs, same
  visible text but a different canonical document and hash. Use `concatInline`.
- **Multi-row nodes mounted several textareas** on one edit target; the losers'
  blur cancelled the winner. Gated on `line.editable`.

---

## Known bugs, not yet fixed

1. **Shift+Enter inserts a literal newline into a paragraph.** The key handler
   returns early on `shiftKey` without `preventDefault`, and the textarea guard
   only swallows a bare Enter. A `\n` in paragraph inline content breaks the
   one-row-per-paragraph line-model assumption, and `escapeXmlText` does not
   escape newlines. Real bug, easy to hit by reflex.
2. **Indent guides are drawn at half the text indent.** prompt-kit's
   `DEFAULT_INDENT` is four spaces, but `editor-surface.ts` / `node-geometry.ts`
   assume two. `promptEditorIndentForSpaces(4·d)` = `2d × indentWidth` (row
   text) while `promptEditorIndentForDepth(d)` = `d × indentWidth` (guides, drop
   line).
3. **`structure-steps.ts` imports `findUnnestLocation` from the React module
   `node-mutations.ts`** — the one thing keeping otherwise-pure logic from being
   cleanly portable.
4. **`docs/20-implementation/10-src/60-ui-models.md` is factually stale** — it
   documents `PromptEditorModel` as `{ prompt, selectedNodeId? }`; the real
   interface also has `selectedEntry`, `tree`, `rendered`, `validation`.

---

## Unfinished / decisions pending

- **Nothing is committed or pushed** in prompt-kit, agent-kernel, or canvas.
- **`bun.lock` is new and untracked** and is *not* gitignored — decide whether
  it belongs in the repo.
- **Dependency re-pin.** agent-kernel now consumes prompt-kit via
  `link:@codecaine-ai/prompt-kit` pointing at this checkout. Restoring the
  pinned-git-dependency setup requires committing here, pushing, and updating
  the hash in agent-kernel's root + `packages/viewer-ui` package.json. Owner
  approval required — nothing was pushed.
- **Docs reconciliation.** The move invalidated statements in
  `docs/00-foundation/10-purpose-and-boundary.md` ("excludes UI framework
  code") and `docs/20-implementation/10-src/60-ui-models.md` ("does not define a
  full UI application"). Both got only short "Direction" notes; their stance
  still needs rewriting. `docs/20-implementation/99-appendix/10-development.md`
  has a stale `packages/prompt-kit/src` test path. agent-kernel's own docs and
  skills carry stale `packages/prompt-kit` paths predating the repo split.
- **Drag-and-drop is unverified by automation** — the headless harness cannot
  deliver React pointer events. Needs a manual pass. No drag code was changed.

---

## Traps for whoever picks this up

- **Autosave writes to disk.** Typing in the lab at `/config` persists to
  `canvas/packages/canvas-agent/src/agent/catalog/layout-editor/prompt.json`
  ~1.5s later. For browser testing, intercept
  `PUT **/kernel/catalog/agents/*/prompt` in the page and fulfil it locally with
  a synthetic hash. Do **not** write-then-restore.
- **Two Reacts crash hooks.** React is a peer dep here; canvas's vite config
  does `dedupe` + `optimizeDeps.exclude`, and agent-kernel's root tsconfig has
  `paths` pinning `@types/react` to one copy. Preserve all three.
- **Vite `fs.allow` and Tailwind `@source`** in
  `canvas/packages/canvas-agent/src/viewer/{vite.config.ts,index.css}` must
  point at this checkout, or the page either refuses to load the source or
  renders completely unstyled. Both bit this migration.
- **Other agents work in these trees concurrently.** During this session another
  session rewrote the layout-editor prompt content and landed annotation-thread
  changes in canvas. Uncommitted work can be clobbered; re-grep before assuming
  a file is as you left it.
- **The dev loop**: canvas viewer on `:4830` (`/config`), harness on `:4820`.
  Screenshot harness pattern: playwright-core driving the cached
  `chrome-headless-shell`.

---

## Where to look first

| Question | File |
|---|---|
| How editing/commits work | `docs/20-implementation/20-editor/10-editing-model.md` |
| Every keystroke | `.../20-keyboard-model.md` |
| Structure gestures | `.../30-structure-steps.md` |
| Style tokens | `.../40-presentation-contract.md` |
| Shell + autosave | `.../50-application-shell.md` |
| Block vocabulary | `.../60-block-vocabulary.md` |
| Package split | `.../70-package-split.md` |

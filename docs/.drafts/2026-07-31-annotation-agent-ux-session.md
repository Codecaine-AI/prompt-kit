# Design session: prompt annotation → agent edit loop (2026-07-31)

Working session on the UX for the prompt-editing agent (prompt lab) — how annotations
drive agent edits, how diffs come back, and how this generalizes to canvas/docs.
Status: brainstorm, no decisions committed. Companion memory: prompt-agent-annotation-ux.
Interactive mockup: explorations/annotation-agent-ux/index.html (Fable-authored, browser-verified).

## Ground truth (verified in-repo this session)

- Prompt source of truth is a typed AST: `PromptDocument` / `PromptBlockNode[]`
  (`prompt-kit/src/nodes/types.ts`). Edits are `PromptStep[]` in `PromptTransaction{baseHash, steps}`
  with `applySteps` / `invertStep` / `revertSteps` (`src/ui/editors/transactions.ts`).
- Saves: PUT with `expectedHash` → 409 on conflict; kernel canonicalizes, hashes (`pk1-…`),
  writes `prompt.json`, upserts `prompt_revisions` (sqlite), and hot-swaps the live registry
  (`agent-kernel/packages/kernel/src/catalog-service.ts`). Lab autosaves to disk ~1.5s after typing.
- Annotate mode already exists and is the UX standard: `useTargeting` ring/chip + Cmd-drag ranges,
  `AnnotationComposerPopover` (scope breadcrumb), sidebar `AnnotationPanel`
  (`Core/annotations`, wired in `prompt-kit/src/ui/lab/index.tsx`). Targets:
  `PromptNodeTarget{docId,nodeId}` and `PromptRangeTarget{docId,nodeId,start,end,quote}`
  (offsets into the node's rendered extent; `nodeId===docId` = whole doc).
- The agent hooks (`onAnnotationAgentRun`, `onAnnotationUndoPatch`, `agentRun{sessionId,patchId,summary,changedIds}`)
  exist in types but NO host implements them. Prompt annotations are in-memory only (die on reload).
- Canvas boards have the only working annotation→agent loop: `pendingNotes` batch → one session
  ("Apply the pinned notes", R1/R2 request aliases re-rendered in prompt each turn), agent tools
  `add_annotation` / `reply_annotation` / `resolve_request(done→applied, declined→resolved)`,
  SSE annotation events, `baselineHash` on session create
  (`canvas/packages/studio/src/agent/*`, `canvas-agent/src/service/session/*`).
- Diff references: HUNK vendored at `Core/reference/hunk-main` (Pierre-backed terminal review
  stream, inline agent notes interleaved). Web reference: plannotator
  (`Apps/spectre/ai_docs/plannotator-main`) — `@pierre/diffs/react` `FileDiff` with
  `lineAnnotations` + `renderAnnotation`, floating selection toolbar, dockview panel dock.
  Pierre ships `SelectedLineRange`, `LineAnnotation`, accept/reject hooks. Known gotcha:
  token interaction needs `useTokenTransformer: true` on the worker-pool init options.
- Agent-facing prompt-editing reference already written: `agent-kernel/skills/prompt-kit-authoring/`
  (routes: author / improve / review / map).
- "New prompt" has no product surface: no create endpoint on `KernelCatalogService`, no lab
  affordance. Templates exist (`singleOutputPrompt`, `workflowPrompt`, `agentPrompt`).

## Proposed architecture (recommendation, not committed)

**Core claim: the agent edits the AST, not text.** The agent's output is a
`PromptTransaction` (or semantic ops that compile to one), never markdown. Everything the
annotation contract needs falls out: `patchId` = transaction id, `changedIds` = node ids
touched by steps, undo = `revertSteps`, diff = render(before) vs render(after) → Pierre.
Validation (`validatePrompt` against declared variables) becomes an automatic retry loop
before a human ever sees the proposal.

**Session model: adopt the canvas queue wholesale.** Every request is an annotation; a
general "message to the prompt" is an annotation with the doc-level target
(`nodeId===docId`) — one state model, no separate chat path. Batch is primary
("Apply N notes" + optional global comment); single-run is a session of 1 on the same
machinery. Requests get R1/R2 aliases; the agent resolves each individually even in a
batch, so per-annotation granularity survives batching. Agent asks clarifying questions
by opening its own non-blocking annotation thread (canvas pattern), not by stalling.

**Staged review, not direct apply.** Because lab saves hot-swap the live production agent,
agent edits land as a staged proposal: steps applied to a draft, shown as a Pierre diff,
human accepts → save (new revision) or rejects → discard. Third `LabMode`:
`edit | annotate | review`. Accept/reject granularity is per-request (per annotation →
its transaction), NOT per hunk — structural steps (moves) don't map cleanly to hunks.
Group the diff by request: "R1 caused these hunks."

**Diff rendering:** rendered-text diff of the two `renderPrompt` outputs through
`@pierre/diffs/react` `FileDiff`; inject the driving annotation inline at its changed
lines via `lineAnnotations` + `renderAnnotation` (HUNK's interleaved-agent-notes look).
Map hunks ↔ nodes via the rendered line model (`src/ui/view/rendered-line-model.ts`).
Same component should serve revision compare (REVISIONS tab) and proposal review.

**Edit vs new prompt:** distinct routes (the authoring skill already splits
author/improve), but ship edit-only first — "new" needs a catalog create API + bundle
scaffolding that don't exist. New-prompt is a conversation seeded from a template, not
annotations (nothing to anchor to yet).

**Review is a state of the file, not a mode (Ford confirmed 2026-07-31).** Iterated in
the mockup and confirmed as the direction: the composer spawns inline above the
clicked target, in document flow (Cursor ⌘K style) — no floating popover. The scope
breadcrumb is removed entirely; what you click is the target. Staged proposals render
as red/green diff lines in place in the file, each with a compact per-request action
bar (R-alias + note + Accept/Reject); the separate Review mode/screen is deleted from
the shell. Undo lives on the request card in the rail; annotating stays available
while a draft is staged. Request cards slimmed to alias/status/body/thread (no quote,
no target chip — click-to-focus does that job).

## Open questions

System-level (unchanged):

1. Annotation persistence: sidecar `annotations.json` next to `prompt.json`
   (docs-system pattern, path-locked + expectedHash) vs a DB table next to
   `prompt_revisions`. Re-anchoring across revisions: node ids survive, offsets
   drift → dangling detection exists, quote-search re-anchor possible. Ford's lean (2026-07-31): sidecar holds LIVE annotations only — anchors go stale once the prompt changes; history of agent processing belongs to traces + the prompt_revisions chain, not the sidecar. Consider stamping the driving request text into the revision record so the why survives annotation deletion.
2. Concurrency, reframed by Ford as batch topology: when applying N requests, does one agent handle all of them (whole-prompt context, cross-request coherence) or does each request get its own agent (parallel, but agents can collide)? Working recommendation: default to one session with full context (canvas model); fan out sub-agents only for request groups whose target node ids are provably disjoint (no shared ancestors, no doc-level targets) — the AST makes that conflict test static. Doc-level requests always force single-agent.
3. Status vocabulary divergence: add canvas's `applied` to the shared package set. RESOLVED 2026-07-31 — current vocabulary works fine for Ford; adopt applied into the shared set when the session layer lands.
4. Where the session/queue layer lives: lift canvas's pendingNotes/R-alias/resolve
   semantics into `@codecaine-ai/annotations`.
5. Revision stats closing the eval loop: surface per-hash run stats in review UI?

New, raised by the inline direction (2026-07-31):

6. Save granularity: does each Accept create a revision (mockup behavior — n accepts
   = n hashes) or one revision per draft session? Undo granularity vs revision noise. DECIDED 2026-07-31 — write-through per Accept, Cursor ⌘K feel: each accept lands on disk immediately as its own revision. Open micro-question: does Accept-all squash to one revision or stay n?
7. Inline diffs × live editing: in the real lab Edit mode works — what happens when
   the human types inside/around a staged diff block? Freeze the block, auto-rebase,
   or invalidate that proposal?
8. Silent target widening: without the scope breadcrumb, cross-block range drags must
   auto-widen to the nearest common ancestor (annotation-targeting.ts already does
   this). Is silent widening acceptable with no UI to override it?
9. Inline threads: agent clarifying questions currently live only in rail cards —
   should "waiting on you" render inline in the file too, like the diff action bars? Now demoed in the mockup (DEMOS tab, Q9): doc-level message → agent pins a placed note (A1) inline where the conflict is, amber thread bar, reply inline. Ford's stated intent: message the whole prompt and the agent leaves placed notes like 'this section conflicts with this other piece'.
10. Structural steps inline: a move/reorder spans two locations — how does an inline
    "moved from/to" render? (Pierre has moveKind.) Per-block replacement is the easy
    case; moves are not. Now demoed in the mockup (DEMOS tab, Q10): red lines + 'moved to' marker at source, green lines + single action bar at destination, one transaction.
11. Does the rail shrink to a queue overview (jump list + Apply button + threads),
    now that composing, reviewing, and possibly threads are all inline? Now demoed in the mockup (DEMOS tab, Q11): toggleable queue-overview rail (alias + status dot + snippet + Apply).

## Generalization notes (why this session matters beyond prompts)

The stack is the same everywhere: targeting/annotate mode (shared, done) → request queue
+ session (canvas only, should be shared) → staged patch review with diffs (nowhere yet,
prompts are the best first case because the artifact renders to text). Dock relevance:
plannotator's dockview shows diff-review-as-dock-panel; the lab's inspector/review mode
is the modest version of the same idea.

## Next steps (when this leaves brainstorm)

1. Persist prompt annotations (sidecar or DB) — everything else depends on it.
2. Prompt-editor agent session service on the canvas session skeleton
   (queue, R-aliases, resolve tools, prompt-kit-authoring skill in context).
3. `review` LabMode with Pierre diff grouped by request; accept → save path.

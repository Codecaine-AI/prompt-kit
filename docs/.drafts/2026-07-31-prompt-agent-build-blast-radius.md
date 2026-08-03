# Prompt-editor agent: build-out blast radius (2026-07-31)

Task map for taking the annotation→agent-edit→inline-review loop from mockup to real.
Strategy (Ford): initial build-out, then iterate interactively. Companion docs:
2026-07-31-annotation-agent-ux-session.md, explorations/annotation-agent-ux/index.html.

Repos touched: prompt-kit, annotations, agent-kernel, observatory. Canvas is a donor
(session/queue model) and a later host. docs-system untouched for now.

STATUS 2026-07-31: Phases 1 and 2 BUILT and green (Fable sub-agent fan-out, per Ford).
Clickable at canvas /config: `make traces` in canvas → http://localhost:4830/config.
Suites at completion: kernel 378/0, viewer-core 75/0, viewer-ui 308/19 (19 pre-existing
trace-db env failures), canvas-agent 619/2 (2 pre-existing), prompt-kit 510/0.
Locked semantics from the build: accept-all = n revisions in staging order; undo =
write-through re-point to prior content-addressed hash (append-only history); sidecar
on accept = attachAgentRun + resolved (proper `applied` status still Phase 3);
review-after-staging expected (first accept trips the stale-base guard for further
agent proposals — rebase remains the open gate); blocks with pending proposals are
uneditable by row replacement (edit-collision v1). Known gaps: mid-session composer
submits are session-only (not persisted to sidecar — Phase 3); prompt-editor model
alias defaults to layout model (CANVAS_AGENT_PROMPT_EDITOR_MODEL overrides).

## Phase 1 — Foundation (kernel + persistence) — DONE

1. Live-only annotation sidecar: `annotations.json` next to `prompt.json`, path-locked
   + expectedHash (port docs-server doc-ops pattern). CRUD on kernel catalog routes.
   Replaces the lab's in-memory store. [agent-kernel + prompt-kit]
2. Prompt-editor agent bundle in a kernel catalog: `agent.json` + prompt authored in
   prompt-kit itself + context (prompt-kit-authoring skill content + current
   PromptDocument rendered with node ids) + state. [agent-kernel]
3. Minimal session service: create session {agentName, baseHash, requests[]}, R-alias
   queue rendered into the prompt (port canvas user-requests.ts), SSE events for
   proposals/threads/status. [agent-kernel]
4. Agent tools v1: read_prompt, propose_transaction (semantic, id-relative ops the
   service compiles to PromptStep[]), resolve_request(done|declined, note).
   [agent-kernel]
5. Validation retry loop: every proposal runs validatePrompt against declared
   variables before it surfaces; failures bounce back to the agent automatically.
   [agent-kernel]

## Phase 2 — The loop (apply path + lab UI) — DONE

6. Apply path: accept → applySteps → canonicalize/hash → write-through disk revision
   per accept (decided) → prompt_revisions row (new source: "agent-run") → registry
   hot-swap. Undo = revertSteps (decide: revert-write vs new revision). [agent-kernel]
7. Inline composer in the real lab: insert above target in document flow, no scope
   breadcrumb. Replaces AnnotationComposerPopover usage inside the lab (popover stays
   for other hosts until they converge). [prompt-kit]
8. Inline staged-diff rendering in PromptFlowXml: del/add rows in place, per-request
   action bars, accept/reject/undo, draft banner. Steps→rendered-line mapping via
   rendered-line-model. [prompt-kit]
9. Wire AgentPromptLabContainer: session client, SSE consumption, sidecar CRUD,
   onAnnotationAgentRun/onUndoPatch become real. [agent-kernel viewer-ui]

## Phase 3 — Conversation

10. Agent-authored annotations: add author (human|agent) to the shared engine schema
    (canvas has createdBy; shared engine lacks it) + `applied` status. [annotations]
11. Inline thread bars: waiting-on-you questions and agent-pinned notes render in the
    file with inline reply (mockup Q9). add_annotation + reply_annotation tools.
    [prompt-kit + agent-kernel]
12. Queue rail: batch "Apply N notes" + doc-level message input + compact overview
    variant (mockup Q11 — default TBD interactively). [prompt-kit]
12b. Empty-state affordance for the loop (field-found 2026-07-31): the session strip
    and Apply button are invisible until an open agent-request annotation exists, so
    the feature does not announce itself — Ford hit this as "why is it not showing
    up". Add an idle-state hint in the lab/container ("Annotate this prompt to
    direct the agent") and consider surfacing the Annotate entry point more
    prominently. [prompt-kit + agent-kernel viewer-ui]

## Phase 4 — Observatory (the global viewer) — MOSTLY DONE

STATUS 2026-07-31 (later): Observatory is a pure proxy — item 13 is done: the
write-gate in src/server/app.ts covers catalog/** and prompt-edit-sessions/**
(mutations 403 unless project.writable; reads incl. SSE pass), the proxy forwards
session routes to the project harness (canvas already serves them), and the suite is
16/16 green including session-passthrough tests. Item 14a (traces) holds by
construction — prompt-editor runs are ordinary kernel runs in the project trace.db
Observatory already reads; spot-verify on first live session. Item 14b (stamp driving
request text into the revision record) is scouted but NOT built — full file/line map
in the scout report: prompt_revisions has no metadata column, no migration tooling
(CREATE TABLE IF NOT EXISTS only, packages/db/src/bootstrap.ts), precedent is
containers.metadata TEXT json column; wire from acceptProposal's savePrompt call
(service.ts ~:688) using entry.body. Dev loop: canvas `make traces` (:4820/:4830),
then observatory `bun run dev` with a registry.json per registry.example.json
(canvas project preconfigured, writable: true).
LATER 2026-07-31: two additions built. (a) Standalone prompt-kit kernel at
agent-kernel/examples/prompt-kit-kernel (port 4850, `bun run dev:prompt-kit`,
prompt-editor + simple-research targets, own trace.db) registered as the "Prompt Kit"
project — the agent is now first-class in Observatory, not a stowaway in canvas.
(b) Project launcher/supervisor in Observatory (Ford-confirmed design: harness stays
the single writer; Observatory owns the power switch): registry gains autoLaunch,
launchCommand now executes under /bin/sh with registry-dir cwd; supervisor never
double-launches manually-started harnesses, SIGTERM+grace on stop, 200-line log ring,
no auto-restart in v1; launch/stop/logs routes + UI states online/starting/offline/
crashed. All three projects autoLaunch: true (canvas dev:harness, simple-research
api :8788, prompt-kit :4850). Observatory suite 23/23. Still-open idea (not built):
cold-read fallback — serve agent/prompt/annotation READS from catalogRoots +
prompt_revisions when a harness is down, so views degrade to read-only instead of 503.
FIELD FIXES 2026-08-01: (1) Launcher env hygiene — supervisor was passing
Observatory's PORT=4890 to children, both harnesses bound :4890 (SO_REUSEPORT) →
user-visible 404s + liveness timeouts; fix strips PORT/HOST/HOSTNAME from child env,
harnesses get namespaced port vars (SIMPLE_RESEARCH_KERNEL_PORT etc.). (2) Vertical-
slice catalog visibility (Ford-confirmed design): catalog roots accept
{path, listed: false}; registry.list() = browseable, registry.listAll() = runtime;
unlisted agents stay spawnable/detail-fetchable — visibility controls browsing, not
authorization. Canvas lists only layout-editor (prompt-editor unlisted there);
prompt-kit kernel drops the simple-research root and lists only prompt-editor, whose
in-slice edit target is its own prompt (recursive editor-dev loop, per README).
Suites after both fixes: observatory 25/0, kernel 379/0, prompt-kit harness 1/0,
canvas-agent 619/2 pre-existing.

13. Host the full loop in observatory AgentsPage for writable projects (it already
    mounts the lab + gates editing on `writable`). [observatory]
14. Prompt-editor sessions traced end-to-end; runs visible in the observatory trace
    viewer; annotation→revision linkage (stamp driving request text into the revision
    record so the "why" survives sidecar deletion). [agent-kernel + observatory]

## Phase 5 — Converge + polish

15. Lift the session/queue layer into @codecaine-ai/annotations (pendingNotes,
    aliases, resolve semantics, run contracts) so prompt-kit / canvas / docs share
    it. [annotations + all hosts]
16. Canvas /config page wired as second host. [canvas]
17. Revision stats in the review surface (did the edit help). [observatory/prompt-kit]
18. Structural-move inline rendering beyond single-block (mockup Q10 follow-through).
    [prompt-kit]

## Interactive gates (resolve while building, not before)

- baseHash drift / rebase policy while a human types during a run
- Accept-all: squash to one revision or n
- Inline threads: always inline vs inline-only-while-unresolved
- Rail default: full cards vs queue overview vs dock
- Silent target widening without a breadcrumb — confirm it feels right
- Batch topology: one agent default; fan out only provably-disjoint request groups

## What does NOT change

- PromptDocument AST, steps/transactions, canonicalization, hashing — already built
- Kernel savePrompt/409 path — reused by the apply path, not replaced
- Board (canvas) agent and docs-system annotation flows — untouched until Phase 5

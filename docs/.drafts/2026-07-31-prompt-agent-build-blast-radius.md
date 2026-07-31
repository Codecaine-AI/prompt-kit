# Prompt-editor agent: build-out blast radius (2026-07-31)

Task map for taking the annotation→agent-edit→inline-review loop from mockup to real.
Strategy (Ford): initial build-out, then iterate interactively. Companion docs:
2026-07-31-annotation-agent-ux-session.md, explorations/annotation-agent-ux/index.html.

Repos touched: prompt-kit, annotations, agent-kernel, observatory. Canvas is a donor
(session/queue model) and a later host. docs-system untouched for now.

## Phase 1 — Foundation (kernel + persistence)

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

## Phase 2 — The loop (apply path + lab UI)

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

## Phase 4 — Observatory (the global viewer)

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

# 2026-08-03 — Dogfood session prompt

Status: ready to run. Paste the block below as the opening prompt of a fresh
thread started from the Core repo root. Written at the end of the layout +
annotation-model session, after the gesture implementation landed in
prompt-kit and agent-kernel (uncommitted).

---

<purpose>
Dogfood the prompt lab by using it for real work: editing the canvas agent's own
prompt through the lab + prompt-editor loop. You are the operator; Ford is the
auditor. Get the system running, walk its flows as a real user would, fix what
blocks real use, then drive a task-by-task audit where Ford uses the UI and
gives feedback. This session's output is a working, audited UX — not a test
suite.
</purpose>

<ground_truth>
Read before acting, in order:
- `prompt-kit/docs/.drafts/2026-08-03-prompt-lab-layout-and-annotation-model.md`
  — the settled design: dock layout, system/context/state + fixtures, and the
  three-gesture annotation model (Run now ⏎ default / Add to batch ⇧⏎ /
  Add to global ⌘⏎; run-now iterates at the section, accept resolves that one
  loop; batch applies as one narrated serial run).
- `prompt-kit/docs/.drafts/2026-07-31-annotation-agent-ux-session.md` and
  `...-prompt-agent-build-blast-radius.md` — prior decisions this builds on.
- `prompt-kit/explorations/lab-layout/k-annotate-ambient.html` — the approved
  interactive mockup; when UI behavior is ambiguous, this is the reference feel.
Implementation state: the gesture model is implemented (prompt-kit lab UI +
agent-kernel request-scoped sessions, both uncommitted, suites green apart from
19 pre-existing agent-kernel trace-viewer failures). VERIFY with git status in
both repos before assuming; both repos also carry unrelated uncommitted changes
from a parallel prompt-structure session (catalog/skills restructure, editor
generalized to no variables) — take them as intentional; never revert work you
didn't write.
</ground_truth>

<setup>
1. From the Core root, get the lab running against the CANVAS agent: discover
   the right host (canvas mounts the prompt-editor catalog; Observatory's
   agents page serves the lab UI — `make observatory` from Core root, dev
   instance seen on :4891; the prompt-kit agent server on :4850 is API-only).
   Pick whichever host actually serves the canvas agent's bundle and confirm
   the lab loads its prompt.
2. Confirm the dock renders (AGENT / view switcher / OUTLINE / DETAILS /
   REQUESTS / HISTORY), context assembles, and the State view has fixtures. If
   the canvas agent has no fixtures yet, add 2–3 plausible ones — that is
   dogfooding, not scope creep.
3. Known landmines: 19 agent-kernel test failures under trace-viewer/
   detail-panel are pre-existing (gitignored reference material) — ignore them.
   The fixtures directory convention is contested (`<bundle>/fixtures/*.json`
   lab-preview vs `state/fixtures/*.json` state-module samples) — if it bites,
   surface it to Ford as a decision, don't unilaterally reconcile. Kernel
   policy: one live edit session per target agent — a second launch gets a
   typed `agent-busy` 409; `dispose()` is the escape hatch. Two known
   bundle-side gaps (non-blocking): the prompt-editor state module expects an
   `appliedDiffs` key the kernel never sends (its `<diffs>` renders the
   placeholder), and the prompt is written for multi-request queues — a scoped
   single-request run works but the model isn't told it's scoped.
</setup>

<workflow>
1. OPERATE FIRST. Walk every flow yourself as a user, in the browser: view
   switching, outline scroll-spy, node select → DETAILS, agent-zone edit,
   annotate entry (ambient signals + bottom chip), all three composer gestures,
   the full run-now loop (shimmer → staged diff → thread reply re-stages →
   accept → resolved record in sidebar → revision in HISTORY), batch Apply with
   one-at-a-time narration, conflict chip, autosave whisper, Esc exit.
2. FIX AS YOU GO. When something is broken or unwired, diagnose and fix it
   (Claude/Opus sub-agents are authorized to implement directly in this
   session — Ford's standing override of the Codex-only rule). Keep everything
   uncommitted. Verify each fix by operating the flow again, not just by tests.
3. THEN AUDIT WITH FORD. Once flows work end-to-end, switch roles: give Ford
   ONE concrete task at a time in the live UI, each under two minutes, e.g.
   "Select the second rule in canvas's prompt, ⌘K, ask it to tighten the
   wording, Run now — tell me what felt wrong." After each task: collect his
   reaction, fix what he flags immediately, re-issue the task if the fix
   changes the feel, then move to the next. Cover the full gesture model and
   the batch flow across the audit, but let his feedback set the order and
   depth. His feedback outranks the spec: if he dislikes something the design
   doc prescribes, record it as a design change, don't defend the doc.
4. CLOSE. End with: what works, what changed during the session (files),
   what Ford flagged that remains open, and the recommended commit grouping.
</workflow>

<rules>
- Real usage over synthetic tests: prefer operating the UI to writing new test
  files; add tests only where a regression already bit you this session.
- One task in front of Ford at a time; never hand him a checklist.
- The canvas agent's prompt is live material — edits through the lab are real.
  Accept only proposals that genuinely improve it; discard junk staged during
  verification before handing Ford the audit.
- If a flow turns out not to have landed, say so plainly and scope with Ford:
  wire it now vs audit what exists.
</rules>

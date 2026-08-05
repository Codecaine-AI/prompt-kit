# Prompt lab: layout, turn views, and the annotation interaction model — Design Record (2026-08-03)

Status: **largely superseded** by
[`2026-08-05-annotation-queue-and-glass-panel.md`](2026-08-05-annotation-queue-and-glass-panel.md)
(and the 2026-08-04 dogfood iteration between them). Read this record for the
machinery and the reasoning; trust the successor wherever they conflict — notably:
the panel is a fixed Edit/AI-tabbed card (not zones in a margin dock), the composer
has ONE gesture (run-now retired; everything queues), comments live in the AI state
only, and the three-gesture model of §4 is gone.

Original status: settled (Ford × Fable iterative mockup session, 2026-08-03). Layout
and the State view are implemented; the annotation interaction model of §4 is settled
and being implemented.

Successor to the two 2026-07-31 drafts. Read those first for the machinery this record
sits on top of, and do not expect it repeated here:

- [`2026-07-31-annotation-agent-ux-session.md`](2026-07-31-annotation-agent-ux-session.md)
  — the AST-transaction claim, the canvas-derived session/queue model, staged review,
  "review is a state of the file, not a mode".
- [`2026-07-31-prompt-agent-build-blast-radius.md`](2026-07-31-prompt-agent-build-blast-radius.md)
  — the phased build-out, what shipped in phases 1–2, and the interactive gates left
  open. Several of those gates are closed by §4 below.
- [`2026-08-03-prompt-structure-design.md`](2026-08-03-prompt-structure-design.md) — the
  same-day companion covering prompt sections, context blocks, and the docs layout. That
  record owns the agent's content; this one owns the human's surface.

Mockup series: [`explorations/lab-layout/`](../../explorations/lab-layout/) (a → l).

---

## 1. The problem this session solved

The lab shell had accumulated three separate answers to "where does non-document
information go": a top statusbar (view tabs, token count, diagnostics, save status,
Annotate toggle), a collapsible right inspector with its own tab strip (AGENT, DETAILS,
REVISIONS), and an outline column at the pane's left edge. The statusbar mixed document
identity, transient status, and tool toggles in one strip — three unrelated jobs sharing
one row — and the inspector's tabs competed with the statusbar's tabs for the same
"which view am I in" question.

The session resolved this by deleting the top chrome outright and moving every
non-document surface into a single right margin dock of ordered zones.

## 2. The lab layout (implemented)

```text
┌──────────────────────────────────────────────────┬───────────────┐
│                                                  │ AGENT         │
│          ~96ch centered document column          ├───────────────┤
│                                                  │ VIEW          │
│          (no top chrome at all)                  │  system  1.2k │
│                                                  │  context 3.4k │
│                                                  │  state    412 │
│                                                  ├───────────────┤
│                                                  │ OUTLINE       │
│                                                  ├───────────────┤
│                                                  │ DETAILS       │
│                                                  ├───────────────┤
│                                                  │ REQUESTS      │
│                                                  ├───────────────┤
│                                                  │ HISTORY       │
│                                            ▲     │               │
│                                            █ ←───┼── scrollbar   │
│                            saved · 2s ago  ▼     │   at region's │
└──────────────────────────────────────────────────┴───────────────┘
```

| Property | Decision |
|---|---|
| Top chrome | None. The document starts at the top of the region. |
| Document column | Centered, ~96ch measure. |
| Scrollbar | At the far right of the scrolling region, not hugging the centered column. |
| Dock | ~280px, borderless. Zones separated by hairlines with uppercase micro-headers. |
| Autosave | A bottom-right whisper. System view only — nothing else is editable. |

### Zone order and rationale

| Zone | Contents | Why it sits here |
|---|---|---|
| AGENT | Agent identity (name, model, description). Always visible. | Identity is context for everything below it; it never scrolls out of the answer to "what am I editing". |
| VIEW | Switcher for system / context / state, each row carrying its own token count. | Replaces the statusbar's view tabs **and** absorbs the token display — a count belongs next to the thing it counts, not in a status strip. |
| OUTLINE | Section list with scroll-spy. | Per-view navigation; follows the document being shown. |
| DETAILS | Node inspector. Mounts only when a node is selected. | Deliberately demoted. It was a peer tab; it is now an occasional zone that does not exist until you ask for it. |
| REQUESTS | Annotate entry point, the queue, and resolved history. | The loop's home. See §4. |
| HISTORY | Revisions. Collapsed by default. | Real, rarely consulted, never worth permanent vertical space. |

OUTLINE, DETAILS, REQUESTS, and HISTORY are per-view zones: what they show follows the
VIEW selection above them.

### Dissolution map

The old statusbar and the old tabbed Inspect inspector are both gone. Every tab found a
zone:

| Was | Is now |
|---|---|
| Statusbar view tabs + token count | VIEW zone (counts inline per row) |
| Statusbar save status | Bottom-right autosave whisper |
| Statusbar Annotate toggle | REQUESTS zone entry point (and the mode itself, §4) |
| Inspector AGENT tab | AGENT zone |
| Inspector DETAILS tab | DETAILS zone (mounts on selection only) |
| Inspector REVISIONS tab | HISTORY zone (collapsed by default) |
| Left-edge outline column | OUTLINE zone |

One consequence worth stating: there is no longer a collapse-the-inspector control,
because there is no inspector. Zones that have nothing to say do not render.

## 3. The turn: system, context, state (implemented)

The lab now previews a whole turn, and the turn has three parts:

| Part | What it is | Editable |
|---|---|---|
| system ① | The prompt document | Yes — this is the editor |
| context ② | The assembled context blocks | No, read-only render |
| state ③ | The live session picture | No, read-only render |

This vocabulary is deliberately the trace viewer's. A trace shows a turn that was
recorded; the lab shows the hypothetical turn that *would* be sent. Same three parts,
same names, so moving between the lab and a trace requires no translation. The three-face
placement rule those numbers refer to is specified in
[`docs/30-prompt-structure/00-overview.md`](../30-prompt-structure/00-overview.md).

### Fixtures

State ③ has no meaning without inputs, so the State view is driven by fixtures.

```text
<agent-bundle>/fixtures/*.json     →  { label?, variables?, state? }
```

- Discovered per agent from its bundle; each file is one fixture.
- Selectable in the State view's FIXTURE zone.
- Rendering: through the bundle's own state module (seed → render) when it has one, with
  a pseudo-XML fallback otherwise. The fallback exists so a bundle without a state module
  still previews something honest rather than nothing.

**A fixture parameterizes the whole turn, not the state tab.** `variables` feed the
system-prompt render and `state` feeds the state render, so switching fixture changes
what every view shows — including the per-view token counts in the VIEW zone. This is the
point: token cost is a property of a turn under real inputs, not of a document in the
abstract.

Design intent, not yet built: **"from run…" fixtures** — seed a fixture from a real
recorded trace, so the previewed turn is one that actually happened. Sourcing is open
(§6).

## 4. The annotation interaction model (settled, being implemented)

### 4.1 Two ways of working

The session started from an observation about how prompt editing actually goes:

1. **Iterate on one section** — read, notice one thing, fix it, look at the result, fix
   the next thing. This is the dominant mode, and it is a tight loop: the wait between
   asking and seeing should be as short as possible, and it should happen where you are
   looking.
2. **A reviewing pass** — read the whole document, marking things as you go, then hand
   the marks over as a set. Here the point is *not* to interrupt the read, and the agent
   benefits from seeing all the marks at once because they interact.

One composer serves both, by offering three gestures instead of one submit.

### 4.2 The three gestures

| Gesture | Key | Effect |
|---|---|---|
| **Run now** | `Enter` (default) | File the request and immediately launch a request-scoped session for it alone. |
| **Add to batch** | `Shift+Enter` | File it into the sidebar queue. Nothing runs. |
| **Add to global** | `Cmd+Enter` | File it into the sidebar queue as a document-targeted note. Nothing runs. |

Document-target notes (the old `nodeId === docId` target) are **batch-only** — there is no
run-now for a global note. A note addressed to the whole document is a reconciliation
instruction ("make the terminology consistent", "this section conflicts with that one");
it is meaningless without the other requests it is meant to reconcile against.

### 4.3 Run now: processing lives at the section

Run now is the tight loop, and everything about it happens in the document, at the target:

1. The target row shimmers while the request is in flight.
2. An inline thread opens above the target row — the request, then the agent's replies.
3. The proposal stages **in place**: red/green rows at the target, per the 2026-07-31
   inline-diff direction.
4. Replying in the thread re-runs and re-stages. The loop can run several rounds.
5. **Accept resolves that one request and closes its loop.** The staged rows commit as a
   write-through revision, the thread collapses, and a resolved record files into the
   REQUESTS zone.

The sidebar's role during run-now is deliberately nothing: **in-flight run-now work never
appears in REQUESTS — only completed history does.** If the work is visible at the
section, showing it a second time in the margin is noise, and it would make the queue
mean two different things at once.

### 4.4 Batch and global: one session over the queued set

Queued notes (batch and global alike) sit in the REQUESTS zone with their aliases. The
zone carries one **Apply** action.

- Apply launches **one** session scoped to the queued set.
- The agent sees **all** requests together. This is the deliberate choice, not a
  simplification: the whole reason to batch is that the requests interact, and a global
  note is an explicit instruction to reconcile them.
- The UI narrates the run **one request at a time**: `processing R2 · 1 queued · 1 staged`.

That narration is presentation, not scheduling. The session is one agent with full
context; the interface simply reports a serial position through the set so the human can
follow what is being worked and what is already staged. Nothing about the narration
implies per-request isolation.

### 4.5 Conflict surface: `target changed since filed`

A queued note can go stale — most commonly because a run-now accepted between filing and
Apply and rewrote the very node the note points at.

- At file time, the note records a content fingerprint of its target.
- At display time, the fingerprint is compared against the target's current content.
- On mismatch the queue entry shows a `target changed since filed` chip.

The chip informs; it does not block. The human decides whether the note still says what
they meant. This is the smallest honest surface for the problem — full re-anchoring is
not attempted.

### 4.6 Mode feel: ambient shift (mockup K)

Entering annotate mode **shifts atmosphere, not layout**:

- A violet line at the left edge of the region.
- Hairlines throughout the dock pick up the same tint.
- A bottom-center breathing chip: `● annotating — esc to finish`. The dot's pulse is the
  status channel — it beats faster while a request is processing. On exit the chip morphs
  into a short summary of what the session did rather than vanishing.

The constraint that produced this: **nothing dims, nothing moves.** Earlier variants
dimmed the document or slid panels in to signal the mode; both broke reading, which is
the one thing annotate mode exists to support. If entering the mode costs you your place
on the page, the mode is fighting its own purpose. The chip is the only added element,
and it sits where no text is.

### 4.7 Unchanged foundations

Carried forward from 2026-07-31 without amendment:

- Edits are structural transactions against node ids — the agent proposes ops on the AST,
  never markdown.
- Proposals are staged; a human accepts.
- Accept is write-through: each accept lands as its own revision.

## 5. Provenance: the mockup series

`explorations/lab-layout/`, twelve variants, a → l, built and iterated in one session.
Contributions of the ones that mattered:

| Variant | Contributed |
|---|---|
| **F** — dock switcher | **Won the frame.** The VIEW-switcher-in-the-dock idea that replaced tabs and absorbed token counts. |
| **H** — annotate flow | ⌘K entry and document-level (global) targeting. |
| **I** — session mode | The session panel and its narration of a batch run. |
| **K** — ambient shift | **Won the mode feel** and the final three-gesture model (§4.2). |
| J, L | The motion-led and conversation-led alternatives. Not chosen — see below. |

Why J and L lost, since both were coherent: J (composer expands into a chat surface)
and L (annotate mode as an ongoing conversation) both made the *conversation* the primary
object. In practice the primary object is the document, and the conversation is scaffolding
around one section of it. K keeps the document primary and lets the conversation be local
and disposable — which is also what makes "Accept closes this one request's loop" feel
right rather than lossy.

## 6. Open questions

1. **Fixture "from run…" sourcing.** Seeding a fixture from a recorded trace is the stated
   intent; where the trace comes from (observatory query, local trace.db, paste) is
   undecided.
2. **Modeless run-now.** Should ⌘K annotate-and-run be available *outside* annotate mode?
   Run now is a complete interaction on its own; annotate mode's value is the reviewing
   pass. Making run-now modeless is attractive and unresolved.
3. **Accept-all / squash semantics for batch runs.** Mockup I demoed one combined revision
   for a batch; the built behavior from the 2026-07-31 phase is n revisions in staging
   order. Which one a batch Apply should produce is still open. (This is the
   "Accept-all: squash to one revision or n" gate from the blast-radius draft, still open.)
4. **Concurrent-session policy.** What happens when a run-now fires while a batch is
   mid-flight, or two run-nows overlap on adjacent nodes. Related: the existing stale-base
   guard and the unbuilt rebase path.

Also still open from the prior drafts and untouched here: baseHash drift while a human
types during a run, and inline-thread persistence beyond the session.

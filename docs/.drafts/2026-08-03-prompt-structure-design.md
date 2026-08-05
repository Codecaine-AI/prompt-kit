# Prompt Structure & Skills Layout — Design Record (2026-08-03)

Status: agreed (Ford × Fable interactive session, 2026-08-03). Migration executing.
Supersedes the 2026-08-03 skills trees (`packages/prompt-kit-agent/skills/*`,
`agent-kernel/skills/kernel-agent-authoring/`), which are deleted by this design.

## 1. Goals

- Make prompt-editor hookable. Dogfood target: prompt-editor editing its own
  prompt end to end is what "working" means for v1.
- Replace the accumulated skills material with a deliberate layout: docs carry
  how-and-why, context blocks carry what agents bake, behavior lives in agent
  prompts.

## 2. Agent roster

Two agents only. Nothing else is defined until a real need shows up.

- **prompt-editor** (exists) — works the annotation request queue of one target
  prompt, proposing staged transactions and resolving every request
  individually. Generalized: no spawn variables — the target agent's identity,
  render, hash, and queue all arrive as session data rendered into state ③.
- **prompt-author** (future; gated on a catalog create API) — takes a brief
  conversation, picks the type (single-output / agent), seeds a draft from the
  type template, and builds it up through the same transaction loop.

Parked, undefined: a renderer agent (the corpus seed exists in the old
`rendering-mechanics.md`; its job was never pinned).

## 3. The three-face placement rule

| Face | Carries | Change cost |
|---|---|---|
| System prompt ① | Behavior only: what the system does, how it operates, what the agent should do | Changing it = changing the agent |
| Context ② | Reference: how things are structured, formatting rules, how tools should operate. Each block self-describing (opens with what it is / when to consult it) | Add/adjust freely without touching the prompt |
| State ③ | The live picture, changes with every action: current prompt, diffs so far, open queue | Re-rendered every request; fields declared in `<state_structure>` |
| Tool layer | Tool definitions/schemas — on the agent itself, always present | Not prompt text at all |

Corollaries: no `<tools>` section in prompts (tool operation guidance is a
context block; schemas are the tool layer). No context-inventory section in
prompts (② blocks are self-describing).

## 4. Agent prompt — canonical section order

```xml
<purpose>            what the agent does, 1-3 sentences
<goal>               end state — only when distinct from purpose
<state_structure>    the state fields (section ③ shape), so workflow references them by name
<workflow>           phases, navigated by state
<error_handling>     only when failure modes need instruction
<success_criteria>   only when "done well" needs a testable bar
<rules>              non-negotiables, LAST — recency; replaces <reminders>, which is dead
</xml-order>
```

- `<rules>` last is intentional (recency); `<reminders>` no longer exists.
- `<state_structure>` describes state ③ only — not context blocks.
- Optional sections (`goal`, `error_handling`, `success_criteria`) earn their
  place or get cut.

## 5. Workflow structure

Locked core:

```xml
<workflow>
    <phase name="survey_queue">          <!-- snake_case verb phrase -->
        <objective>One or two sentences.</objective>
        <steps>
            1. Imperative step; branches as sub-bullets.
            2. Loop to step 1 until [condition on a state field].
        </steps>
    </phase>
</workflow>
```

- Phases always — every agent workflow uses phases; no stated count cap ("as
  few as the process honestly has").
- Nesting is fixed and shallow: `workflow > phase > field > list`. XML tags
  delineate where things start and stop; everything inside a field is bullets,
  numbers, or a sentence — never more tags.
- Navigation is by state, never turn count.
- PromptDocument mapping: phase and field tags are nested section nodes,
  steps/constraints are list nodes — existing node types only.

Provisional (allowed, unproven — revisit after real testing; mandate none,
invent nothing else): `<inputs>` (state fields the phase reads), `<outputs>`
(state fields it writes), `<constraints>` (phase-local rules), `<advance_when>`
(exit condition, vs. inline in steps).

## 6. Single-output prompt — canonical section order

```xml
<purpose>         imperative statement of what to produce
<instructions>    the input, plus how to handle it
<workflow>        internal stages — staged prompts only
<output_format>   literal skeleton
<constraints>     hard requirements, LAST — recency
```

- `<examples>` leaves the prompt: when a single-output prompt needs examples,
  they ride as a context block.
- Open note (recorded, not decided): `instructions` vs `workflow` may be
  redundant; revisit when more single-output prompts exist.

## 7. prompt-editor context ② blocks

| Block | Carries | Loop stage |
|---|---|---|
| `<prompt_document_model>` | The JSON tree it edits, and how the rendered MD corresponds | understand |
| `<state_reference>` | How its state ③ is shaped: stamped render format, node ids, hash, diffs-so-far | understand |
| `<tool_guide>` | Its five tools' semantics + the transaction op vocabulary | edit |
| `<section_guide>` | Lean per-section guide: what goes in each canonical section | edit |
| `<quality_guide>` | Anti-patterns, evaluation dimensions, formatting rules — the pass-before-done checklist | verify |

The loop these serve: human annotates a portion of the prompt → editor pulled
in → understand → edit → verify against quality/formatting guidelines.

prompt-author (when built) bakes the shared set plus its own tool guide;
`techniques` is pre-staged for it now.

## 8. Behavior dissolutions

- `prompt-editing/brief.md` (clarify discipline, nomenclature contract,
  conflict handling) → prompt-editor's (and later prompt-author's) prompt. The
  file dies.
- `prompt-editing/editing.md` splits: op vocabulary → the transaction-guide
  block; minimal-transaction + repair discipline → prompt-editor's
  `<rules>`/workflow.
- `prompt-authoring/methodology.md` procedure + clarification policy and
  `workflows/author-prompt.md` → prompt-author's prompt when that bundle is
  created (held here until then).

## 9. Layout: docs, blocks, and the death of skills

Three surfaces with different economics:

1. **Docs** — how and why; rationale included; read freely. Numbered decades in
   each repo's existing convention.
2. **Context blocks** — bytes an agent pays for on every request. Imperative,
   lean, zero rationale. Each opens with a one-line provenance pointer to the
   doc it distills; a gate test can verify the pointer names an existing doc.
3. **Skills** — deleted entirely in both repos. Content-bearing skills are
   documentation in a trenchcoat. Coding agents find the docs via each repo's
   CLAUDE.md pointer.

The boundary rule: behavior lives in an agent's prompt; reference lives in
block files served as context ②; the live picture lives in state ③. A file
that says "do step 1..N against the current session" is an agent workflow, not
a skill.

### prompt-kit

```
docs/30-prompt-structure/
  00-overview.md      three-face placement rule; map of the decade
  10-agent-prompt.md  the 7-section canonical order, per-section how & why
  20-workflow.md      workflow spec: phase shape, nesting, provisional fields
  30-single-output.md the 5-section order; examples-ride-as-context
  40-quality.md       anti-patterns, evaluation dimensions, formatting rules
  50-techniques.md    techniques + thinking frameworks, restraint stance

packages/prompt-kit-agent/catalog/_shared/blocks/
  10-document-model.md              ← distills 10-system-design/10-canonical-prompt-object.md
  20-section-guide-agent.md         ← distills 30-prompt-structure/10
  30-workflow-guide.md              ← distills 30-prompt-structure/20
  40-section-guide-single-output.md ← distills 30-prompt-structure/30
  50-quality-guide.md               ← distills 30-prompt-structure/40
  60-techniques.md                  ← distills 30-prompt-structure/50 (author-side, pre-staged)
  70-transaction-guide.md           edit-op vocabulary + repair mechanics

packages/prompt-kit-agent/catalog/prompt-editor/context/
  index.ts                          assembles the five blocks
  blocks/10-state-reference.md      editor-only
  blocks/20-tool-guide.md           editor-only
```

### agent-kernel

```
docs/30-authoring/
  00-overview.md        bundle anatomy + which file to touch for which change
  10-context-sidecar.md
  20-state-sidecar.md   links 20-implementation/20-kernel/60-agent-state.md, no duplication
  30-tools-sidecar.md
  40-validation.md
```

Prompt-section guidance in kernel docs is a pointer at
`prompt-kit/docs/30-prompt-structure/` (fixing the stale
`prompt-kit-authoring/` paths and dropping the `context_policy`/`tool_policy`
claims).

## 10. Migration map

New docs and blocks as per §9, sourced from the old skills files. Dissolutions
as per §8. Deletions: all three `packages/prompt-kit-agent/skills/` dirs,
`agent-kernel/skills/kernel-agent-authoring/` and stale `skills/README.md`,
`50-qa/rendered-review.md` unsalvaged (stale section order),
`40-techniques/overview.md`, both `SKILL.md` routers.
`prompt-skills-reference/` stays untouched as quarry.

prompt-editor bundle work: `context/index.ts` loads the five blocks
(`shared/authoring-blocks.ts` deleted); new bundle-local block files; state
gains a diffs-so-far field (+ fixtures); gate tests updated in the same
change.

Sequence:

1. Docs (both repos) — source of truth first.
2. Blocks distilled from docs.
3. prompt-editor context/state rewrite + tests.
4. Delete skills dirs, update CLAUDE.md pointers.
5. `prompt/prompt.json` restructure to the §4 order goes through the
   prompt-editor's own edit loop once hooked up — its first real test. Never
   hand-edited.

## 11. Deferred / open

- prompt.json restructure (§10 step 5) — after the loop works.
- prompt-author bundle — after the catalog create API exists.
- Workflow optional-field set — settle after testing different prompts.
- Single-output `instructions` vs `workflow` merge question.
- Session-service contract for the diffs-so-far state field.
- Renderer agent — undefined, parked.

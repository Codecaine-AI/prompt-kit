# Prompting Techniques
> Distilled from docs/30-prompt-structure/50-techniques.md — keep in sync.
Use this block when a named, observed failure risk may justify a prompting technique or thinking framework.

## Restraint

- Name the observable failure risk before selecting a technique.
- Use zero or one technique for most prompts; use two only when distinct risks require them.
- Prefer removing ambiguity, shortening the prompt, or tightening an instruction.
- Keep a technique only when removing it recreates the named risk.
- Translate frameworks into concrete instructions; omit framework labels and `<approach>` sections.

## Reasoning Techniques

| Technique | Use for | PromptKit mapping |
|---|---|---|
| Atom Of Thought | Separable multi-factor work that becomes path-dependent | Put decomposition, resolution, verification, and synthesis in workflow phases or steps. |
| Chain Of Verification | Factual claims that may be invented or unchecked | Put draft, claim identification, verification, and correction in workflow steps; add one testable `<success_criteria>` check when verification defines done. |
| Socratic Prompting | Hidden assumptions or missing information | Add a workflow step that inspects state and resolves or states assumptions; use final `<rules>` only for process-wide non-negotiables. |
| Self-Consistency | Consequential reasoning worth solving from multiple angles | Add explicit workflow steps to compare results, reconcile disagreements, and stop. |

## Quality Techniques

| Technique | Use for | PromptKit mapping |
|---|---|---|
| Inner Critic Loop | Predictably weak first drafts | Put draft, focused critique, and revision in workflow steps; exclude the private draft unless output instructions request it. |
| Negative Space Definition | A recognizable bad default | Put global prohibitions in final `<rules>` or `<constraints>`; keep situational prohibitions in the owning phase. |
| Decision Support | Decisions that flatten material tradeoffs | Put tradeoff, best-case, failure-case, and recommendation work in workflow steps; specify the decision shape in output instructions. |

## Structural Techniques

| Technique | Use for | PromptKit mapping |
|---|---|---|
| Semantic XML Architecture | Ambiguous structural boundaries | Use canonical section and workflow field names; keep substance in prose and lists; give context blocks semantic self-descriptions. |
| Contrastive Examples | A subtle quality boundary prose cannot define | Put one good/bad pair in a self-describing context block; add no `<examples>` section or example inventory. |
| Literal Output Format | Brittle or machine-consumed output shape | Put single-output skeletons in `<output_format>` as `codeBlock`; keep agent operation formats in workflow steps and reusable formats in context. |

## Framework Selection

| Framework | Select when |
|---|---|
| Inversion | Define failure modes to prevent a generic or useless result. |
| First Principles | Decompose novel technical or architectural work whose inherited assumptions may be wrong. |
| Contention | Develop opposing cases where disagreement exposes decision or strategy tradeoffs. |
| Constraint-First | Separate hard constraints, soft constraints, conflicts, and negative space in a tight brief. |
| Cross-Domain Transfer | Borrow another domain's model to unlock innovation or strategy; avoid precision tasks. |
| Recursive Depth | Revisit shallow claims, expert objections, and omitted hard parts before revising. |

Map a selected framework to the smallest concrete workflow steps that produce its effect.

## Placement Map

| Content | Placement |
|---|---|
| Agent procedure | Nested workflow `section` nodes with `orderedList` steps |
| Agent quality bar | `section("success_criteria", ...)` with testable list items |
| Single-output skeleton | `section("output_format", ...)` containing a `codeBlock` |
| Global non-negotiables | Final `rules` or `constraints` section with a short list |
| Supporting explanation | `paragraph`, `bulletList`, or `orderedList` inside the owning section |

- Keep examples, reusable frameworks, and detailed references in context.
- Never use `<reminders>`.
- Never invent workflow fields named after techniques.

---
covers: How to select and place optional prompting techniques and thinking frameworks in response to specific failure risks.
concepts: [techniques, thinking-frameworks, risk-selection, restraint]
depends-on: [10-system-design/70-prompt-structure/20-workflow.md, 10-system-design/70-prompt-structure/30-single-output.md, 10-system-design/70-prompt-structure/40-quality.md]
---

# Prompting Techniques

Techniques are available context, not a required checklist. They help when a
prompt has a specific, observable failure risk; they add noise when included
only because a technique sounds sophisticated.

Select from risk to technique. Name what is likely to go wrong, choose the
smallest intervention that changes that behavior, and leave everything else
out. Choosing no framework is a legal answer, and it is the right answer for
most straightforward prompts.

---

## Risk Before Technique

Reasoning and quality risks suggest one set of interventions:

| Risk | Useful starting point |
|------|-----------------------|
| Multi-factor reasoning becomes path-dependent | Atom Of Thought |
| Factual claims may be invented or left unchecked | Chain Of Verification |
| Missing information is likely to be hidden | Socratic Prompting |
| The first analysis will predictably be shallow | Inner Critic Loop or Recursive Depth |
| A decision is likely to flatten real tradeoffs | Decision Support or Contention |

Structure and originality risks suggest another:

| Risk | Useful starting point |
|------|-----------------------|
| Output defaults to generic language | Negative Space Definition or Inversion |
| Requirements conflict | Constraint-First |
| Output shape is brittle or machine-consumed | Literal Output Format |
| Novel work is trapped by conventional assumptions | First Principles or Cross-Domain Transfer |
| No concrete failure is visible | No technique or framework |

These are starting points, not bundles. One well-placed technique usually does
more than several overlapping instructions. If the risk can be removed by
cutting ambiguity or shortening the prompt, make that edit before adding a
reasoning procedure.

## Reasoning Techniques

### Atom Of Thought

Break a complex problem into independent sub-questions, resolve and verify each
one separately, then synthesize the results. Independence matters because an
early conclusion should not silently bias every later part of the analysis.

Use this for genuinely separable, multi-factor work. In an agent prompt, map
decomposition, resolution, verification, and synthesis to workflow phases and
their steps. In a staged single-output prompt, those stages may live in
`<workflow>` only when the added procedure earns its space.

### Chain Of Verification

Draft the answer, identify its factual claims, verify each claim, correct the
failures, and present only the verified version. This technique addresses
factual risk rather than general writing quality.

Map the procedure to workflow steps. When verification defines what "done
well" means for an agent, add a testable item to `<success_criteria>` as well;
do not repeat the whole verification procedure there.

### Socratic Prompting

Surface assumptions and missing information before committing to an answer.
This is useful when ambiguity would otherwise be converted into confident but
unsupported choices.

Prefer a workflow step that inspects the relevant state fields and resolves or
states missing assumptions. Promote the behavior to a final `<rules>` item only
when it is a process-wide non-negotiable, not a situational instruction.

### Self-Consistency

Solve the consequential part of a problem from more than one angle, compare the
results, and reconcile disagreements. The extra work is justified when accuracy
is worth the reasoning cost, not as a routine flourish.

Map self-consistency to explicit workflow steps so the comparison has a visible
purpose and stopping point. Avoid vague instructions such as "think several
times," which add cost without defining what the agent should compare.

## Quality Techniques

### Inner Critic Loop

Draft, identify the weakest parts, revise them, and return only the revised
result. Use this when first-draft quality is predictably insufficient and the
task benefits from a focused revision pass.

The critique and revision belong in workflow steps. They do not need their own
top-level sections, and the private draft does not belong in the requested
output unless the output format explicitly asks for it.

### Negative Space Definition

State what the result must not become. Negative space is useful when the likely
failure is a recognizable default, such as generic advice, invented evidence,
or prose where a literal structure is required.

Place hard, prompt-wide prohibitions in `<rules>` for agents or `<constraints>`
for single-output prompts; both sections come last in their respective
canonical orders. Keep situational prohibitions with the relevant workflow
phase instead of inflating the global list.

### Decision Support

Preserve tradeoffs, best-case conditions, and failure cases before recommending
a choice. This prevents strategy and judgment tasks from collapsing into one
unqualified recommendation too early.

Map the analysis to workflow steps and make the requested decision shape
visible in the output instructions. The prompt should ask for distinctions the
reader can act on, not merely a longer list of pros and cons.

## Structural Techniques

### Semantic XML Architecture

Use tags whose names describe the content's job. In canonical prompts, use the
defined section and workflow field names rather than inventing tags for every
idea. XML provides boundaries; prose and lists carry the substance.

Self-describing context blocks also use semantic names because each block must
say what it contains and when to consult it. This does not create a context
inventory inside the prompt.

### Contrastive Examples

A good and bad example can reveal a subtle distinction more efficiently than
several positive examples. Use one contrastive pair when prose alone cannot
make the quality boundary concrete.

Examples are reference material, so they ride as a self-describing context
block. They are not an `<examples>` section in a single-output prompt and do
not become an example inventory in an agent prompt.

### Literal Output Format

Show the exact output skeleton when structure matters. A literal skeleton
removes interpretation from requirements that would be brittle if described
only in prose.

For a single-output prompt, map the skeleton to `<output_format>`. For an
agent, keep operation-specific output instructions in the relevant workflow
step; put a reusable format reference in a self-describing context block.

## Thinking Frameworks

Thinking frameworks change how the model approaches a problem. Most prompts
need zero; use one, or occasionally two, only when a named reasoning failure
justifies the added structure.

### Inversion

Define failure before pursuing success. Use inversion when the main risk is a
generic or useless result and identifying failure modes will sharpen the target.

### First Principles

Decompose the problem into fundamentals before solving it. Use first-principles
reasoning for novel technical or architectural problems where inherited
assumptions may be wrong.

### Contention

Develop opposing cases before synthesizing a position. Use contention for
decisions and strategy where disagreement reveals material tradeoffs.

### Constraint-First

Identify hard constraints, soft constraints, conflicts, and negative space
before generating. Use it for tight briefs and design problems where satisfying
one requirement can quietly violate another.

### Cross-Domain Transfer

Borrow a mental model from another domain to force a non-obvious perspective.
Use it for innovation and strategy, not precision tasks where analogy may
distort the facts.

### Recursive Depth

Review the first analysis for shallow claims, expert objections, and omitted
hard parts, then revise. Use it where depth matters and a polished surface could
otherwise hide incomplete reasoning.

Framework names do not need to appear in the rendered prompt. Translate the
chosen framework into the smallest set of concrete workflow steps that produces
its benefit. An unexplained `<approach>` section is not part of either canonical
prompt structure.

## Canonical Placement

Techniques use the canonical sections; no technique introduces a section of
its own:

| Technique content | Placement |
|-------------------|-----------|
| Agent procedure | Workflow phases with numbered steps |
| Agent quality bar | `<success_criteria>` with a list of testable checks |
| Single-output skeleton | A literal skeleton in `<output_format>` |
| Global non-negotiables | The final `<rules>` or `<constraints>` section with a short list |
| Supporting explanation | Ordinary prose and lists inside the owning section |

Examples, reusable frameworks, and detailed references belong to context, not
to a prompt section. Do not map a technique to `<reminders>`; that section
does not exist. Do not invent workflow fields named after techniques. The
canonical structures already provide every prompt-side placement needed here.

## Efficiency

Technique restraint is also context restraint. Cut instructions the model
already follows, merge overlapping constraints, and use semantic boundaries
that clarify content without restating it. Prefer one strong contrastive
example over several weak ones, and state token or length priorities only when
the output has a real budget.

A technique has earned its place when removing it recreates the named failure
risk. If removal changes nothing, the smaller prompt is the better prompt.

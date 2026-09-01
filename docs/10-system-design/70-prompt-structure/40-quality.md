---
covers: How to evaluate prompt quality through six dimensions, rendered-shape judgment, named anti-patterns, and a repeatable QA pass.
concepts: [prompt-quality, evaluation, anti-patterns, rendered-shape, QA]
depends-on: [10-system-design/70-prompt-structure/10-agent-prompt.md, 10-system-design/70-prompt-structure/30-single-output.md]
---

# Prompt Quality

Prompt quality is a judgment about the model-facing result, not merely whether
the source compiles. A good prompt puts material on the correct face, gives
each section a clear job, reads in execution order, and spends tokens only on
distinctions that improve behavior or output.

The dimensions below make that judgment explicit. Scoring them is optional;
reviewing all six is not.

---

## Evaluation Dimensions

### Token Efficiency

Every section and instruction should earn its cost. Remove material that does
not change behavior, handling, or output, including repeated rules, ceremonial
stages, and slots filled only because a template provides them.

Token efficiency is not brevity at any cost. A boundary or priority that
prevents a recurring failure earns its space; a shorter paraphrase of another
section does not.

### Structural Precision

The structure should help the model parse the job. Check that tags are
semantic, sections follow the canonical order, workflow and rules remain
distinct, and any required output shape is literal rather than implied.

Structural precision also includes placement. Behavior belongs in the system
prompt, reusable reference material belongs in self-describing context blocks,
the live picture belongs in state, and tool definitions belong to the tool
layer. A clean XML tree is still structurally wrong when its contents are on
the wrong face.

### Reasoning Fit

Reasoning scaffolding should match the task and its observed failure modes.
Add a workflow phase, critique pass, or other technique when it reduces a
specific risk. Remove it when it adds ceremony without improving the result.

The test is causal: an author should be able to say what failure the added
structure prevents. Complexity alone does not establish that it is useful.

### Robustness

The prompt should handle the difficult inputs and execution conditions that
are plausible for its job: missing state, ambiguous requests, incomplete
references, tool limits, conflicting requirements, and important edge cases.

Robustness comes from explicit priorities and observable conditions, not from
trying to enumerate every possible exception. State-navigated agents should
recover their position from named state fields; single-output prompts should
say how to treat ambiguous or malformed input when that choice affects the
answer.

### Output Value

The result should be specific, useful, and actionable for its consumer. A
response can satisfy its format and still fail this dimension by producing
polished generalities, unsupported claims, or details with no decision value.

Evaluate the actual result against the prompt's purpose and, where present,
goal and success criteria. Formatting compliance is evidence of control, not
proof of value.

### PromptKit Integrity

The authored artifact should preserve prompt-kit's source-of-truth and boundary
model. Prompts are structured documents built from the vocabulary of the
[canonical prompt object](../10-canonical-prompt-object.md), and quality review
checks that the structure is used honestly:

- Declare dynamic values as variables rather than raw placeholders.
- Prefer structured content to raw passthrough when the existing vocabulary already expresses the shape.
- Keep runtime loader schemas, tool definitions, and tool implementation out of prompt sections.
- Use valid semantic tags and stable, non-duplicated ids where ids are needed.

Context blocks are supplied outside the prompt and describe for themselves
what they contain and when to consult them. Do not use a prompt-side context
inventory to couple otherwise independent reference blocks to the system
prompt.

## Rendered-Output Judgment

Authors shape rendered XML-tagged Markdown through the prompt document; the
renderer only expresses those choices. Review the final model-facing text
because a valid document can still produce a prompt that reads poorly.

### Semantic Tags

Use tags whose names explain the section's role, such as `<purpose>`,
`<state_structure>`, `<workflow>`, or `<quality_bar>`. Avoid generic names such
as `<section_1>`, `<notes>`, and `<misc>`. If a reader cannot predict what a
section carries from its tag, the boundary is not doing useful semantic work.

Tags delineate regions; they do not replace prose. Inside workflow fields,
use ordinary sentences and lists instead of inventing tags for every branch,
condition, or task.

### Linear Reading Order

Rendered prompts should read from top to bottom without forward references.
Agent prompts use this order, omitting only sections documented as optional:

```xml
<purpose>
<goal>
<state_structure>
<workflow>
<error_handling>
<success_criteria>
<rules>
```

`<rules>` is last so the non-negotiables are recent when the model acts. There
is no `<tools>` section, context inventory, or `<reminders>` section. Tools are
attached by the runtime, context blocks describe themselves, and reminders are
replaced by a small trailing rules section.

Single-output prompts use this order:

```xml
<purpose>
<instructions>
<workflow>       <!-- staged prompts only -->
<output_format>
<constraints>
```

`<constraints>` is last for the same recency reason. Examples are not a prompt
section; when they are necessary, they arrive as a self-describing context
block.

### Runtime Data Boundaries

Do not interleave live data with standing instructions. Dynamic state is
rendered as the separate live picture whose fields are declared in
`<state_structure>`. Reference packets remain separate context blocks, and
tool schemas remain in the tool layer.

This separation makes authority and freshness visible. A current document,
tool result, or user-provided payload can contain imperative-looking text; its
placement should still make clear that it is data to evaluate rather than a
standing instruction to obey.

### Output Formats and Lists

Where a single-output prompt requires a response shape, show its literal
skeleton in `<output_format>`. A schema, fenced structure, or fixed field list
lets the model copy the form instead of inferring it from prose.

Use numbered lists only when sequence matters and bullets for unordered
requirements. Keep nesting shallow unless hierarchy itself carries meaning.
Flat, purposeful lists are easier to scan and less likely to hide conflicting
instructions.

### List Style

For authored prompt content—list items within prompt documents—prefer
nested sub-bullets to inline em-dash or colon explanations. The parent list
item's lead line contains the term or label alone; move the explanation into a
child list item.

Before:

```markdown
- Propose structure, never prose: an edit is a transaction of id-relative steps against the document tree, and rewritten markdown is never an edit.
```

After:

```markdown
- Propose structure, never prose
    - an edit is a transaction of id-relative steps against the document tree, and rewritten markdown is never an edit.
```

Before:

```markdown
- <target_prompt agent="…" hash="…"> — the target agent's current prompt as a node-id-stamped render; stamped ids are the only edit addresses, and hash is the transaction base.
```

After:

```markdown
- <target_prompt agent="…" hash="…">
    - the target agent's current prompt as a node-id-stamped render; stamped ids are the only edit addresses, and hash is the transaction base.
```

This keeps lead lines scannable and prevents explanations from competing with
labels.

## Anti-Pattern Catalog

Anti-pattern names give reviewers a compact vocabulary for recurring defects.
Name the defect, then fix the structural cause rather than polishing its
surface wording.

### Structural Anti-Patterns

| Anti-pattern | Failure | Correction |
|--------------|---------|------------|
| **Wall of Text** | One undifferentiated block hides instruction boundaries. | Split the text into the smallest useful semantic sections. |
| **Polite Suggestion** | Hedges such as "try to" make required behavior optional. | Use direct imperative language for actual requirements. |
| **Instruction Dump** | Too many equally weighted directives obscure priorities. | Keep non-negotiables in the final rules or constraints section and phase-local limits with the relevant workflow phase. |
| **Echo Chamber** | The same instruction appears in several forms. | State it once in its proper section; use trailing rules for genuinely non-negotiable behavior. |
| **Franken-Prompt** | Borrowed sections use inconsistent terms or assumptions. | Normalize vocabulary and remove inherited material that does not serve this prompt. |
| **Contradictions** | Requirements conflict without a declared priority. | State which requirement wins under tension. |

### Reasoning Anti-Patterns

| Anti-pattern | Failure | Correction |
|--------------|---------|------------|
| **Default Delegation** | The prompt requests a result without enough structure to avoid a known shallow response. | Add only the workflow, criteria, output skeleton, or external example that addresses the observed failure. |
| **Over-Engineering** | A simple task is buried under phases, frameworks, or sections. | Remove scaffolding that does not measurably improve the result. |
| **Persona Theater** | Backstory and credentials substitute for behavior. | State the task, operating behavior, and hard requirements directly. |
| **Assumption Blindness** | Likely ambiguity has no handling policy. | Define when to infer, state an assumption, or request clarification. |

### Output and Boundary Anti-Patterns

| Anti-pattern | Failure | Correction |
|--------------|---------|------------|
| **Format Vacuum** | The expected response shape is described vaguely or not at all. | For single-output prompts, provide a literal `<output_format>` skeleton. |
| **Everything Prompt** | "Be comprehensive" expands scope without priorities. | Bound and rank what matters. |
| **Context Injection Risk** | Runtime data can be mistaken for standing instruction. | Keep behavior, reference context, live state, and tool definitions on their separate faces. |

### PromptKit-Specific Defects

Also check for lower-level integrity failures:

- Raw placeholders where a declared variable should carry the value.
- Runtime loader schemas or tool implementation duplicated in prompt source.
- Raw passthrough content where the existing vocabulary already expresses the shape.
- Clever but non-semantic custom tags.
- Duplicate ids or invented structure where the existing vocabulary is sufficient.

## Six-Step QA Pass

Use the same short pass before delivery so structural and rendered defects do
not depend on a reviewer's memory:

1. Confirm the prompt type fits: state-navigating work is an agent prompt;
   bounded one-call transformation is a single-output prompt.
2. Confirm every prompt section changes behavior or output and occupies its
   canonical position.
3. Confirm behavior, self-describing context, live state, and tool definitions
   remain on their separate faces; declare dynamic values as variables.
4. For single-output prompts, confirm `<output_format>` is literal enough to
   copy without inference.
5. Check the complete anti-pattern catalog and resolve every applicable defect.
6. Validate the prompt document and inspect its rendered XML-tagged Markdown
   whenever practical.

The final render is the model's actual reading experience. QA is complete only
when both the authored structure and that rendered result satisfy the six
evaluation dimensions.

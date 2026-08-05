---
covers: The prompt structure layer for prompt-kit, including placement boundaries, agent prompts, workflows, single-output prompts, quality, and optional techniques.
type: overview
concepts: [prompt-structure, system-prompts, context, state]
---

# Prompt-Kit Prompt Structure

Prompt structure begins with placement. Behavior, reusable reference material,
and live session data have different lifecycles, so combining them makes prompts
harder to change and gives the model a less reliable picture of its work. This
layer explains where each kind of material belongs and how the system-prompt
portion should be shaped.

---

## File Tree

```text
30-prompt-structure/
├── 00-overview.md       (this file) Placement rule and navigation
├── 10-agent-prompt.md   Canonical structure for multi-turn agent prompts
├── 20-workflow.md       Phase structure and state-based navigation
├── 30-single-output.md  Canonical structure for bounded one-call prompts
├── 40-quality.md        Evaluation dimensions and prompt anti-patterns
└── 50-techniques.md     Optional techniques selected by failure risk
```

## The Three-Face Placement Rule

An agent reads three distinct faces of model-facing material. A fourth layer,
its tools, is attached by the runtime rather than written into prompt text.

| Face | Carries | Change cost |
|------|---------|-------------|
| System prompt ① | Behavior only: what the system does, how it operates, and what the agent should do | Changing it means changing the agent |
| Context ② | Reference material: how things are structured, formatting rules, and how tools should operate. Each block opens by saying what it is and when to consult it | Add or adjust freely without touching the prompt |
| State ③ | The live picture: the current document, diffs so far, open queue, and other data that changes with action | Re-rendered every request; fields are declared in `<state_structure>` |
| Tool layer | Tool definitions and schemas attached to the agent and always present | Not prompt text at all |

This separation is a working-memory decision, not merely an organizational one.
The model should be able to distinguish enduring behavior from material it can
consult and from the current facts it must act on. Loading only relevant context
also reduces stale or unrelated material competing for attention.

The placement rule has two direct corollaries. Prompts do not contain a
`<tools>` section because schemas and tool descriptions belong to the tool
layer. They also do not inventory context blocks: each context block is
self-describing, so it can be added, removed, or revised without changing the
agent's prompt.

Runtime data remains outside the stable prompt. Small dynamic values, loaded
references, the current user turn, conversation history, tool results, and app
state are supplied by the host as context or state according to their role.
Interleaving them with standing behavior makes freshness and authority harder
for the model to judge.

## Boundary Rule

Behavior lives in an agent's system prompt. Reference lives in context blocks.
The live picture lives in state. This boundary also distinguishes documentation
from executable procedure: a file that says "do step 1 through N against the
current session" is an agent workflow, not documentation. Documentation may
explain that workflow's structure and rationale, but it does not perform the
session's work.

## Contents

### [10-agent-prompt.md](10-agent-prompt.md)

Defines the canonical section order for a state-navigating, multi-turn agent
prompt and explains when each optional section earns its place.

### [20-workflow.md](20-workflow.md)

Defines the required phase shape, shallow nesting model, state-based navigation,
and provisional phase fields.

### [30-single-output.md](30-single-output.md)

Defines the smaller structure for one-call transformations with a single
bounded output.

### [40-quality.md](40-quality.md)

Combines quality dimensions, named anti-patterns, rendered-shape judgment, and
the minimum QA pass.

### [50-techniques.md](50-techniques.md)

Catalogs optional prompting and thinking techniques chosen in response to a
specific failure risk.

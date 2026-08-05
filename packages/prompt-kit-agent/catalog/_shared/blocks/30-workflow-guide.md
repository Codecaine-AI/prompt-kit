# Workflow Guide
> Distilled from docs/30-prompt-structure/20-workflow.md — keep in sync.
Use this block when authoring or reviewing a state-navigated workflow section.

## Required Shape

```xml
<workflow>
    <phase name="snake_case_verb_phrase">
        <objective>
            State the result this phase creates.
        </objective>
        <steps>
            1. Perform the first action.
            2. Perform the next action.
        </steps>
    </phase>
</workflow>
```

- Include one or more named phases; never write a steps-only workflow.
- Use as few phases as the procedure honestly requires.
- Name each phase with a stable snake-case verb phrase.
- State each objective in one or two sentences; name the phase result without restating every step.
- Write steps as a numbered imperative list.
- Keep branch details in sentences or nested list items.

## Nesting

- Keep nesting fixed: `workflow > phase > field > list`.
- Use tags only to delineate structural regions.
- Keep procedural leaves as lists.
- Do not add tags for tasks, branches, conditions, checks, or loop bodies.

## State Navigation

- Reference only state fields declared in the agent prompt's `<state_structure>`.
- Select the current phase from declared state on every request.
- Never navigate by turn count, call count, retry count, or elapsed calls.
- Express phase entry, continuation, and exit conditions against observable state.
- Write loops as `Loop to step N until [condition on a state field].`
- Name the exact return step and the exact observable condition.

## Optional Fields

Treat these fields as provisional, allowed, and unproven:

- `<inputs>`: list state fields the phase reads.
- `<outputs>`: list state fields the phase writes.
- `<constraints>`: list rules local to the phase.
- `<advance_when>`: state the phase exit condition.

- Mandate none of these fields.
- Invent no additional workflow fields.
- Omit optional fields when `<objective>` and `<steps>` are unambiguous.

## PromptDocument Mapping

- Map `workflow`, `phase`, and field tags to nested `section` nodes.
- Store the phase name as a section attribute.
- Map objective text to a `paragraph` node.
- Map steps to an `orderedList` node.
- Map constraints to a `bulletList` or `orderedList` node.
- Map optional-field content with existing paragraph or list nodes.
- Add no workflow-specific node type.

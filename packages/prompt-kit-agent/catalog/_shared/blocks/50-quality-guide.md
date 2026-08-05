# Prompt Quality Checklist
> Distilled from docs/30-prompt-structure/40-quality.md — keep in sync.
Use this pass-before-done checklist before delivering any authored or edited prompt.

## Evaluate the Prompt

- **Token efficiency:** Does every section and instruction change behavior, handling, or output?
- **Structural precision:** Does each item occupy the correct face, semantic section, and canonical position?
- **Reasoning fit:** Does each phase, critique pass, or technique prevent a specific observed failure?
- **Robustness:** Does the prompt handle plausible ambiguity, missing state, incomplete references, tool limits, conflicts, and edge cases?
- **Output value:** Is the result specific, useful, actionable, supported, and aligned with purpose and success criteria?
- **PromptKit integrity:** Does the artifact preserve the PromptDocument model, structured nodes, variables, stable ids, and runtime boundaries?

## Remove Anti-Patterns

- **Wall of Text:** One block hides boundaries; split it into the smallest useful semantic sections.
- **Polite Suggestion:** Hedges make requirements optional; use direct imperatives.
- **Instruction Dump:** Equal-weight directives hide priorities; put non-negotiables last and phase-local limits in their phase.
- **Echo Chamber:** One instruction appears repeatedly; state it once in its proper section.
- **Franken-Prompt:** Borrowed parts conflict in terms or assumptions; normalize vocabulary and remove irrelevant inheritance.
- **Contradictions:** Requirements conflict without priority; declare which requirement wins.
- **Default Delegation:** A known shallow response lacks targeted structure; add only the workflow, criteria, output skeleton, or external example that prevents it.
- **Over-Engineering:** Simple work is buried under scaffolding; remove phases, frameworks, and sections that do not improve results.
- **Persona Theater:** Backstory substitutes for behavior; state the task, operating behavior, and hard requirements.
- **Assumption Blindness:** Likely ambiguity has no policy; define when to infer, state an assumption, or request clarification.
- **Format Vacuum:** Response shape is vague or absent; provide a literal `<output_format>` skeleton for single-output prompts.
- **Everything Prompt:** Broad completeness expands scope without priority; bound and rank what matters.
- **Context Injection Risk:** Runtime data looks like standing instruction; separate behavior, reference context, live state, and tools.

## Preserve PromptKit Integrity

- Replace raw placeholders with declared `variable()` nodes.
- Keep runtime loader schemas, tool definitions, and tool implementation out of prompt sections.
- Replace `raw()` with structured builders when an existing node expresses the shape.
- Replace clever or generic tags with semantic tags.
- Remove duplicate ids; use the existing node vocabulary.

## Judge the Rendered Format

- Use semantic tags such as `<purpose>`, `<state_structure>`, `<workflow>`, and `<quality_bar>`.
- Use tags to delineate regions; use sentences and lists for leaf content.
- Keep agent sections linear: `<purpose>`, `<goal>`, `<state_structure>`, `<workflow>`, `<error_handling>`, `<success_criteria>`, `<rules>`.
- Keep `<rules>` last; omit `<tools>`, context inventories, and `<reminders>`.
- Keep single-output sections linear: `<purpose>`, `<instructions>`, optional `<workflow>`, `<output_format>`, `<constraints>`.
- Keep `<constraints>` last; supply necessary examples as self-describing context blocks.
- Keep behavior in the prompt, reference packets in context blocks, live data in state, and schemas in the tool layer.
- Treat imperative-looking runtime content as data, not standing instruction.
- Show a literal schema, fenced skeleton, or fixed field list in `<output_format>`.
- Use numbered lists only for sequences and bullets for unordered requirements.
- In authored PromptDocument list items, keep the term or label alone on the lead line; move colon/em-dash explanations into a child bullet so labels stay scannable and explanations do not compete with them.

```md
Before: - Propose structure, never prose: an edit is a transaction of id-relative steps against the document tree, and rewritten markdown is never an edit.
After:  - Propose structure, never prose
          - an edit is a transaction of id-relative steps against the document tree, and rewritten markdown is never an edit.
```

- Keep nesting shallow unless hierarchy carries meaning.

## Final Pass

1. Confirm the prompt type: use an agent prompt for state-navigating work and a single-output prompt for bounded one-call transformation.
2. Confirm every section changes behavior or output and occupies its canonical position.
3. Confirm prompt, context, state, and tool faces remain separate.
4. Confirm single-output formats are literal enough to copy without inference.
5. Resolve every applicable anti-pattern and integrity defect above.
6. Run PromptDocument validation and inspect the rendered XML-tagged Markdown.

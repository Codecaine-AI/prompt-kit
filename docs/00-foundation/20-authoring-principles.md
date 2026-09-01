---
covers: The prompt authoring principles behind prompt-kit documents, rendering, transforms, and validation.
concepts: [authoring, composition, rendering, validation]
depends-on: [00-foundation/10-purpose-and-boundary.md]
---

# Authoring Principles

Prompt-kit treats prompts as structured documents first and rendered text
second. The structure stays flexible enough for prompt authors while giving
kernels and editors a stable object to inspect and manipulate. This page holds
the reasoning behind that stance; the mechanics live in
[System Design](../10-system-design/00-overview.md).

---

## Structured But Not Brittle

Prompt documents should be typed, but they should not force every prompt into a
single narrow shape. A small vocabulary of reusable blocks covers the common
cases, and authors can extend beyond it when a prompt family needs a different
structure. Recommended layouts are conveniences, not the only valid layouts.
The block vocabulary itself is defined in
[10-canonical-prompt-object.md](../10-system-design/10-canonical-prompt-object.md).

## Linear Reading Stays Primary

Agents still read prompts linearly. Whatever structure the document carries,
the default rendering must produce a clear, stable text document that a model
reads naturally. The AST exists to improve authoring, validation,
transformation, and UI rendering, not to make the final prompt hard to read.

## Stable Ids Make Composition Practical

Nodes carry stable ids so prompt pieces can be replaced, omitted, or inserted
without string surgery. A prompt family can keep a shared base prompt and swap
sections for a specific runtime, evaluation, or host application. The
operations built on this hook are specified in
[40-composition-and-transforms.md](../10-system-design/40-composition-and-transforms.md).

## Rendering Is Separate From Structure

The canonical prompt object is not tied to one renderer. A readable default
output serves as system prompt text, while other consumers build custom
renderers from the same AST for diff views, editors, diagnostics, or
alternative prompt formats. The renderer boundary is specified in
[30-rendering-model.md](../10-system-design/30-rendering-model.md).

## Dynamic Context Belongs Around The Prompt

Prompt-kit can describe that a prompt expects to use a context packet, but it
does not load that packet. Runtime context is owned by the kernel or host app.
That split keeps stable behavioral instructions in the prompt and dynamic data
in the runtime context pipeline.

## Validation Should Catch Structure, Not Freeze Style

Validation exists to give authors a solid floor: a document that renders,
composes, and round-trips through tools without silent breakage. It should
catch structural integrity problems, not reject every custom section or
metadata shape. Prompt authors need a floor, not a narrow hallway. The
diagnostic rules live in
[50-validation-contract.md](../10-system-design/50-validation-contract.md).

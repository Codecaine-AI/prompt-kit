---
covers: The prompt authoring principles that guide prompt-kit documents, templates, renderers, and transforms.
concepts: [authoring, composition, rendering, validation]
depends-on: [00-foundation/10-purpose-and-boundary.md]
---

# Authoring Principles

Prompt-kit treats prompts as structured documents first and rendered text second.
The structure stays flexible enough for prompt authors while giving kernels and
editors a stable object to inspect and manipulate.

---

## Structured But Not Brittle

Prompt documents should be typed, but they should not force every prompt into a
single narrow shape. The core schema defines a small set of reusable blocks:
sections, paragraphs, lists, fields, examples, code blocks, raw text, context
usage notes, variables, and references.

Templates provide recommended layouts. They are not the only valid layouts.
Consumers can create custom sections, custom metadata, and custom archetype names
when a prompt family needs a different structure.

## Linear Reading Stays Primary

Agents still read prompts linearly. The default renderer should produce a clear,
stable text document with semantic XML tags and familiar Markdown inside those
tags. The AST exists to improve authoring, validation, transformation, and UI
rendering, not to make the final prompt hard to read.

## Stable Ids Make Composition Practical

Any node can carry an `id`. Stable ids are the hook for replacing, omitting, or
inserting prompt pieces without string surgery. A prompt family can keep a shared
base prompt and swap sections for a specific runtime, evaluation, or host
application.

## Rendering Is Separate From Structure

The canonical prompt object should not be tied to one renderer. XML-tagged
Markdown is the default renderer because it is readable and works well as system
prompt text. Other consumers can build custom renderers from the same AST for
diff views, editors, diagnostics, documentation pages, or alternative prompt
formats.

## Dynamic Context Belongs Around The Prompt

Prompt-kit can describe that a prompt expects to use a context packet, but it
does not load that packet. Runtime context is owned by the kernel or host app.
That split keeps stable behavioral instructions in the prompt and dynamic data
in the runtime context pipeline.

## Validation Should Catch Structure, Not Freeze Style

Validation should catch invalid schema versions, duplicate ids, invalid XML tag
names, missing context ids, and undeclared variables when declarations are
provided. It should not reject every custom section or metadata shape. Prompt
authors need a solid floor, not a narrow hallway.


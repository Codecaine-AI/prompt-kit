---
covers: The five block types the prompt editor can create, how the remaining prompt-kit node types behave in the editor, and why a section's title property is never rendered.
concepts: [blocks, vocabulary, section, attrs, nodes]
design_refs: [10-system-design/10-canonical-prompt-object.md, 10-system-design/30-rendering-model.md]
---

# Block Vocabulary

The editor creates five block types. It renders and edits the whole prompt-kit
node set, but it does not offer every node type as something an author can add.

---

## Creatable Blocks

The insert palette, the slash menu, and markdown autoformat share one
vocabulary, in one order, so the surfaces never disagree about what a prompt is
made of.

| Label | Node type | Slash aliases | Autoformat |
|-------|-----------|---------------|------------|
| Text | `paragraph` | `paragraph`, `para`, `p`, `body`, `plain` | — |
| Section | `section` | `tag`, `xml`, `element`, `group`, `wrap` | — |
| Bullets | `bulletList` | `bullet`, `list`, `ul`, `unordered`, `dash`, `-` | `- `, `* ` |
| Steps | `orderedList` | `step`, `ordered`, `numbered`, `number`, `list`, `ol`, `1.` | `1. `, `1) ` |
| Code | `codeBlock` | `codeblock`, `snippet`, `fence`, `pre`, ` ``` ` | ` ``` ` |

Section carries no `container` or code-adjacent synonym, because those would
pull it into the `/co` query that must belong to Code alone.

## Non-Creatable Nodes

`field`, `example`, `contextUsage`, and `raw` are part of the model and are
fully supported by the surface — they render into rows, they are inline-editable
where they have an editable value, they can be selected, moved, duplicated, and
deleted, and the inspector edits their properties. They are simply not offered
as things to create from this UI.

| Node type | Row behavior | Inline-editable value |
|-----------|--------------|-----------------------|
| `field` | One content row plus any children | `value` |
| `example` | Open and close tag rows | None; the open tag is structural |
| `contextUsage` | Open and close tag rows | None; the open tag is structural |
| `raw` | One content row per line | `value`, as one multi-line editor |

`canHaveChildren` reports `section`, `example`, `contextUsage`, and `field` as
container blocks; only those offer an add-child action.

## A Section's Name Is Its Tag

`SectionNode` carries an optional `title` property, and **the XML renderer never
reads it**. `renderSection` composes the open tag from `tag` and `attrs` only.
The one place `title` is consumed is `renderExample`, which turns an
`ExampleNode`'s title into a `title="…"` attribute on the `<example>` tag it
synthesizes.

The consequence for any editing UI: a "title" field on a section would be dead
input. It would change the document, change the content hash, and change nothing
about the rendered prompt. The editor therefore has no such field. A section's
name is its `tag`, edited in place on the open-tag row, and everything else that
appears in the open tag is an entry in `attrs` — what the inspector calls the
section's fields.

`sanitizeSectionTag` keeps a typed tag renderable: whitespace becomes `_`, and
the characters that would break the tag out of its own brackets are dropped.
Anything else is left exactly as typed, so an invalid name still reaches
validation — which reports it and blocks the save — rather than being silently
rewritten under the caret. Attribute keys get the parallel treatment from
`sanitizeAttributeKey`.

## Block Actions

Every block carries one left-edge affordance, pinned just inside the gutter at
its first row. It is the drag handle, and clicking it opens a compact menu.

| Action | Availability |
|--------|--------------|
| Rename | Sections; the menu's type header doubles as the tag field |
| Duplicate | All blocks |
| Add child | Container blocks |
| Delete | All blocks |

Creating a block is a typing gesture — Enter, a markdown marker, or the slash
menu — so no insert button competes for the same few pixels.

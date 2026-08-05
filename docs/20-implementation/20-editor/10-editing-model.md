---
covers: How the prompt editor keeps the PromptDocument canonical, projects it into editable rows, commits every edit as a step, and keeps the caret continuous across structural moves.
concepts: [editing-model, line-model, steps, caret, projection]
design_refs: [10-system-design/10-canonical-prompt-object.md, 10-system-design/30-rendering-model.md, 10-system-design/40-composition-and-transforms.md]
---

# Editing Model

The editor edits a `PromptDocument`. The XML text on screen is a rendered
projection of that document, and every keystroke that changes structure or text
is committed as a step through a transaction log.

---

## One Source Of Truth

The surface never parses the rendered string back into nodes. A row knows which
node it came from, an editor knows which property of that node it edits, and a
commit writes that property back into the document.

| Concern | Owner |
|---------|-------|
| Canonical state | `PromptDocument` held by the host's history |
| Rendered text | `renderXmlMarkdown(prompt)` |
| Editable rows | `buildXmlLineModel(prompt)` |
| Node lookup and mutation | `@codecaine-ai/prompt-kit/ui` editor helpers |
| Undo/redo, dirty state | `createPromptLabHistory` over `createTransactionLog` |

## Line Model

`buildXmlLineModel(prompt, { variables })` returns one `XmlLine` per rendered
line plus the whole-document render:

```ts
interface XmlLine {
  text: string;
  node: PromptBlockNode;
  nodeId: string;
  depth: number;
  role: "gap" | "open" | "close" | "content" | "fence" | "item";
  editable: boolean;
  itemIndex?: number;
  contentLineIndex?: number;
}

interface XmlLineModel {
  lines: XmlLine[];
  rendered: string;
}
```

The module mirrors prompt-kit's `renderNode` / `renderNodes` exactly: same
indentation, same blank line between sibling blocks, same framing around a
section body. The invariant is that joining every line's `text` with `\n` equals
`renderXmlMarkdown(prompt)`, and `line-model.test.ts` asserts it. That
invariant is why the editor's line-number gutter matches the read-only view
line for line, and why a renderer layout change must be mirrored here in
lockstep.

Roles carry the editability rule:

| Role | Emitted for | Editable |
|------|-------------|----------|
| `gap` | Blank separator between sibling blocks | No |
| `open` | Container opening tag | Only a `section` tag with no rendered attributes |
| `close` | Container closing tag | No |
| `content` | Paragraph, field, raw line, code line | Yes |
| `fence` | Code block ``` lines | No |
| `item` | One list item line | Yes |

A section's open tag is editable because the tag *is* the section's name; the
angle brackets are drawn as non-editable trim around the editor. An `example` or
`contextUsage` open tag derives its text from other fields, and an attributed
tag renders more than a name, so both stay structural.

## Edit Points

`collectEditPoints(lines)` reduces the row list to the ordered caret targets:
every editable line, except that multi-line leaf nodes (`raw`, `codeBlock`)
contribute a single point anchored on `contentLineIndex === 0`, because they
edit as one textarea.

```ts
interface EditPoint {
  row: number;
  nodeId: string;
  itemIndex?: number;
}
```

Arrow navigation, Backspace, and Delete all resolve against this list, so
"the previous editable thing" has one definition on the whole surface.

## Committing Text

`editorValueForLine(node, line)` produces the editable string for a row, and
`commitEdit` writes it back. Each node type has exactly one editable property:

| Node type | Editable value |
|-----------|----------------|
| `section` | `tag` (sanitized by `sanitizeSectionTag`) |
| `paragraph` | `content`, via `inlineToEditableText` / `editableTextToInline` |
| `field` | `value` |
| `raw` | `value` |
| `codeBlock` | `code` |
| `bulletList` / `orderedList` | The addressed item's `content` |

Text commits run on every keystroke. Structured inline nodes survive the round
trip because `editableTextToInline` re-parses `{{name}}` and `{{kind:name}}`
tokens back into variable and reference nodes.

## Steps, Not Snapshots

Block edits route through the `*WithStep` helpers exported from
`@codecaine-ai/prompt-kit/ui` and hand their `PromptStep[]` to the host
alongside the resulting document:

```ts
type PromptFlowChangeHandler = (
  prompt: PromptDocument,
  selectedNodeId?: string,
  steps?: PromptStep[],
) => void;
```

A call without `steps` is a document-metadata edit (title or description), which
is not node-scoped and therefore not representable as a step. The host commits
steps to the transaction log and metadata to an overlay; both share one
undo/redo stack. See [50-application-shell.md](50-application-shell.md).

A structural gesture that takes two or three steps is handed over as one array
and committed as one transaction, so one undo takes back the whole move.

## Caret Continuity

The surface stores one edit target:

```ts
type EditCaret = number | "end" | readonly [number, number];

interface EditTarget {
  nodeId: string;
  itemIndex?: number;
  caret?: EditCaret;
}
```

Moving the caret goes through a single function that increments a monotonic
`seq` and stores it on the target. Rows key their editor on `edit:${seq}`, so
every move — split, merge, arrow step, click, conversion — remounts the
textarea. `GrowTextArea` applies `initialCaret` once on mount, clamping a
number to the value length, resolving `"end"` to the end, and treating a
`[start, end]` pair as a selection so the next keystroke types over it.

The `seq` also disambiguates blur. When a structural key replaces the editor,
the outgoing textarea fires a late blur; the surface ignores it because the
current target's `seq` no longer matches the one that blurred.

Exactly one row of a node may mount the editor at a time. A code block draws two
fences, a section draws two tags, and a list draws a row per item; the surface
resolves which row owns the caret from `role`, `itemIndex`, and
`contentLineIndex`. Two editors sharing a target would fight for focus and the
loser's blur would cancel the winner's edit.

## Click To Caret

`caretForRowClick` is the single click-to-caret implementation for every
editable row. It resolves the click point to a text offset with
`caretRangeFromPoint` / `caretPositionFromPoint`, walks the row's text nodes to
convert that into a plain-text offset, then maps display offset to editable
offset by subtracting the row's display prefix — a plain row's leading indent,
or `0` for list-item content whose marker is drawn as separate trim. For `raw`
and `codeBlock` rows the clicked content line index is folded back into an
offset within the single multi-line value. A point that resolves to no text
position falls back to caret-at-end, never caret-at-zero.

## Module Map

| File | Responsibility |
|------|----------------|
| `document/render/line-model.ts` | Row projection and the render-equality invariant |
| `buffer/index.tsx` | Composition root: state, wiring, conversions, slash session |
| `buffer/XmlRow.tsx` | One row: gutter, washes, affordances, body dispatch |
| `buffer/ItemRow.tsx` | List-item row with the marker as fixed trim |
| `buffer/SectionTagRow.tsx` | Section open tag with brackets as fixed trim |
| `buffer/InlineEditor.tsx` | `RowText` display plus the in-place editor |
| `buffer/GrowTextArea.tsx` | Auto-growing textarea and mount-time caret seating |
| `steps/node-mutations.ts` | `editorValueForLine`, `commitEdit`, paragraph split/merge/remove |
| `buffer/edit-navigation.ts` | Edit points and boundary resolutions |
| `buffer/click-caret.ts` | Click point to caret offset |
| `buffer/caret-rect.ts` | Caret viewport box for the slash menu anchor |
| `buffer/node-geometry.ts` | Row ranges, indent guides, landmarks, measured row offsets |
| `buffer/drag-controller.tsx` | Pointer-drag reorder with ghost, insertion line, drop flash — blocks, items, and selected runs (see [80-interaction-model.md](80-interaction-model.md)) |

# PromptDocument JSON Model
> Distilled from docs/10-system-design/10-canonical-prompt-object.md — keep in sync.
Use this block when reading or writing raw PromptDocument JSON for edit transactions.

## Envelope

```json
{
  "kind": "prompt",
  "schemaVersion": "prompt-kit/v1",
  "id": "promptEditorPrompt",
  "title": "Prompt Editor",
  "nodes": []
}
```

- Set `kind` to `"prompt"`, `schemaVersion` to `"prompt-kit/v1"`, and `id` to a non-empty string.
- Put block nodes in `nodes`.
- Use optional `title`, `description`, `archetype`, and free-form `metadata` only when needed.
- Set `archetype` to `"singleOutput"`, `"workflow"`, or another string.
- Give every block, inline node, and list item an optional string `id` and object `metadata`.

## Closed Block Union

Accept only `section`, `paragraph`, `bulletList`, `orderedList`, `field`, `codeBlock`, `example`, `raw`, and `contextUsage` as blocks.

- `section`: require an XML-valid `tag` and block `children`; allow `title` and string/number/boolean/null `attrs`.
  `{"type":"section","id":"node-purpose","tag":"purpose","children":[]}`
- `paragraph`: require inline `content`.
  `{"type":"paragraph","id":"node-identity","content":["You are the editor."]}`
- `bulletList`: require `listItem` entries in `items`.
  `{"type":"bulletList","id":"node-rules","items":[{"type":"listItem","id":"node-rule-ids","content":["Preserve ids."]}]}`
- `orderedList`: require `listItem` entries in `items`; allow numeric `start`.
  `{"type":"orderedList","id":"node-steps","start":2,"items":[{"type":"listItem","id":"node-step-read","content":["Read."]}]}`
- `field`: require string `label` and inline `value`; allow block `children`.
  `{"type":"field","id":"node-owner","label":"Owner","value":["platform team"]}`
- `codeBlock`: require literal string `code`; allow `language`.
  `{"type":"codeBlock","id":"node-command","language":"bash","code":"bun run doctor"}`
- `example`: require block `children`; allow `title`.
  `{"type":"example","id":"node-example","title":"Valid","children":[]}`
- `raw`: require string `value`; emit it verbatim.
  `{"type":"raw","id":"node-divider","value":"---"}`
- `contextUsage`: require non-empty `contextId` and block `instructions`; allow `tag`.
  `{"type":"contextUsage","id":"node-use-log","contextId":"log","instructions":[]}`

`listItem` is not a block; require inline `content`, allow block `children`, and nest lists only through `children`.

Only `section`, `example`, and `field` accept block `children`; only `contextUsage` accepts block `instructions`.

## Inline Content

Interleave literal strings with inline nodes in `content`, `value`, and variable `fallback` arrays.

- Literal: `"Edit "`
- Variable: `{"type":"variable","id":"node-target-var","name":"targetAgent","fallback":["the agent"]}`
- Reference: `{"type":"reference","id":"node-search-ref","kind":"tool","name":"search"}`

Never put `{{name}}` templating in a literal string; use a variable node.

## Id Rules

- Keep ids unique per document; treat duplicates as validation errors.
- Keep ids stable across copy edits; they anchor annotations, requests, diffs, and undo.
- Never change an existing node's `id` or `type` with `update_node`; remove and insert instead.
- Give every inserted subtree node a fresh descriptive id such as `node-purpose-identity`.
- Expect one collision to strip and regenerate ids for the whole inserted subtree.
- Expect omitted ids as `node-<kebab-type>-<n>`; address existing nodes only by displayed ids.

## Validate, Canonicalize, Hash

- Run `validatePrompt`; reject wrong schema versions, empty document ids, duplicate node ids, invalid section tags, empty context ids, and undeclared variables when declarations are supplied.
- Do not expect validation to catch weak prose, request-structure errors, missing runtime contexts, or unregistered tools.
- Run `canonicalizePrompt`; assign all ids, fix key order by node type, drop `undefined`, sort metadata keys, and omit empty optional `children` on `field` and `listItem`.
- Treat empty optional `children` on `field` and `listItem` as equivalent to absence.
- Compute `hashPrompt` as `pk1-` plus SHA-256 of canonical bytes.
- Ignore input JSON key order; expect identical canonical content to restore the same hash.
- Re-read the document when a transaction base hash is stale.

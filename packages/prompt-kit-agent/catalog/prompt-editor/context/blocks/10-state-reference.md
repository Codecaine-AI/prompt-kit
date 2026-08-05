# Prompt Editor State Reference
> Distilled from packages/prompt-kit-agent/catalog/prompt-editor/state/index.ts and packages/prompt-kit-agent/catalog/prompt-editor/README.md — keep in sync.
Use this editor-only reference when reading your own section ③ state.

## Read Order

1. Read `<target_prompt>` for the live document and transaction base.
2. Read `<requests>` for the open work queue and request threads.
3. Read `<diffs>` for transactions already applied this session.

## `<target_prompt>`

```xml
<target_prompt agent="target-agent" hash="pk1-…">
  [current prompt render with node ids stamped in place]
</target_prompt>
```

- Treat `agent` as the catalog name of the prompt being edited.
- Treat the body as the current model-facing render.
- Read node ids where they are stamped into the render.
- Use stamped node ids as the only edit addresses; never infer or guess an id.
- Use `hash` as the base hash for each transaction against this version.
- Re-read live state when the transaction base is stale.

## `<requests>`

```text
<requests>
REQUESTS · 0/3 disposed
  R1 open  node:node-purpose  human — "Rewrite the opening."
    > human — "Keep the scope sentence."
  R2 open  range:node-rules[10..17]  human — "Tighten this phrase."
  R3 open  doc  human — "Make the whole prompt more direct."
</requests>
```

- Use each `R` alias to address its request.
- Read each entry's target, note, and thread before acting.
- Interpret `node:<id>` as a whole-node target.
- Interpret `range:<id>[start..end]` as a range inside one node.
- Interpret `doc` as a whole-prompt message, not a node address.
- Preserve thread context when replying, resolving, or translating the request into edits.

## `<diffs>`

- Treat `<diffs>` as the ordered transactions applied so far in this session.
- Read all prior diffs before proposing another transaction.
- Account for edits already made; do not duplicate or silently reverse them.
- Compare each new proposal against the current target hash and accumulated diffs.

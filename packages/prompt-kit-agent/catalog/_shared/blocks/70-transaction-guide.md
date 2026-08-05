# Prompt Edit Transaction Guide
> Distilled from docs/20-implementation/20-editor/10-editing-model.md — keep in sync.
Use this block when constructing or repairing id-relative PromptDocument edit transactions.

## Addressing

- Address nodes only by the ids stamped as `<!-- #id -->` markers in the rendered document.
- Submit one ordered array of operations against the current document hash.

## Operations

### `update_node`

Shallow-merge changed fields into one node.

```json
{ "op": "update_node", "nodeId": "rules-p1", "patch": { "content": ["Always cite the source node id."] } }
```

### `insert_after`

Insert a new node as the next sibling of the reference node.

```json
{ "op": "insert_after", "refNodeId": "rules", "node": { "type": "section", "id": "node-section-output-format", "tag": "output_format", "children": [] } }
```

### `insert_into`

Insert a child into a container. Use `index` to position it; omit `index` to append. Insert into `children` for sections, examples, and fields; insert into `instructions` for context usage.

```json
{ "op": "insert_into", "parentNodeId": "workflow", "index": 0, "node": { "type": "paragraph", "id": "node-workflow-read-context", "content": ["Read the context packet first."] } }
```

### `remove_node`

Delete one node and its subtree.

```json
{ "op": "remove_node", "nodeId": "rules-p3" }
```

### `move_after`

Move an existing node after a reference node. Keep the reference outside the moved subtree.

```json
{ "op": "move_after", "nodeId": "success-criteria", "refNodeId": "output-format" }
```

## Ordering and ids

- Apply operations in array order against the working document.
- Let later operations address nodes inserted by earlier operations.
- Preserve ids through `update_node` and `move_after`.
- Never patch a node's `id` or `type`; remove and insert to change type.
- Give every inserted node and descendant a fresh, descriptive id.
- Never reuse an existing id; one collision regenerates ids for the entire inserted subtree.
- Treat removal as deletion of the subtree's ids.
- Reject patches that change nothing as no-ops.

## Repair loop

A failed proposal stages nothing and leaves the working document unchanged. Errors are typed and indexed to the offending operation.

1. Read the first error; later operations were not evaluated after compilation stopped.
2. Fix the indexed operation: re-read ids for an unknown target, or select a valid operation or target for structural misuse.
3. Treat new validation diagnostics as edit-caused; shrink the transaction until the failure is clear, then re-propose it.

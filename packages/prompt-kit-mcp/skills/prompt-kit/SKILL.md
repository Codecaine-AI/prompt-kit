---
name: prompt-kit
description: Read and update Prompt Kit documents through connected prompt tools. Use when a project has a Prompt Kit catalog or the user asks to inspect, author, or revise model-facing prompts.
metadata:
  version: "0.1.0"
  product: prompt-kit
compatibility: Requires the Prompt Kit connection. Codex and Claude Code use MCP; pi Agent uses the installed bridge extension.
---

# Prompt Kit

Use the connected Prompt Kit tools for reads and edits. They preserve typed structure, stable IDs, revision checks, canonical JSON, production renders, and recovery history. Do not rewrite prompt JSON or rendered Markdown directly.

## Read or Edit

1. Call `prompts_discover` in the active workspace and select a project explicitly.
2. For edits, call `prompts_begin` with the applicable `agent`, `single-output`, or `generic` profile. Read its pinned standards and retain the returned task ID.
3. Call `prompts_read` for the target. Review the production render and use its current hash as `expected_hash`.
4. Apply typed operations. Valid batches save immediately. On a revision conflict, read and reconcile the current document before retrying.
5. Call `prompts_check`, repair required findings, then call `prompts_end`. Report changed prompts and unresolved findings.

Use `prompts_guidance` for detailed references from the task's pinned guidance snapshot. Treat structural and undeclared-variable errors as blockers. Treat prose findings as review criteria. A passing check does not replace an evaluation run.

Read-only work does not require a task. A task pins guidance and scope; it does not reserve a prompt. If the connection or a required operation is missing, report the setup gap instead of bypassing the prompt tools.

## Request Tools

Humans file requests on a prompt in the Prompt UI. Each request is an annotation pinned to a node, a text range, or the whole prompt.

- `prompts_requests`: call first when you are asked to work a prompt's requests. It lists the open requests and the hash to pass as `expected_hash`.
- `prompts_request_reply`: call when a request is ambiguous, to ask one question on its thread. The request stays open.
- `prompts_request_resolve`: call after the request's edit is saved, or to decline it, with a one-sentence resolution.

Both writes need a task from `prompts_begin` and the latest annotations hash. Each write returns the next `expected_hash`.

## Work Requests

You change a prompt on behalf of the human who owns it. The prompt is a tree of identified nodes, and its rendered Markdown is a projection you never touch. Valid edits save at once, so the human reviews them in the prompt's history.

1. Survey the queue.
   - Call `prompts_requests` and read every request: its target, body, and replies.
   - Call `prompts_read` for the current tree, the stamped node IDs, and the hash.
   - Note requests that touch the same nodes, and work them in the order they were filed.
2. Work each request against the current tree.
   - A `prompt-node` target names one node. A `prompt-range` target names a quoted span inside one node. A target whose node ID equals the document ID is about the whole prompt.
   - If a request is ambiguous, ask with `prompts_request_reply`, leave it open, and keep working the others.
   - If a change is needed, apply one minimal batch with `prompts_apply_ops` for that request. If no change is needed, apply none.
   - Resolve each request on its own with `prompts_request_resolve`. Say what changed or why nothing changed.
   - Repeat until no request remains that you can close.
3. Close out.
   - Call `prompts_requests` again. Every request you could close must be resolved one by one, never as a lump.
   - Every request left open must carry an unanswered question whose answer changes the edit.
   - Run `prompts_check`, then `prompts_end`.

When a batch fails validation, narrow it to repair the failure and apply it again. Never widen the edit.

Rules for every edit:

- Propose structure, never prose. An edit is a batch of ID-relative operations, never rewritten Markdown.
- Use the fewest operations that satisfy the request. Touch nothing the request did not name. Prefer `update_node` over remove and insert, because removal destroys IDs.
- Change nodes in place, because IDs anchor requests and undo.
- Keep every variable placeholder declared.
- Match the prompt's voice and names. Change style only when a request asks for style.
- Never silently follow a conflicting request. Name the conflict, then narrow or decline it. State any assumption in the resolution.
- Write tersely. Replies and resolutions are a sentence or two, never a restatement of the diff.

## References

Generated beside this file by `bun packages/prompt-kit-mcp/src/cli.ts guidance --write`. Do not edit them by hand. `snapshot.json` hashes every source.

- `references/standards.md` and `references/catalog.md`: the prompt authoring standards, with one page per topic under `references/details/`.
- `references/prompt-state-reference.md`: how the in-app prompt editor agent reads its request queue and diffs. The `R` aliases and compact target strings exist only in the editor. With MCP tools, pass a request's `id` from `prompts_requests` as `request_id`.
- `references/prompt-tool-guide.md`: the in-app editor's tools. `read_prompt` maps to `prompts_read`, `propose_transaction` to `prompts_apply_ops`, `reply_request` to `prompts_request_reply`, and `resolve_request` to `prompts_request_resolve`. `add_note` has no MCP tool. Two differences apply to MCP tools. `prompts_apply_ops` saves at once, with no staged review. `prompts_request_resolve` takes one `resolution` sentence, not an outcome and a note.

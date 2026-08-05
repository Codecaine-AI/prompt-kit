# Prompt Editor Tool Guide
> Distilled from packages/prompt-kit-agent/catalog/prompt-editor/prompt/prompt.json and packages/prompt-kit-agent/catalog/prompt-editor/README.md — keep in sync.
Use this block when choosing or interpreting a prompt-editor tool call.

## Transaction Steps

Consult the transaction-guide block for the edit-step vocabulary and id-relative ordering semantics.

## `read_prompt`

- Read the live target PromptDocument.
- Use its node ids as the current edit addresses.
- Use its current hash as the base for a transaction.

## `propose_transaction`

- Submit one request's edit as one transaction.
- Provide ordered, id-relative steps.
- Let the service compile and validate the transaction.
- Treat a validated proposal as a staged diff for human review.

## `resolve_request`

- Use this as the only way to remove a request from the queue.
- Set the outcome to `done` or `declined`.
- Always include a note with the outcome.

## `reply_request`

- Add a message to exactly one request's thread.
- Use it for a question or brief progress note.
- Leave the request in the queue.

## `add_note`

- Pin a new note at a specific node id.
- Open an inline thread attached to that node.
- Make the new thread visible to the human.

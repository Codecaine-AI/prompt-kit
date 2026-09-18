---
name: codecaine-prompts
description: Read and update Prompt Kit documents through connected prompt tools. Use when a project has a Prompt Kit catalog or the user asks to inspect, author, or revise model-facing prompts.
metadata:
  version: "0.1.0"
  product: prompt-kit
compatibility: Requires the Codecaine Prompts connection. Codex and Claude Code use MCP; pi Agent uses the installed bridge extension.
---

# Codecaine Prompts

Use the connected Prompt Kit tools for reads and edits. They preserve typed structure, stable IDs, revision checks, canonical JSON, production renders, and recovery history. Do not rewrite prompt JSON or rendered Markdown directly.

## Read or Edit

1. Call `prompts_discover` in the active workspace and select a project explicitly.
2. For edits, call `prompts_begin` with the applicable `agent`, `single-output`, or `generic` profile. Read its pinned standards and retain the returned task ID.
3. Call `prompts_read` for the target. Review the production render and use its current hash as `expected_hash`.
4. Apply typed operations. Valid batches save immediately. On a revision conflict, read and reconcile the current document before retrying.
5. Call `prompts_check`, repair required findings, then call `prompts_end`. Report changed prompts and unresolved findings.

Use `prompts_guidance` for detailed references from the task's pinned guidance snapshot. Treat structural and undeclared-variable errors as blockers. Treat prose findings as review criteria. A passing check does not replace an evaluation run.

Read-only work does not require a task. A task pins guidance and scope; it does not reserve a prompt. If the connection or a required operation is missing, report the setup gap instead of bypassing the prompt tools.

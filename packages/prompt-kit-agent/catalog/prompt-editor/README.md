# prompt-editor

First-party kernel agent that edits another agent's PromptDocument on behalf
of a human, driven by an annotation request queue (the prompt-lab
annotate → agent-edit → inline-review loop).

From the `prompt-kit` repository root, this folder-form bundle lives at
`packages/prompt-kit-agent/catalog/prompt-editor/`:

- `packages/prompt-kit-agent/catalog/prompt-editor/agent.json` — manifest.
- `packages/prompt-kit-agent/catalog/prompt-editor/prompt/prompt.json` —
  canonical PromptDocument (source of truth; semantic
  node ids, layout-editor conventions). `prompt/system.md` is the generated
  render — regenerate with
  `bunx agent-kernel-render-prompts --agent packages/prompt-kit-agent/catalog/prompt-editor`.
- `packages/prompt-kit-agent/catalog/prompt-editor/context/index.ts` — five
  section-② standing-knowledge blocks, loaded through kernel `file` loaders
  and assembled without an extra envelope:
  - `<prompt_document_model>` from
    `packages/prompt-kit-agent/catalog/_shared/blocks/10-document-model.md`.
  - `<section_guide>` from
    `packages/prompt-kit-agent/catalog/_shared/blocks/20-section-guide-agent.md`.
  - `<quality_guide>` from
    `packages/prompt-kit-agent/catalog/_shared/blocks/50-quality-guide.md`.
  - `<tool_guide>` from
    `packages/prompt-kit-agent/catalog/prompt-editor/context/blocks/20-tool-guide.md`,
    followed by
    `packages/prompt-kit-agent/catalog/_shared/blocks/70-transaction-guide.md`
    in the same tag.
  - `<state_reference>` from
    `packages/prompt-kit-agent/catalog/prompt-editor/context/blocks/10-state-reference.md`.
  If any source is unavailable, its block renders as a status-marked empty tag
  so spawn can continue.
- `packages/prompt-kit-agent/catalog/prompt-editor/state/index.ts` — the
  section-③ state sidecar. Its `PromptEditorState` carries `targetAgent`,
  `targetPromptRender`, `targetPromptHash`, `appliedDiffs`, and
  `requestQueue`; it renders `<target_prompt>`, `<diffs>`, and `<requests>`
  before the rolling conversation tail.

Session-service contract (Phase 1 track: session service + tools v1):

- `sessionData.targetAgent` — catalog name of the agent being edited.
- `sessionData.targetPromptRender` — target prompt rendered with node ids.
- `sessionData.targetPromptHash` — canonical `pk1-…` hash proposals build on.
- `sessionData.appliedDiffs` — applied-transaction log for the current edit
  session, or an explicit empty value before the first apply.
- `sessionData.requestQueue` — rendered R-alias queue (target, note, thread).
- Tools v1 the prompt is written against: `read_prompt`,
  `propose_transaction`, `resolve_request`, `reply_request`, `add_note`.
  Registration is service-side (no `tools/` sidecar here yet); a `tools/`
  sidecar can be added without touching the prompt as long as names and
  behavior hold.

Gate: `packages/prompt-kit-agent/catalog/prompt-assembly.test.ts` (registry
discovery, canonical bytes, variable validation, snapshot freshness, section
shape, context assembly).

---
covers: The implementation tier for prompt-kit, orienting readers to the two workspace packages and the structural decisions that govern new code in each.
type: overview
concepts: [implementation, packages, structure, decisions]
---

# Prompt-Kit Implementation

This tier records structural decisions about the current code: how each package
is organized and why, so agents adding code conform to the existing structure
instead of restructuring it. It is not a source map — the source tree is its
own index.

---

## Packages

The workspace contains two packages with a one-way dependency direction
(`@codecaine-ai/prompt-kit` ← Agent Kernel ← `@codecaine-ai/prompt-kit-agent`):

- **`packages/prompt-kit`** — the library: prompt AST, annotations, headless
  UI models, and the React authoring surface. See
  [10-prompt-kit/00-overview.md](10-prompt-kit/00-overview.md).
- **`packages/prompt-kit-agent`** — the agent host: the standalone kernel
  harness and the agent catalog. See
  [20-prompt-kit-agent.md](20-prompt-kit-agent.md).

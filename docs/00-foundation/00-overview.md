---
covers: The Foundation layer for prompt-kit, including its purpose, boundaries, and authoring principles.
type: overview
concepts: [foundation, purpose, principles, boundaries]
---

# Prompt-Kit Foundation

Prompt-kit exists to make prompts authorable as structured objects while still
rendering into linear text that an agent can read naturally. This layer captures
the intent behind that package before diving into AST details or implementation
files.

---

## File Tree

```text
00-foundation/
├── 00-overview.md                  (this file) Foundation entry point
├── 10-purpose-and-boundary.md      Why prompt-kit exists and what it does not own
└── 20-authoring-principles.md      Principles for writing prompts as structured objects
```

## Contents

### [10-purpose-and-boundary.md](10-purpose-and-boundary.md)

Explains the problem prompt-kit solves, the package boundary, and the runtime
systems that stay outside the package.

### [20-authoring-principles.md](20-authoring-principles.md)

Captures the authoring rules that keep prompt documents flexible, readable, and
safe to render in several environments.


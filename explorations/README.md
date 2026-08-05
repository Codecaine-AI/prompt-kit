# Explorations

This directory holds standalone interactive HTML mockups that drive design sessions. Each exploration is cited from `docs/.drafts/` while it is live, then deleted once the work it drove lands; git history keeps the record.

## Live

- [`annotation-agent-ux/index.html`](annotation-agent-ux/index.html) — Interactive mockup of the annotation → agent-edit → inline-review loop (2026-07-31). It simulates the full loop plus a bottom dock of decisions, questions, and log pills persisted to `localStorage`. Companion docs: [`2026-07-31-annotation-agent-ux-session.md`](../docs/.drafts/2026-07-31-annotation-agent-ux-session.md) and [`2026-07-31-prompt-agent-build-blast-radius.md`](../docs/.drafts/2026-07-31-prompt-agent-build-blast-radius.md).

- [`lab-layout/`](lab-layout/) — Twelve variants (a → l) of the prompt lab shell and annotate mode, iterated in one session (2026-08-03). Companion doc: [`2026-08-03-prompt-lab-layout-and-annotation-model.md`](../docs/.drafts/2026-08-03-prompt-lab-layout-and-annotation-model.md). **F** won the frame, **H** contributed ⌘K and global targeting, **I** the session panel, **K** the mode feel and the final gesture model.

  | File | Variant |
  |---|---|
  | [`a-outline-tucked-details.html`](lab-layout/a-outline-tucked-details.html) | Outline promoted, node details tucked out of the way |
  | [`b-zero-chrome.html`](lab-layout/b-zero-chrome.html) | First removal of the top statusbar entirely |
  | [`c-docked-stack.html`](lab-layout/c-docked-stack.html) | Right dock as a stack of zones (outline / details / requests / history) |
  | [`d-centered-dock.html`](lab-layout/d-centered-dock.html) | Centered document column plus the docked stack |
  | [`e-one-document.html`](lab-layout/e-one-document.html) | The turn as one document; first AGENT / TURN / FIXTURE zones |
  | [`f-dock-switcher.html`](lab-layout/f-dock-switcher.html) | **Won the frame** — VIEW switcher in the dock, replacing tabs and absorbing token counts |
  | [`g-observatory-threads.html`](lab-layout/g-observatory-threads.html) | Observatory-flavored chrome with agent threads |
  | [`h-annotate-flow.html`](lab-layout/h-annotate-flow.html) | F with the annotation lifecycle wired; ⌘K entry and document-level targeting |
  | [`i-session-mode.html`](lab-layout/i-session-mode.html) | Session panel and batch-run narration; demoed one combined revision |
  | [`j-annotate-chat-expand.html`](lab-layout/j-annotate-chat-expand.html) | Motion-led alternative: composer expands into a chat surface — not chosen |
  | [`k-annotate-ambient.html`](lab-layout/k-annotate-ambient.html) | **Won the mode feel** — ambient shift, breathing chip, run-now / batch / global gestures |
  | [`l-annotate-conversation.html`](lab-layout/l-annotate-conversation.html) | Conversation-led alternative: annotate mode as an ongoing thread — not chosen |

## Precedent

`editor-readability/` (2026-07-29, nine readability variants) drove the readability overhaul in `packages/prompt-kit/src/ui/surface` and was removed 2026-08-03.

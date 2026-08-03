// Every React-facing piece of the prompt-authoring UI in one entry point.
// Kept separate from `./ui` so that entry stays React-free for headless
// consumers (renderers, validators, server-side prompt tooling).
//
// STYLING CONTRACT — the host app supplies the presentation layer:
//
//   1. Tailwind utilities. These components use Tailwind class names
//      (`flex`, `text-sm`, `rounded-[3px]`, …). prompt-kit deliberately ships
//      no Tailwind config, no build step, and no CSS bundle: a consumer that
//      already runs Tailwind would otherwise end up with two copies of the
//      utility layer. The host's Tailwind must have prompt-kit's source on its
//      content/source paths so the classes are generated.
//   2. Semantic CSS custom properties. Colours resolve through the host's
//      token layer (`--background`, `--foreground`, `--muted-foreground`,
//      `--border`, `--accent`, …) so the editor inherits the surrounding app's
//      theme rather than imposing one.
//   3. The `.prompt-editor-surface` rules — row zebra/rule striping and
//      caret behaviour — which ship with the host's stylesheet. In this repo's
//      consumers that is `@agent-kernel/viewer-ui/styles`.
//
// Values a host may want to drive at runtime (font size, line height, gutter
// width, row shading) are read from `--prompt-editor-*` custom properties;
// `promptStyleVars` from `./style` produces a matching style object.

export * from "./prompt-flow";
export * from "./lab";
export * from "./style";
export * from "./surface";
export * from "./view";

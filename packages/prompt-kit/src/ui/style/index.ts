// Persisted, user-tunable presentation of a prompt surface — density presets,
// mono font, row shading — plus the React hook that keeps a host in sync with
// them. Settings are projected onto the DOM as `--prompt-editor-*` custom
// properties by `promptStyleVars`.
export * from "./prompt-style-settings";
export * from "./use-prompt-style-settings";
export { PromptStyleRail, type PromptStyleRailProps } from "./PromptStyleRail";
export {
  PromptStyleSidebar,
  clampPromptStyleSidebarWidth,
  PROMPT_STYLE_SIDEBAR_DEFAULT_WIDTH,
  PROMPT_STYLE_SIDEBAR_MIN_WIDTH,
  PROMPT_STYLE_SIDEBAR_MAX_WIDTH,
  type PromptStyleSidebarProps,
} from "./PromptStyleSidebar";

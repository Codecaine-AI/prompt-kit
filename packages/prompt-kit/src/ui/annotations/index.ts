// Annotation pane UI: the shared AnnotationPanel wired to prompt annotation
// targets (prompt-node / prompt-range) and the headless annotation store.
// React — import via `@codecaine-ai/prompt-kit/ui/annotations`, not the
// headless `/annotations` entry.
export {
  PromptAnnotationsPane,
  PROMPT_ANNOTATION_INTENT_OPTIONS,
  type PromptAnnotationsPaneProps,
  type PromptAnnotationRunAgentResult,
  type PromptAnnotationUndoPatchResult,
} from "./PromptAnnotationsPane";

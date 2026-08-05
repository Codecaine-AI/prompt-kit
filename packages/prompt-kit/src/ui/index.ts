// Headless UI models: the tree, selection, and step machinery a prompt-editing
// surface needs, with no React and no DOM. The React components that consume
// these live behind the per-surface entries (`./ui/lab`, `./ui/style`,
// `./ui/surface`), so this entry stays usable from servers, scripts, and tests.
export * from "./editor/model";
export * from "./editor/transactions";

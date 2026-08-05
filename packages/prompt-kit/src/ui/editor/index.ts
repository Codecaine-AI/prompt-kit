// The prompt editing surface: the headless editor model and transaction
// machinery (`./model`, `./transactions`), an XML buffer the author types into
// directly (`./buffer`), plus the inspector that edits the selected node's
// attributes (`./inspector`). Every mutation routes through a `PromptStep`
// from `./transactions`, so undo, redo, and canonical hashing stay the
// document model's job rather than the component tree's.
export * from "./model";
export * from "./transactions";
export { PromptFlowXml } from "./buffer";
export {
	PromptFlowInspector,
	type PromptFlowInspectorProps,
} from "./inspector";
export type { PromptFlowChangeHandler, PromptFlowViewProps } from "./types";
export {
	buildXmlLineModel,
	type XmlLine,
	type XmlLineModel,
	type XmlLineRole,
} from "../../document/render/line-model";
// The canonical structural-selection model (marquee → one sibling run) and
// the run-level mutation seams — exported so mirroring surfaces (docs-system)
// share one resolution rule and one transaction shape.
export {
	resolveMarqueeSelection,
	structuralSelectionRun,
	type StructuralRun,
	type StructuralSelection,
} from "./structural-selection";
export {
	moveBlocksStep,
	removeBlocksStep,
	type BlockRunStepsResult,
} from "./steps/block-run-steps";

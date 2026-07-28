// The prompt-flow editing surface: an XML buffer the author types into
// directly, plus the inspector that edits the selected node's attributes.
// Every mutation routes through a `PromptStep` from `../editors`, so undo,
// redo, and canonical hashing stay the document model's job rather than the
// component tree's.
export { PromptFlowXml } from "./PromptFlowXml";
export {
	PromptFlowInspector,
	type PromptFlowInspectorProps,
} from "./PromptFlowInspector";
export type { PromptFlowChangeHandler, PromptFlowViewProps } from "./types";
export {
	buildXmlLineModel,
	type XmlLine,
	type XmlLineModel,
	type XmlLineRole,
} from "./xml-line-model";

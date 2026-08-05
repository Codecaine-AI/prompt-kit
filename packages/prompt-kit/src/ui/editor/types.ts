"use client";

import type { PromptDocument } from "../../index";
import type {
	PromptEditorModel,
	PromptEditorTreeEntry,
} from "./model";
import type {
	PromptStep,
} from "./transactions";

/**
 * Change callback contract: block edits are produced through the prompt-kit
 * *WithStep editor wrappers and pass their steps alongside the resulting
 * document, so the host can commit them to a transaction log. Calls without
 * `steps` are document-metadata edits (title/description) — the host reads
 * the metadata off `prompt` and must not treat the node tree as changed.
 */
export type PromptFlowChangeHandler = (
	prompt: PromptDocument,
	selectedNodeId?: string,
	steps?: PromptStep[],
) => void;

export interface PromptFlowViewProps {
	prompt: PromptDocument;
	model: PromptEditorModel;
	selectedEntry?: PromptEditorTreeEntry;
	selectedNodeId?: string;
	onSelectNode: (id: string | undefined) => void;
	onPromptChange: PromptFlowChangeHandler;
}

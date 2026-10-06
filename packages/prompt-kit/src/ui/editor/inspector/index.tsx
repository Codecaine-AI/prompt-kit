// Prompt block details: type-specific fields, plus diagnostics only when the
// block actually has issues.
"use client";

import cn from "classnames";
import type { PromptDiagnostic, PromptDocument } from "../../../index";
import type {
	PromptEditorModel,
	PromptEditorTreeEntry,
} from "../model";

import type { PromptFlowChangeHandler } from "../types";
import { InspectorSection } from "./fields";
import { NodeDetails } from "./NodeDetails";

export interface PromptFlowInspectorProps {
	prompt: PromptDocument;
	model: PromptEditorModel;
	selectedEntry?: PromptEditorTreeEntry;
	onPromptChange: PromptFlowChangeHandler;
}

export function PromptFlowInspector({
	prompt,
	model,
	selectedEntry,
	onPromptChange,
}: PromptFlowInspectorProps) {
	const documentDiagnostics = model.validation.diagnostics;
	const diagnostics = selectedEntry
		? documentDiagnostics.filter(
				(diagnostic) =>
					diagnostic.nodeId === selectedEntry.id ||
					diagnostic.path?.join(".").startsWith(selectedEntry.path.join(".")),
			)
		: [];

	return (
		<div className="flex shrink-0 flex-col">
			{!selectedEntry ? (
				documentDiagnostics.length > 0 ? (
					<div className="pl-3 pr-1 pt-1">
						<InspectorSection title="Document diagnostics">
							<DiagnosticList diagnostics={documentDiagnostics} />
						</InspectorSection>
					</div>
				) : (
					<div className="flex items-center justify-center p-5">
						<p className="max-w-52 text-center text-[length:var(--ds-font-size-ui-xs)] leading-[var(--ds-line-height-reading)] text-muted-foreground/70">
							Select a prompt block to inspect its structure, metadata, and validation notes.
						</p>
					</div>
				)
			) : (
				<div className="pl-3 pr-1 pt-1">
					<div className="flex flex-col gap-4">
						<NodeDetails
							entry={selectedEntry}
							prompt={prompt}
							onPromptChange={onPromptChange}
						/>

						{diagnostics.length > 0 && (
							<InspectorSection title="Diagnostics">
								<DiagnosticList diagnostics={diagnostics} />
							</InspectorSection>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function DiagnosticList({ diagnostics }: { diagnostics: PromptDiagnostic[] }) {
	return (
		<ul className="flex flex-col">
			{diagnostics.map((diagnostic, index) => (
				<li
					key={`${diagnostic.code}:${index}`}
					className={cn(
						"border-b border-border/60 py-2 text-[length:var(--ds-font-size-ui-xs)] leading-[var(--ds-line-height-ui)] last:border-b-0",
						diagnostic.severity === "error"
							? "text-destructive"
							: "text-status-warning",
					)}
				>
					<span className="block text-[length:var(--ds-font-size-micro)] font-medium uppercase tracking-[var(--ds-letter-spacing-micro-wide)]">
						{diagnostic.code}
					</span>
					{diagnostic.message}
				</li>
			))}
		</ul>
	);
}

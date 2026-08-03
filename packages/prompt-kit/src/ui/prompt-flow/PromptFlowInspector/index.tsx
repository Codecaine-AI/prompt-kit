// Prompt block details: selection summary, type-specific fields, diagnostics,
// and — folded away — the block's identity.
"use client";

import cn from "classnames";
import type { ReactNode } from "react";
import type { PromptDiagnostic, PromptDocument } from "../../../index";
import type {
	PromptEditorModel,
	PromptEditorTreeEntry,
} from "../../editors";

import type { PromptFlowChangeHandler } from "../types";
import { InspectorSection } from "./fields";
import { NodeDetails } from "./NodeDetails";
import { NodeIdField } from "./NodeIdField";

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
		<div className="flex shrink-0 flex-col bg-card">
			{!selectedEntry ? (
				documentDiagnostics.length > 0 ? (
					<div className="p-3">
						<InspectorSection title="Document diagnostics">
							<DiagnosticList diagnostics={documentDiagnostics} />
						</InspectorSection>
					</div>
				) : (
					<div className="flex items-center justify-center p-5">
						<p className="max-w-52 text-center text-[12px] leading-relaxed text-muted-foreground/70">
							Select a prompt block to inspect its structure, metadata, and validation notes.
						</p>
					</div>
				)
			) : (
				<div className="p-3">
					<div className="flex flex-col gap-4">
						<InspectorSection title="Selected">
							{/* One summary line + a quiet path row keep the block's
							    orientation readable without a micro-label grid. */}
							<p className="text-[12px] leading-relaxed text-foreground">
								{selectedEntry.node.type}
								<span className="text-muted-foreground"> · </span>
								<span className="tabular-nums">
									{selectedEntry.index + 1}/{selectedEntry.siblingCount}
								</span>
								<span className="text-muted-foreground"> · </span>
								depth <span className="tabular-nums">{selectedEntry.depth}</span>
							</p>
							<p className="break-all text-[11px] leading-relaxed text-muted-foreground">
								{selectedEntry.path.join(".")}
							</p>
						</InspectorSection>

						<NodeDetails
							entry={selectedEntry}
							prompt={prompt}
							onPromptChange={onPromptChange}
						/>

						<InspectorSection title="Diagnostics">
							{diagnostics.length === 0 ? (
								<p className="text-[12px] text-muted-foreground/70">No issues for this block</p>
							) : (
								<DiagnosticList diagnostics={diagnostics} />
							)}
						</InspectorSection>

						{/* The node id addresses the block for tooling, not for
						    authoring, so it sits folded at the bottom rather than
						    above the fields the author came here to change. */}
						<Advanced>
							<NodeIdField
								entry={selectedEntry}
								prompt={prompt}
								onPromptChange={onPromptChange}
							/>
						</Advanced>
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * A collapsed disclosure, styled as one more panel heading so the closed state
 * reads as a section title rather than a control.
 */
function Advanced({ children }: { children: ReactNode }) {
	return (
		<details className="group">
			<summary className="flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
				<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground group-open:text-foreground">
					Advanced
				</span>
				<span className="h-px flex-1 bg-border" />
			</summary>
			<div className="mt-2 flex flex-col gap-2">{children}</div>
		</details>
	);
}

function DiagnosticList({ diagnostics }: { diagnostics: PromptDiagnostic[] }) {
	return (
		<ul className="flex flex-col">
			{diagnostics.map((diagnostic, index) => (
				<li
					key={`${diagnostic.code}:${index}`}
					className={cn(
						"border-b border-border/60 py-2 text-[12px] leading-relaxed last:border-b-0",
						diagnostic.severity === "error"
							? "text-destructive"
							: "text-status-warning",
					)}
				>
					<span className="block text-[10px] font-medium uppercase tracking-[0.12em]">
						{diagnostic.code}
					</span>
					{diagnostic.message}
				</li>
			))}
		</ul>
	);
}

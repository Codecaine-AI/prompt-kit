// Slice: the code-block language control — the word that follows the opening
// fence.
"use client";

import type { CodeBlockNode, PromptDocument } from "../../../index";
import type {
	PromptEditorTreeEntry,
} from "../model";

import { updateNode } from "../shared";
import type { PromptFlowChangeHandler } from "../types";
import { CODE_LANGUAGES, fenceHint, normalizeLanguage } from "./languages";

const LANGUAGE_LIST_ID = "prompt-code-languages";

/**
 * A list-backed input rather than a select: the common languages are one click
 * away, but the field still accepts any word, because the fence is free text
 * and the list will never be complete. Empty clears it to a bare fence.
 */
export function LanguageField({
	entry,
	node,
	prompt,
	onPromptChange,
}: {
	entry: PromptEditorTreeEntry;
	node: CodeBlockNode;
	prompt: PromptDocument;
	onPromptChange: PromptFlowChangeHandler;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<label
				htmlFor="prompt-code-language"
				className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
			>
				language
			</label>
			<input
				id="prompt-code-language"
				list={LANGUAGE_LIST_ID}
				value={node.language ?? ""}
				placeholder="none"
				spellCheck={false}
				onChange={(event) => {
					const language = normalizeLanguage(event.target.value);
					updateNode(prompt, entry, onPromptChange, (current) =>
						current.type === "codeBlock"
							? ({ ...current, language } satisfies CodeBlockNode)
							: current,
					);
				}}
				className="h-8 rounded-[2px] border border-border bg-background px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-status-success"
			/>
			<datalist id={LANGUAGE_LIST_ID}>
				{CODE_LANGUAGES.map((language) => (
					<option key={language} value={language} />
				))}
			</datalist>
			<p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
				{fenceHint(node.language)}
			</p>
		</div>
	);
}

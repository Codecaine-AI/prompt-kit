// Slice: list-item row rendering. The marker is fixed trim; the content area
// hosts the same RowText (click → caret) and the same InlineEditor (and keymap)
// every other editable row uses, so list items and paragraphs behave
// identically under both the pointer and the keyboard.
"use client";

import type { PromptDocument } from "../../../index";
import type {
	PromptEditorTreeEntry,
} from "../model";

import { EDITOR_COLORS, EDITOR_METRICS } from "../../surface/editor-surface";
import type { PromptFlowViewProps } from "../types";
import type { XmlLine } from "../../../document/render/line-model";
import { InlineEditor, RowText } from "./InlineEditor";
import { itemContentText, listMarker } from "../steps/node-mutations";

/**
 * One list-item row. The marker ("1." / "-") is always rendered as a fixed,
 * non-editable prefix; the content area to its right either displays the item
 * text or hosts the inline editor. This guarantees the marker persists during
 * editing and the layout never shifts.
 *
 * There is no "add item" affordance: Enter at the end of an item is how a list
 * grows. A button under the last item had to be mounted at all times to be
 * discoverable, which cost every list a row of height it did not render — the
 * one thing the strict line grid cannot afford.
 */
export function ItemRow({
	line,
	entry,
	editing,
	editCaret,
	editSeq,
	prompt,
	onPromptChange,
	onStartEdit,
	onEndEdit,
	onEditorKeyDown,
	onEditorChange,
}: {
	line: XmlLine;
	entry: PromptEditorTreeEntry;
	editing: boolean;
	editCaret?: number | "end" | readonly [number, number];
	editSeq: number;
	prompt: PromptDocument;
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	/** Enters edit mode with the caret at the clicked character. */
	onStartEdit: (caret: number | "end") => void;
	onEndEdit: () => void;
	onEditorKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	onEditorChange?: (next: string, element: HTMLTextAreaElement) => void;
}) {
	const node = line.node;
	const itemIndex = line.itemIndex ?? 0;
	const marker = listMarker(node, itemIndex);

	return (
		<div className="flex min-w-0 items-start" style={{ textIndent: 0 }}>
			{/* The marker is trim, not content: clicking it is a click at the very
			    start of the item, so it opens the editor at offset 0 rather than
			    selecting a glyph that cannot be edited. */}
			<span
				className="shrink-0 cursor-text select-none pr-1 tabular-nums"
				style={{
					lineHeight: EDITOR_METRICS.lineHeight,
					color: EDITOR_COLORS.syntaxListMarker,
				}}
				onClick={(event) => {
					event.stopPropagation();
					if (!editing) onStartEdit(0);
				}}
			>
				{marker}
			</span>
			<div className="relative min-w-0 flex-1">
				{editing ? (
					<InlineEditor
						key={`edit:${editSeq}`}
						line={line}
						entry={entry}
						prompt={prompt}
						initialCaret={editCaret}
						onPromptChange={onPromptChange}
						onEndEdit={onEndEdit}
						onEditorKeyDown={onEditorKeyDown}
						onEditorChange={onEditorChange}
					/>
				) : (
					// Same click→caret surface every other editable row uses. Item
					// text renders without the row's indent or its marker, so the
					// display prefix is 0 and a click offset maps straight onto the
					// editable value. Item content is built from the model's inline
					// content (never escaped), so no entity decode — but it DOES get
					// the inline treatments: `<tag>` tokens take the tag palette and
					// `code` spans chip, same as prose rows.
					<RowText
						line={line}
						editable
						text={itemContentText(node, itemIndex)}
						displayPrefix={0}
						onStartEdit={onStartEdit}
					/>
				)}
			</div>
		</div>
	);
}

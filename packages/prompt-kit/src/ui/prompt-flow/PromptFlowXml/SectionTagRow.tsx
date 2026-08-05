// Slice: a section's open-tag row. The angle brackets are trim; the name
// between them is the editable value.
"use client";

import type { PromptDocument } from "../../../index";
import type { PromptEditorTreeEntry } from "../../editors";

import { EDITOR_COLORS, EDITOR_METRICS } from "../../surface/editor-surface";
import type { PromptFlowViewProps } from "../types";
import type { XmlLine } from "../../../document/render/line-model";
import { InlineEditor, RowText } from "./InlineEditor";
import { sectionTagText } from "./node-mutations";

/**
 * One section open tag, `<name>`. Built exactly like a list-item row: the
 * brackets are fixed, non-editable trim and only the name between them toggles
 * between display and inline editing, so the brackets never vanish mid-edit and
 * the row never shifts. Naming a section is therefore typing on the row rather
 * than opening a menu.
 *
 * The editor is sized to the name in `ch` so the closing bracket sits directly
 * after the last character and slides right as the name grows — the row reads
 * as one `<name>` token whether or not the caret is in it.
 */
export function SectionTagRow({
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
	const tag = sectionTagText(line.node);

	return (
		<div
			className="flex min-w-0 items-start"
			style={{ textIndent: 0 }}
			// The row is wider than `<name>`: everything past the closing bracket
			// is "after the end of the line", so clicking it puts the caret at the
			// end of the name rather than falling through and clearing selection.
			onClick={(event) => {
				if (event.target !== event.currentTarget) return;
				event.stopPropagation();
				if (!editing) onStartEdit("end");
			}}
		>
			<Bracket text="<" onClick={() => onStartEdit(0)} editing={editing} />
			{editing ? (
				// An explicit content width keeps the closing bracket glued to the
				// name. The two extra pixels absorb sub-pixel rounding so the
				// textarea never wraps its own text and grows the row.
				<div
					className="min-w-0"
					// Same weight as the resting name: the textarea inherits it, so
					// the glyphs do not thicken or thin when the caret arrives.
					style={{ width: tagWidth(tag.length), fontWeight: 500 }}
				>
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
						color={EDITOR_COLORS.syntaxTag}
					/>
				</div>
			) : (
				<div style={{ color: EDITOR_COLORS.syntaxTag, fontWeight: 500 }}>
					<RowText
						line={line}
						editable
						text={tag}
						displayPrefix={0}
						highlight={false}
						onStartEdit={onStartEdit}
					/>
				</div>
			)}
			<Bracket text=">" onClick={() => onStartEdit("end")} editing={editing} />
		</div>
	);
}

/**
 * Width of an `n`-character name in the surface's runtime metrics. `1ch` is one
 * monospace advance; the letter-spacing term keeps the bracket aligned when the
 * host tracks the type out.
 */
function tagWidth(length: number): string {
	const count = Math.max(1, length);
	return `calc(${count}ch + ${count} * ${EDITOR_METRICS.letterSpacing} + 2px)`;
}

/**
 * One angle bracket. Clicking it is a click at the very start / end of the
 * name, so it opens the editor there instead of selecting a glyph that cannot
 * be edited.
 */
function Bracket({
	text,
	editing,
	onClick,
}: {
	text: string;
	editing: boolean;
	onClick: () => void;
}) {
	return (
		<span
			className="shrink-0 cursor-text select-none"
			style={{
				lineHeight: EDITOR_METRICS.lineHeight,
				color: EDITOR_COLORS.syntaxPunctuation,
			}}
			onClick={(event) => {
				event.stopPropagation();
				if (!editing) onClick();
			}}
		>
			{text}
		</span>
	);
}

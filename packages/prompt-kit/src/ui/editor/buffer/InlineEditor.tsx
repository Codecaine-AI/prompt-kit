// Slice: non-item row text — display (RowText) + in-place block editor.
"use client";

import cn from "classnames";
import type { PromptDocument } from "../../../index";
import type {
	PromptEditorTreeEntry,
} from "../model";

import { EDITOR_METRICS } from "../../surface/editor-surface";
import { highlightXmlLine } from "../../surface/xml-highlight";
import type { PromptFlowViewProps } from "../types";
import { decodeXmlEntities, type XmlLine } from "../../../document/render/line-model";
import { caretForRowClick, lineIndentLength } from "./click-caret";
import { GrowTextArea, type EditorAriaAttributes } from "./GrowTextArea";
import { commitEdit, editorValueForLine } from "../steps/node-mutations";

/**
 * Rendered text for a non-editing row, and the ONE click surface that turns a
 * point into a caret. Every editable row renders through this — paragraphs,
 * fields, raw / code lines and list-item content alike — so "click lands the
 * caret where I clicked" has a single implementation rather than one per row
 * kind. Non-editable rows (tags, fences) select their block instead.
 */
export function RowText({
	line,
	editable,
	text,
	displayPrefix,
	highlight = true,
	decodeEntities = false,
	onSelect,
	onStartEdit,
}: {
	line: XmlLine;
	editable: boolean;
	/**
	 * Rendered text, when the row shows only PART of its line. List items render
	 * their content without the marker, which is drawn as separate trim.
	 * Defaults to the whole line.
	 */
	text?: string;
	/**
	 * Leading rendered characters that are not part of the node's editable
	 * value. Defaults to the line's own indent; list-item content passes 0.
	 */
	displayPrefix?: number;
	/** XML/inline-token coloring (tags, {{vars}}, `code` chips). */
	highlight?: boolean;
	/**
	 * Decode XML entities for DISPLAY (prose rows whose model text the renderer
	 * escaped): the read view then shows `<state>` exactly like edit mode does,
	 * and inline `<tag>` tokens pick up the tag highlight. The annotate-mode
	 * offset walk mirrors this policy via `lineRendersDecodedEntities`.
	 */
	decodeEntities?: boolean;
	onSelect?: () => void;
	/** Enters edit mode with the caret at the clicked character. */
	onStartEdit: (caret: number | "end") => void;
}) {
	const raw = text ?? line.text;
	const shown = decodeEntities ? decodeXmlEntities(raw) : raw;
	const prefix = displayPrefix ?? lineIndentLength(line);
	// An empty row still needs a clickable, full-height text box.
	const display =
		shown.length === 0 ? " " : highlight ? highlightXmlLine(shown) : shown;

	return (
		<div
			// The renderable text region a within-unit drag maps back to the
			// node's editable value: the surface's drag-release walks text nodes
			// inside this container only (see textOffsetOfSelectionPoint).
			data-prompt-row-content=""
			className={cn(
				"whitespace-pre-wrap break-words",
				editable ? "cursor-text" : "cursor-pointer",
			)}
			style={{ lineHeight: EDITOR_METRICS.lineHeight }}
			onClick={(event) => {
				event.stopPropagation();
				// A drag-release that produced a NATIVE text selection is not a
				// caret click. The DELIBERATE path for that gesture lives in the
				// surface's pointerup (a highlight confined to one editable row
				// opens the inline editor with the range pre-selected, and its
				// release click is swallowed before reaching here) — so any
				// non-collapsed selection this handler still sees is one the
				// surface could NOT map (multi-row code highlights, element
				// boundaries). Entering edit mode would remount the row and
				// destroy that highlight; leave it alive instead. (A plain click
				// is unaffected — mousedown collapses any old selection before
				// the click event fires, so this guard only sees real drags.)
				const nativeSelection = window.getSelection?.();
				if (nativeSelection && !nativeSelection.isCollapsed) return;
				if (!editable) {
					onSelect?.();
					return;
				}
				onStartEdit(
					caretForRowClick(
						line,
						event.currentTarget,
						event.clientX,
						event.clientY,
						prefix,
					),
				);
			}}
		>
			{display}
		</div>
	);
}

/**
 * In-place text editor. Uses identical mono metrics and the same left
 * indentation as the rendered line so opening it does not shift layout. Text
 * commits per keystroke through the *WithStep mutation helpers; structural
 * keys (Enter split, Backspace merge, arrow row-moves) are owned by the
 * surface-level keyboard handler passed in as `onEditorKeyDown`.
 */
export function InlineEditor({
	line,
	entry,
	prompt,
	initialCaret,
	onPromptChange,
	onEndEdit,
	onEditorKeyDown,
	onEditorChange,
	editorAria,
	color,
}: {
	line: XmlLine;
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	initialCaret?: number | "end" | readonly [number, number];
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	onEndEdit: () => void;
	onEditorKeyDown?: (
		event: React.KeyboardEvent<HTMLTextAreaElement>,
	) => void;
	/**
	 * Surface-level text handler. Typing is not always a plain text commit —
	 * `/` opens the slash menu, `- ` turns the block into a list — so the
	 * surface takes every value and decides. Without it the editor commits the
	 * text directly.
	 */
	onEditorChange?: (next: string, element: HTMLTextAreaElement) => void;
	/** Combobox wiring while the surface has a menu open over this caret. */
	editorAria?: EditorAriaAttributes;
	/** Ink for the edited text, when the row's resting text is syntax-colored. */
	color?: string;
}) {
	const node = entry.node;
	// Multi-line leaf content (raw / code) keeps Enter as a literal newline.
	const multiline = node.type === "raw" || node.type === "codeBlock";

	const value = editorValueForLine(node, line);
	const commit = (next: string) =>
		commitEdit(prompt, entry, line, next, onPromptChange);

	return (
		<div className="flex min-w-0" style={{ textIndent: 0 }}>
			<GrowTextArea
				value={value}
				autoFocus
				initialCaret={initialCaret}
				onChange={onEditorChange ?? commit}
				onBlur={onEndEdit}
				onKeyDown={onEditorKeyDown}
				allowEnter={multiline}
				aria={editorAria}
				color={color}
			/>
		</div>
	);
}

// Slice: auto-growing inline-edit textarea shared by the item + block editors.
"use client";

import { useLayoutEffect, useRef } from "react";

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
	PROMPT_EDITOR_ROOT_CLASS,
	editorTypeStyle,
} from "../../surface/editor-surface";

/** Screen-reader wiring for a listbox the host opens over the caret. */
export interface EditorAriaAttributes {
	role: "combobox";
	"aria-expanded": boolean;
	"aria-controls": string;
	"aria-activedescendant"?: string;
	"aria-autocomplete": "list";
}

/**
 * Auto-growing textarea matching the row's runtime mono metrics exactly, with
 * no padding, so inline editing keeps the surface flush.
 */
export function GrowTextArea({
	value,
	autoFocus,
	onChange,
	onBlur,
	onKeyDown,
	allowEnter,
	initialCaret,
	aria,
	color,
}: {
	value: string;
	autoFocus?: boolean;
	/** The element comes along so callers can read the live caret / its rect. */
	onChange: (value: string, element: HTMLTextAreaElement) => void;
	onBlur: () => void;
	/** Extra key handling layered on top of Escape / Enter-guarding. */
	onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	/** When true, Enter inserts a literal newline (raw / code). Otherwise the
	 * host's onKeyDown owns Enter (structural). */
	allowEnter?: boolean;
	/**
	 * Caret applied ONCE on mount: a number is clamped to the value, "end" lands
	 * after the last character, and a `[start, end]` pair SELECTS that range so
	 * the next keystroke types over it. Splits, merges and row-to-row arrow moves
	 * remount the editor, so mount-time placement is exactly "where the edit
	 * landed".
	 */
	initialCaret?: number | "end" | readonly [number, number];
	/**
	 * Combobox wiring for an overlay the host controls (the slash menu). Spread
	 * verbatim, so the host owns the whole relationship and the textarea stays
	 * unaware of what is open above it.
	 */
	aria?: EditorAriaAttributes;
	/**
	 * Ink for the edited text. Defaults to the surface foreground; a row whose
	 * resting text is syntax-colored passes that color so opening the editor
	 * does not repaint the line.
	 */
	color?: string;
}) {
	const ref = useRef<HTMLTextAreaElement | null>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const resize = () => {
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight}px`;
		};
		resize();

		// Style changes do not change the textarea value, so observe the scoped
		// surface and parent size to keep the explicit auto-grow height current.
		const surface = el.closest(`.${PROMPT_EDITOR_ROOT_CLASS}`);
		const mutationObserver = surface
			? new MutationObserver(resize)
			: undefined;
		if (surface) {
			mutationObserver?.observe(surface, {
				attributes: true,
				attributeFilter: ["style", "class"],
			});
		}
		const resizeObserver = new ResizeObserver(resize);
		if (el.parentElement) resizeObserver.observe(el.parentElement);
		return () => {
			mutationObserver?.disconnect();
			resizeObserver.disconnect();
		};
	}, [value]);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		// The edit target may move between rows within one commit (split /
		// merge / arrow navigation); focusing on mount keeps the caret alive
		// without a click. autoFocus alone can lose the race when the
		// previously-focused textarea unmounts in the same commit.
		if (autoFocus && document.activeElement !== el) el.focus();
		if (initialCaret === undefined) return;
		const clamp = (offset: number) =>
			Math.max(0, Math.min(offset, el.value.length));
		if (Array.isArray(initialCaret)) {
			el.setSelectionRange(clamp(initialCaret[0]), clamp(initialCaret[1]));
			return;
		}
		const caret =
			initialCaret === "end" ? el.value.length : clamp(initialCaret as number);
		el.setSelectionRange(caret, caret);
		// Caret placement only matters on mount.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<textarea
			ref={ref}
			value={value}
			autoFocus={autoFocus}
			rows={1}
			spellCheck={false}
			{...aria}
			onClick={(event) => event.stopPropagation()}
			onChange={(event) => onChange(event.target.value, event.target)}
			onBlur={onBlur}
			onKeyDown={(event) => {
				// The host sees every key FIRST. An overlay it owns — the slash
				// menu — must be able to take Escape to close itself while the
				// caret keeps blinking, which it cannot do if Escape has already
				// blurred the editor out from under it.
				onKeyDown?.(event);
				if (event.defaultPrevented) return;
				if (event.key === "Escape") {
					event.preventDefault();
					event.currentTarget.blur();
					return;
				}
				// Guard: for single-line fields, swallow a bare Enter so it never
				// injects a newline the model can't represent.
				if (event.key === "Enter" && !allowEnter && !event.shiftKey) {
					event.preventDefault();
				}
			}}
			className="m-0 min-h-4 w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-mono outline-none"
			style={{
				...editorTypeStyle,
				// The row body owns the font size (landmark open tags scale theirs
				// up); everywhere else the inherited size IS the metric, so the
				// editor never changes glyph size when the caret arrives.
				fontSize: "inherit",
				minHeight: EDITOR_METRICS.lineHeight,
				color: color ?? EDITOR_COLORS.fg,
			}}
		/>
	);
}

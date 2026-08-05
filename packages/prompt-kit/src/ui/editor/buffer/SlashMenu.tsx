// Slice: the caret-anchored slash menu. Renders and reports — it owns no state.
"use client";

/**
 * Integration contract
 * ====================
 *
 * The menu is fully controlled. It never listens for keys, never holds the
 * query, and never takes focus: the caret must keep blinking in the textarea
 * the whole time it is open. The editor drives it.
 *
 * Trigger
 *   Open when `/` is typed at the START of an empty editable line. Nothing else
 *   opens it — a slash mid-sentence is just a slash.
 *
 * While open
 *   - Typing extends the query (the text after `/`); pass it in as `query`.
 *   - Up/Down move `selectedIndex` (wrap or clamp — the editor decides).
 *   - Enter or Tab choose: the editor reads the command from `onSelect`,
 *     removes the literal `/query` text, and inserts `command.type`.
 *   - Escape dismisses and leaves the literal text alone.
 *   - A keystroke that empties the match list dismisses too, again leaving the
 *     literal text: `matchSlashCommands(query).length === 0` is the signal, and
 *     this component renders `null` in that case so it cannot be left orphaned.
 *   - Backspacing over the `/` dismisses.
 *
 * Anchor
 *   Viewport coordinates of the caret (what `getBoundingClientRect()` returns) —
 *   a `DOMRect` is accepted as-is. The menu positions itself `fixed`, flips
 *   above the caret when there is no room below, and clamps horizontally so it
 *   never runs off screen. The anchor is a snapshot: this component calls
 *   `onDismiss` on window resize and on a pointer press outside itself, since
 *   it cannot refresh a caret rect it does not own.
 *
 * Selection index
 *   Out-of-range values are clamped for rendering, so exactly one row is always
 *   marked selected while the list is non-empty. The editor should still keep
 *   its own index inside `matchSlashCommands(query).length` — the same call this
 *   component makes — because that is the list `onSelect` reports from.
 *
 * Screen readers
 *   The textarea should carry `role="combobox"`, `aria-expanded`,
 *   `aria-controls={SLASH_MENU_LISTBOX_ID}` and
 *   `aria-activedescendant={slashMenuOptionId(selectedCommand.id)}`.
 */

import cn from "classnames";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { insertOptionIcon } from "../shared";
import { matchSlashCommands, type SlashCommand, type SlashCommandId } from "./slash-commands";

/** Viewport-relative caret box. A `DOMRect` satisfies this. */
export type SlashMenuAnchor = {
	readonly top: number;
	readonly left: number;
	readonly bottom?: number;
	readonly height?: number;
};

export type SlashMenuProps = {
	/** Text typed after the `/`. Empty string shows the whole vocabulary. */
	query: string;
	/** Caret box in viewport coordinates. */
	anchor: SlashMenuAnchor;
	/** Index into `matchSlashCommands(query)`. Clamped for rendering. */
	selectedIndex: number;
	/** Enter/Tab/click. The editor performs the insertion. */
	onSelect: (command: SlashCommand) => void;
	/** Pointer moved onto a row — move the editor's selection here. */
	onHoverIndex: (index: number) => void;
	/** Pointer pressed outside, or the anchor went stale (window resize). */
	onDismiss: () => void;
};

/** For the textarea's `aria-controls`. */
export const SLASH_MENU_LISTBOX_ID = "prompt-slash-menu";

/** For the textarea's `aria-activedescendant`. */
export function slashMenuOptionId(id: SlashCommandId): string {
	return `${SLASH_MENU_LISTBOX_ID}-${id}`;
}

/** Distance between the caret line and the menu edge. */
const CARET_GAP = 4;
/** Smallest allowed gap between the menu and a viewport edge. */
const VIEWPORT_MARGIN = 8;
const MENU_WIDTH = 236;

export function SlashMenu({
	query,
	anchor,
	selectedIndex,
	onSelect,
	onHoverIndex,
	onDismiss,
}: SlashMenuProps) {
	const commands = matchSlashCommands(query);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [placement, setPlacement] = useState<Placement | null>(null);
	const anchorTop = anchor.top;
	const anchorLeft = anchor.left;
	const anchorBottom = anchor.bottom ?? anchor.top + (anchor.height ?? 0);
	const count = commands.length;

	// Measure, then place. A layout effect lands the final position before the
	// browser paints, so the pre-measurement frame is never visible.
	useLayoutEffect(() => {
		const element = menuRef.current;
		if (!element) return;
		const { offsetWidth, offsetHeight } = element;
		setPlacement(
			resolvePlacement({
				anchorTop,
				anchorBottom,
				anchorLeft,
				width: offsetWidth,
				height: offsetHeight,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
			}),
		);
	}, [anchorTop, anchorBottom, anchorLeft, count]);

	// The caret rect belongs to the editor and cannot be recomputed here, so a
	// resize retires the menu rather than leaving it pinned to a stale spot.
	// An outside press is a deliberate move away from the slash.
	useEffect(() => {
		if (count === 0) return;
		function handlePointerDown(event: MouseEvent) {
			const element = menuRef.current;
			if (element && event.target instanceof Node && element.contains(event.target)) return;
			onDismiss();
		}
		document.addEventListener("mousedown", handlePointerDown, true);
		window.addEventListener("resize", onDismiss);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown, true);
			window.removeEventListener("resize", onDismiss);
		};
	}, [count, onDismiss]);

	// No matches: the editor dismisses, and until it does there is nothing to show.
	if (count === 0) return null;

	const activeIndex = Math.min(Math.max(selectedIndex, 0), count - 1);

	return (
		<div
			ref={menuRef}
			id={SLASH_MENU_LISTBOX_ID}
			role="listbox"
			aria-label="Insert block"
			// Editor-affordance stamp: annotate mode CSS-hides everything carrying
			// `data-prompt-affordance`. The menu only mounts mid-edit, which
			// annotate mode blocks — this is belt-and-suspenders for a menu left
			// open across the mode switch.
			data-prompt-affordance="slash-menu"
			// Keep focus — and the caret — in the textarea. Preventing the
			// default of the bubbled mousedown is what stops the focus change.
			onMouseDown={(event) => event.preventDefault()}
			className="fixed z-40 overflow-y-auto overflow-x-hidden rounded-[4px] border border-border bg-card p-1 shadow-lg"
			style={{
				width: MENU_WIDTH,
				top: placement?.top ?? anchorBottom + CARET_GAP,
				left: placement?.left ?? anchorLeft,
				maxHeight: placement?.maxHeight,
				// Hidden only for the measurement pass, which never paints.
				visibility: placement ? "visible" : "hidden",
			}}
		>
			{commands.map((command, index) => (
				<SlashMenuRow
					key={command.id}
					command={command}
					selected={index === activeIndex}
					onSelect={() => onSelect(command)}
					onHover={() => {
						if (index !== activeIndex) onHoverIndex(index);
					}}
				/>
			))}
		</div>
	);
}

function SlashMenuRow({
	command,
	selected,
	onSelect,
	onHover,
}: {
	command: SlashCommand;
	selected: boolean;
	onSelect: () => void;
	onHover: () => void;
}) {
	const Icon = insertOptionIcon(command.type);
	return (
		<div
			id={slashMenuOptionId(command.id)}
			role="option"
			aria-selected={selected}
			onMouseEnter={onHover}
			onClick={onSelect}
			className={cn(
				"flex cursor-pointer items-center gap-2 rounded-[2px] px-1.5 py-1",
				selected ? "bg-accent/10 text-foreground" : "text-muted-foreground",
			)}
		>
			<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
				{Icon && <Icon size={12} className={selected ? "text-accent" : undefined} />}
			</span>
			<span className="text-[12px] leading-none">{command.label}</span>
			<span className="ml-auto truncate text-[11px] leading-none text-muted-foreground/70">
				{command.description}
			</span>
		</div>
	);
}

type Placement = {
	top: number;
	left: number;
	maxHeight: number;
};

/**
 * Below the caret by default; above it when the menu would not fit below but
 * does fit above. Horizontally clamped to the viewport, and capped in height so
 * a short viewport scrolls the rows instead of hiding them.
 */
function resolvePlacement({
	anchorTop,
	anchorBottom,
	anchorLeft,
	width,
	height,
	viewportWidth,
	viewportHeight,
}: {
	anchorTop: number;
	anchorBottom: number;
	anchorLeft: number;
	width: number;
	height: number;
	viewportWidth: number;
	viewportHeight: number;
}): Placement {
	const spaceBelow = viewportHeight - VIEWPORT_MARGIN - (anchorBottom + CARET_GAP);
	const spaceAbove = anchorTop - CARET_GAP - VIEWPORT_MARGIN;
	const above = height > spaceBelow && spaceAbove > spaceBelow;

	const maxHeight = Math.max(0, above ? spaceAbove : spaceBelow);
	const cappedHeight = Math.min(height, maxHeight);
	const top = above ? anchorTop - CARET_GAP - cappedHeight : anchorBottom + CARET_GAP;

	const maxLeft = viewportWidth - VIEWPORT_MARGIN - width;
	const left = Math.max(VIEWPORT_MARGIN, Math.min(anchorLeft, maxLeft));

	return { top, left, maxHeight };
}

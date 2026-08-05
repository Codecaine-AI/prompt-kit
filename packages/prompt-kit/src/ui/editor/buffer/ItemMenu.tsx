// Slice: compact list-item menu (Duplicate / Indent / Outdent / Delete) opened
// from the item grip's motionless click — the item-kind twin of BlockMenu.
"use client";

import { Copy, IndentDecrease, IndentIncrease, Trash2 } from "lucide-react";
import { useEffect } from "react";

import { MenuItem } from "./BlockMenu";

/**
 * Compact item menu opened from the item grip: "list item" as header, then
 * Duplicate, Indent, Outdent, Delete. Indent and Outdent stay visible but
 * disabled where their steps would decline — Indent on a list's first item
 * (nestListItemStep needs a previous sibling), Outdent on an item whose list
 * is not nested inside another item (unnestListItemStep needs an outer list).
 *
 * Outside clicks close it through the surface's own click handling, exactly
 * like BlockMenu (the menu stops propagation on its own clicks); Escape closes
 * it here.
 */
export function ItemMenu({
	canIndent,
	canOutdent,
	onClose,
	onDuplicate,
	onIndent,
	onOutdent,
	onRemove,
}: {
	canIndent: boolean;
	canOutdent: boolean;
	onClose: () => void;
	onDuplicate: () => void;
	onIndent: () => void;
	onOutdent: () => void;
	onRemove: () => void;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	return (
		<div
			className="absolute left-0 top-full z-30 mt-1 w-48 rounded-[4px] border border-border bg-card p-1 shadow-lg"
			onClick={(event) => event.stopPropagation()}
		>
			{/* Unit name as header, matching BlockMenu's type-name header. */}
			<div className="flex items-center gap-1.5 border-b border-border/70 px-1.5 pb-1.5 pt-1">
				<span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
					list item
				</span>
			</div>
			<MenuItem
				icon={Copy}
				label="Duplicate"
				onClick={() => {
					onDuplicate();
					onClose();
				}}
			/>
			<MenuItem
				icon={IndentIncrease}
				label="Indent"
				disabled={!canIndent}
				onClick={() => {
					onIndent();
					onClose();
				}}
			/>
			<MenuItem
				icon={IndentDecrease}
				label="Outdent"
				disabled={!canOutdent}
				onClick={() => {
					onOutdent();
					onClose();
				}}
			/>
			<MenuItem
				icon={Trash2}
				label="Delete"
				destructive
				onClick={() => {
					onRemove();
					onClose();
				}}
			/>
		</div>
	);
}

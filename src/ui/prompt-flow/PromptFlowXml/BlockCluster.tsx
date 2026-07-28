// Slice: the single left-edge [⋮⋮] affordance pinned to a block.
"use client";

import cn from "classnames";
import { GripVertical } from "lucide-react";
import type { PromptBlockNode } from "../../../index";
import type { PromptBlockNodeType } from "../../editors";

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
} from "../../surface/editor-surface";
import { BlockMenu } from "./BlockMenu";

/**
 * The single left-edge affordance for a block, pinned at its first line just
 * inside the gutter. It holds ONE control — [⋮⋮], the drag handle whose click
 * opens a compact block menu. Creating blocks is a typing gesture (Enter, or
 * the slash menu), so there is no insert button competing for the same few
 * pixels. The affordance stays visible while the block is selected.
 */
export function BlockCluster({
	node,
	gutterWidth,
	visible,
	menuOpen,
	canInsertChild,
	onToggleMenu,
	onCloseMenu,
	onDuplicate,
	onRetag,
	onRemove,
	onInsertChild,
	onDragHandleDown,
}: {
	node: PromptBlockNode;
	gutterWidth: string;
	visible: boolean;
	menuOpen: boolean;
	canInsertChild: boolean;
	onToggleMenu: () => void;
	onCloseMenu: () => void;
	onDuplicate: () => void;
	onRetag: (tag: string) => void;
	onRemove: () => void;
	onInsertChild: (type: PromptBlockNodeType) => void;
	onDragHandleDown: (event: React.PointerEvent<HTMLElement>) => void;
}) {
	return (
		<div
			className={cn(
				"absolute top-0 z-20 flex items-center justify-end",
				visible ? "visible opacity-100" : "invisible opacity-0",
			)}
			style={{
				// The affordance lives ENTIRELY inside the gutter (it may cover the
				// hidden line number's space) so it can never overlap body text,
				// whatever the row's indent depth. Right-aligned at the gutter's
				// right edge, clear of the gutter's own right padding.
				left: 0,
				width: `calc(${gutterWidth} - 0.25ch)`,
				height: EDITOR_METRICS.lineHeight,
				transition: visible ? "opacity 120ms ease-out" : "none",
			}}
			onClick={(event) => event.stopPropagation()}
		>
			<button
				type="button"
				onPointerDown={(event) => {
					// Pointer-down begins a drag; a click that never moves opens the
					// block menu (handled in onClick).
					event.stopPropagation();
					onDragHandleDown(event);
				}}
				onClick={(event) => {
					event.stopPropagation();
					onToggleMenu();
				}}
				title="Drag, or click for block menu"
				aria-label="Block handle and menu"
				className="prompt-editor-grip pointer-events-auto flex min-h-5 w-4 cursor-grab touch-none items-center justify-center rounded-[2px] hover:bg-white/10 active:cursor-grabbing"
				style={{
					height: EDITOR_METRICS.lineHeight,
					color: EDITOR_COLORS.grip,
				}}
			>
				<GripVertical
					size={12}
					style={{
						width: EDITOR_METRICS.gripSize,
						height: EDITOR_METRICS.gripSize,
					}}
				/>
			</button>
			{menuOpen && (
				<BlockMenu
					node={node}
					canInsertChild={canInsertChild}
					onClose={onCloseMenu}
					onDuplicate={onDuplicate}
					onRetag={onRetag}
					onRemove={onRemove}
					onInsertChild={onInsertChild}
				/>
			)}
		</div>
	);
}

// Slice: the single left-edge [⋮⋮] affordance pinned to a block.
"use client";

import { GripVertical } from "lucide-react";
import type { PromptBlockNode } from "../../../index";
import type {
	PromptBlockNodeType,
} from "../model";

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
} from "../../surface/editor-surface";
import { dragHandleRailWidth } from "./drag-handle";
import { BlockMenu } from "./BlockMenu";

/**
 * The BLOCK-kind drag handle, mounted on the block's first row only while the
 * block is the resolved handle unit (see resolveDragHandleUnit — at most one
 * handle exists at a time). It holds ONE control — [⋮⋮], the drag handle whose
 * motionless click opens a compact block menu. Creating blocks is a typing
 * gesture (Enter, or the slash menu), so there is no insert button competing
 * for the same few pixels.
 */
export function BlockCluster({
	node,
	indentCh,
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
	/** Leading indent (spaces) of the block's first row — drives the handle x. */
	indentCh: number;
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
			// Editor-affordance stamp: annotate mode hides everything carrying
			// `data-prompt-affordance` via the lab's injected stylesheet, so the
			// grip/menu can never be grabbed while targeting. Behavior-neutral in
			// edit mode.
			data-prompt-affordance="block-cluster"
			data-prompt-handle-indent={indentCh}
			className="absolute top-0 z-20 flex items-center justify-end"
			style={{
				// The handle floats in the whitespace immediately LEFT of the
				// block's content: the rail runs from the row's left edge to just
				// short of the block's first character (gutter + body padding +
				// the row's own indent), and the grip right-aligns inside it.
				// For a top-level block that is the classic gutter position — the
				// gutter IS its left edge. Absolutely positioned: it never
				// displaces or overlaps text.
				left: 0,
				width: dragHandleRailWidth(indentCh),
				height: EDITOR_METRICS.lineHeight,
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
				// Docs-viewer drag-handle feel: the hit box is a padded rounded
				// button meaningfully larger than the glyph it frames (28px wide by
				// a full line-height tall around the ~20px grip), with a hover wash
				// and grab/grabbing cursors. Pointer-down still starts a drag and a
				// motionless click still opens the block menu.
				className="prompt-editor-grip pointer-events-auto flex w-7 cursor-grab touch-none items-center justify-center rounded-[3px] hover:bg-white/10 active:cursor-grabbing"
				style={{
					height: EDITOR_METRICS.lineHeight,
					color: EDITOR_COLORS.grip,
				}}
			>
				<GripVertical
					size={20}
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

// NOTION-STYLE MARGIN COMMENTS (2026-08-04 redesign): every block with open
// comments grows a small count bubble at the RIGHT EDGE of the content
// column, vertically aligned with the block's first row. The bubbles PORTAL
// into [data-prompt-flow-rows] so they ride the scroll with the text;
// absolute positioning keeps them out of the flow (nothing shifts). They
// replaced the in-flow note markers ("WHERE YOU LEFT THINGS") — presence in
// the margin, not furniture between the lines. Hover lists the threads;
// click selects the block. AI state ONLY (2026-08-05): edit mode stays
// clean of the annotation layer.
"use client";

import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Pencil } from "lucide-react";

/** One open comment/request, reduced to what the bubble popover shows. */
export interface CommentIndicatorThread {
	key: string;
	/** Queue alias (session) or author (store annotations). */
	label: string;
	body: string;
	/** Agent-authored — rendered with ✎ instead of 💬. */
	agent: boolean;
}

export interface CommentIndicatorGroup {
	nodeId: string;
	/** First row of the block's rendered extent (index into the line model). */
	row: number;
	threads: CommentIndicatorThread[];
}

export function RightMarginRail({
	container,
	groups,
	onSelect,
	onHoverNode,
}: {
	/** The [data-prompt-flow-rows] element the bubbles portal into. */
	container: HTMLElement | null;
	groups: CommentIndicatorGroup[];
	/** Click: select the node and highlight its sidebar COMMENTS entry. */
	onSelect: (nodeId: string, firstThreadKey: string) => void;
	/** Hover: light the bubble's block in the document (null on leave). */
	onHoverNode?: (nodeId: string | null) => void;
}) {
	// offsetTop per node: rows sit in normal flow inside the (relative) rows
	// container, so offsetTop is already container-relative — no rect math,
	// and wrapped rows measure true. Re-measured whenever the groups change
	// (the callers key groups on editVersion, so document edits re-measure).
	const [tops, setTops] = useState<ReadonlyMap<string, number>>(new Map());
	const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

	useLayoutEffect(() => {
		if (!container) return;
		const next = new Map<string, number>();
		for (const group of groups) {
			const row = container.querySelector<HTMLElement>(
				`[data-row-index="${group.row}"]`,
			);
			if (row) next.set(group.nodeId, row.offsetTop);
		}
		setTops(next);
	}, [container, groups]);

	if (!container || groups.length === 0) return null;

	return createPortal(
		<>
			{groups.map((group) => {
				const count = group.threads.length;
				return (
					<div
						key={group.nodeId}
						data-lab-comment-indicator={group.nodeId}
						className="absolute z-20"
						// The content column's free right margin — the rows container
						// caps at the content width, so a negative right offset sits
						// the bubble past the column's edge, CLEAR of the targeting
						// ring's dotted border (+3px outset) with breathing room.
						style={{ right: -52, top: tops.get(group.nodeId) ?? 0 }}
						onMouseEnter={() => {
							setHoverNodeId(group.nodeId);
							onHoverNode?.(group.nodeId);
						}}
						onMouseLeave={() => {
							setHoverNodeId((current) =>
								current === group.nodeId ? null : current,
							);
							onHoverNode?.(null);
						}}
					>
						<button
							type="button"
							aria-label={`${count} ${count === 1 ? "comment" : "comments"} on ${group.nodeId}`}
							onClick={() => onSelect(group.nodeId, group.threads[0]!.key)}
							className="flex items-center gap-1 rounded-full border border-border/50 bg-card/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground/60 transition-colors hover:border-border hover:text-foreground"
						>
							<MessageSquare size={11} aria-hidden />
							{count}
						</button>
						{hoverNodeId === group.nodeId && (
							<div
								data-lab-comment-popover={group.nodeId}
								className="absolute right-0 top-full z-30 mt-1 flex w-60 flex-col gap-1 rounded-md border border-border bg-card p-2 shadow-lg"
							>
								{group.threads.map((thread) => (
									<p
										key={thread.key}
										className="flex items-baseline gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
									>
										{thread.agent ? (
											<Pencil size={10} aria-hidden className="shrink-0 translate-y-px" />
										) : (
											<MessageSquare size={10} aria-hidden className="shrink-0 translate-y-px" />
										)}
										<span className="shrink-0 text-foreground/80">
											{thread.label}
										</span>
										<span className="min-w-0 truncate">
											{thread.body.split("\n", 1)[0]}
										</span>
									</p>
								))}
							</div>
						)}
					</div>
				);
			})}
		</>,
		container,
	);
}

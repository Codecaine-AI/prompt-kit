// Slice: line-grid geometry — per-node row ranges, bracket indent guides,
// top-level landmark rows, and measured per-row offsets for overlays.
"use client";

import { useLayoutEffect, useState } from "react";

import type { XmlLine } from "../xml-line-model";

// Width of one indent level in the rendered text, in `ch`. prompt-kit indents
// with two spaces per level; guides/landmarks/drop-line are positioned against
// this.
export const INDENT_CH = 2;

export interface NodeRange {
	start: number;
	end: number;
}

/** First and last row index (in `lines`) owned by each node id. */
export function computeNodeRanges(lines: readonly XmlLine[]): Map<string, NodeRange> {
	const ranges = new Map<string, NodeRange>();
	lines.forEach((line, index) => {
		if (line.role === "gap") return;
		const existing = ranges.get(line.nodeId);
		if (!existing) ranges.set(line.nodeId, { start: index, end: index });
		else existing.end = index;
	});
	return ranges;
}

/**
 * Trims blank rows from the outside of a range used for selection or hover
 * paint. Blank rows between visible rows remain inside the returned range so a
 * multi-row block reads as one continuous region.
 */
export function trimPaintedNodeRange(
	lines: readonly XmlLine[],
	range: NodeRange | undefined,
): NodeRange | undefined {
	if (!range || lines.length === 0) return undefined;

	let start = Math.max(0, range.start);
	let end = Math.min(lines.length - 1, range.end);
	while (start <= end && isBlankRow(lines[start])) start += 1;
	while (end >= start && isBlankRow(lines[end])) end -= 1;

	return start <= end ? { start, end } : undefined;
}

function isBlankRow(line: XmlLine | undefined): boolean {
	return line === undefined || line.text.trim().length === 0;
}

export interface Guide {
	nodeId: string;
	start: number;
	end: number;
	depth: number;
}

/**
 * One bracket-style indent guide per container node (section / example /
 * contextUsage): a hairline from its open-tag row to its close-tag row at the
 * container's own indent level (VS Code bracket-guide idiom). Nested containers
 * are included — they are cheap and reinforce structure.
 */
export function computeGuides(
	lines: readonly XmlLine[],
	ranges: Map<string, NodeRange>,
): Guide[] {
	const guides: Guide[] = [];
	const seen = new Set<string>();
	lines.forEach((line) => {
		if (line.role !== "open") return;
		if (seen.has(line.nodeId)) return;
		seen.add(line.nodeId);
		const range = ranges.get(line.nodeId);
		if (!range || range.end <= range.start) return;
		guides.push({
			nodeId: line.nodeId,
			start: range.start,
			end: range.end,
			depth: line.depth,
		});
	});
	return guides;
}

/**
 * Row indices that open a TOP-LEVEL section-like container. These get the
 * faint landmark tint so section starts scan at a glance.
 */
export function computeLandmarks(lines: readonly XmlLine[]): Set<number> {
	const rows = new Set<number>();
	lines.forEach((line, index) => {
		if (line.role === "open" && line.depth === 0) rows.add(index);
	});
	return rows;
}

export interface RowMetric {
	/** Offset of the row's top, relative to the rows container. */
	top: number;
	/** Rendered height of the row (one line-height, or more when wrapped). */
	height: number;
	/** Runtime computed line height for this row. */
	lineHeight: number;
}

/**
 * Measures each row's top/height relative to the rows container. Rows sit on a
 * strict line grid at rest but grow when their content wraps, so overlays that
 * span multiple rows (indent guides, drop insertion line) must read real
 * offsets rather than multiplying an index by a fixed pitch. Re-measures on
 * mount, on line-count change, and whenever the container resizes.
 */
export function useRowMetrics(
	rowsRef: React.RefObject<HTMLDivElement | null>,
	lineCount: number,
): RowMetric[] {
	const [metrics, setMetrics] = useState<RowMetric[]>([]);

	useLayoutEffect(() => {
		const container = rowsRef.current;
		if (!container) return;

		const measure = () => {
			const rows = container.querySelectorAll<HTMLElement>("[data-row-index]");
			const next: RowMetric[] = new Array(rows.length);
			rows.forEach((row) => {
				const index = Number(row.dataset.rowIndex);
				if (Number.isNaN(index)) return;
				const computedLineHeight = Number.parseFloat(
					getComputedStyle(row).lineHeight,
				);
				next[index] = {
					top: row.offsetTop,
					height: row.offsetHeight,
					lineHeight: Number.isFinite(computedLineHeight)
						? computedLineHeight
						: row.offsetHeight,
				};
			});
			setMetrics((prev) => (sameMetrics(prev, next) ? prev : next));
		};

		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(container);
		return () => observer.disconnect();
	}, [rowsRef, lineCount]);

	return metrics;
}

function sameMetrics(a: RowMetric[], b: RowMetric[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (!x || !y) {
			if (x !== y) return false;
			continue;
		}
		if (
			x.top !== y.top ||
			x.height !== y.height ||
			x.lineHeight !== y.lineHeight
		) {
			return false;
		}
	}
	return true;
}

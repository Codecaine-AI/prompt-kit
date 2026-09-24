// Slice: the lab dock — the stack of quiet zones that lives in the document's
// right margin (VIEW · FIXTURE · OUTLINE · DETAILS · COMMENTS; the agent
// manifest moved onto the page header and HISTORY became the glass panel's
// temporary view). Zones are hairline-separated with uppercase micro-headers; the
// dock carries NO box chrome of its own in the wide layout (it is furniture in
// the margin), and degrades to a bordered right column when the lab is too
// narrow to keep a margin. Purely presentational — the lab shell composes the
// zones and owns every piece of state.
"use client";

import cn from "classnames";
import { ChevronDown } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { EDITOR_COLORS } from "../../surface/editor-surface";
import type { OutlineSection } from "../../editor/buffer/SectionOutline";
import type { LabFixture } from "../page/StateSurface";

/**
 * The dock's view switcher vocabulary. `state` appears only when the host
 * supplies a `stateZone`; `tools` only with a `toolsZone`.
 */
export type LabView = "system" | "context" | "state" | "tools";

/** One switcher row: the view plus its estimated token count. */
export interface PanelViewEntry {
	id: LabView;
	tokens: number;
}

/**
 * One dock zone: micro-header (uppercase, letter-spaced, faint) over a quiet
 * body. The optional `action` slot rides the header's right edge in normal
 * case — the ANNOTATE toggle and the open-request count live there.
 */
export function PanelZone({
	id,
	label,
	action,
	children,
}: {
	id: string;
	label: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			data-lab-zone={id}
			className="border-b border-border/60 last:border-b-0"
		>
			{/* The stamp is the ambient hook: annotate mode tints every zone
			    micro-header (and the hairlines above) toward the mode's hue
			    from one stylesheet — see AmbientWash. */}
			<div
				data-lab-zone-header=""
				className="flex items-center gap-2 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground transition-colors"
			>
				<span>{label}</span>
				{action && (
					<span className="ml-auto flex items-center gap-2 normal-case tracking-normal">
						{action}
					</span>
				)}
			</div>
			<div className="pb-3">{children}</div>
		</section>
	);
}

/**
 * The view switcher: a vertical list — deliberately larger and airier than
 * the outline below it, so the two lists never read as one. The active view
 * is brighter with a thin left accent; each row carries its token count
 * right-aligned in small muted text (the counts that used to ride the old
 * statusbar tabs).
 */
export function PanelViewSwitcher({
	views,
	active,
	onSelect,
	rowSublines,
}: {
	views: PanelViewEntry[];
	active: LabView;
	onSelect: (view: LabView) => void;
	/** Per-row status sublines (the system row's exceptional save states). */
	rowSublines?: Partial<Record<LabView, React.ReactNode>>;
}) {
	return (
		<div className="flex flex-col">
			{views.map((entry) => {
				const current = entry.id === active;
				const subline = rowSublines?.[entry.id];
				return (
					<div key={entry.id} className="flex flex-col">
					<button
						type="button"
						data-lab-view={entry.id}
						aria-pressed={current}
						onClick={() => onSelect(entry.id)}
						className={cn(
							"flex w-full items-baseline gap-2 border-l py-1 pl-3 pr-1 text-left text-[13px] tracking-[0.03em] transition-colors",
							current
								? "text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
						style={
							current
								? { borderLeftColor: EDITOR_COLORS.selectionAccent }
								: undefined
						}
					>
						<span>{entry.id}</span>
						<span
							className="ml-auto text-[10px] tabular-nums text-muted-foreground/50"
							title={`Estimated tokens in the ${entry.id} view`}
						>
							{entry.tokens.toLocaleString()}
						</span>
					</button>
					{subline && (
						<div
							data-lab-view-subline={entry.id}
							className="border-l border-transparent pb-1 pl-3 text-[10px] tracking-[0.06em]"
						>
							{subline}
						</div>
					)}
					</div>
				);
			})}
		</div>
	);
}

// Fixed height keeps each row's SVG rail coordinates exact.
const OUTLINE_ROW_HEIGHT = 25;
// Outer hairline x-coordinate, centered on a physical pixel.
const OUTLINE_RAIL_X0 = 4.5;
// Horizontal distance from the outer rail to the descendant rail.
const OUTLINE_RAIL_JOG = 12;
// Bend radius; set to zero for square corners.
const OUTLINE_JOG_RADIUS = 6;
// Radius of the marker on the displayed active row.
const OUTLINE_DOT_RADIUS = 2.5;
// Space before the depth-zero chevron slot.
const OUTLINE_GUTTER = 8;
// Horizontal offset added for each outline depth.
const OUTLINE_INDENT = 12;
// Inner rail x-coordinate beside active descendants.
const OUTLINE_RAIL_X1 = OUTLINE_RAIL_X0 + OUTLINE_RAIL_JOG;
// Duration of the accent window and dot sliding between rows.
const OUTLINE_MOTION_MS = 160;
// Ease-out cubic; matches the reference TOC, no overshoot.
const OUTLINE_MOTION_EASE = "cubic-bezier(0.33, 1, 0.68, 1)";

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia === "undefined") return () => {};
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
    () => false,
  );
}

function outlineRailGeometry(depths: number[], baseDepth: number) {
  const h = OUTLINE_ROW_HEIGHT;
  const x0 = OUTLINE_RAIL_X0;
  const x1 = OUTLINE_RAIL_X1;
  const jog = OUTLINE_RAIL_JOG;
  const radius = Math.max(0, Math.min(OUTLINE_JOG_RADIUS, jog / 2, (h / 2 - 1) / 2));
  const format = (value: number) => String(Math.round(value * 1000) / 1000);
  const jogs: Array<{ rowBottom: number; direction: "out" | "in" }> = [];

  for (let position = 0; position < depths.length - 1; position++) {
    if (depths[position] !== baseDepth || depths[position + 1]! <= baseDepth) continue;
    let lastDescendant = position + 1;
    while (lastDescendant + 1 < depths.length && depths[lastDescendant + 1]! > baseDepth) lastDescendant++;
    jogs.push(
      { rowBottom: (position + 1) * h, direction: "out" },
      { rowBottom: (lastDescendant + 1) * h, direction: "in" },
    );
    position = lastDescendant;
  }

  const parts = [`M ${format(x0)} 0`];
  for (const event of jogs) {
    const yb = event.rowBottom;
    if (radius === 0) {
      parts.push(`V ${format(yb)} H ${format(event.direction === "out" ? x1 : x0)}`);
    } else if (event.direction === "out") {
      parts.push(
        `V ${format(yb - 2 * radius)}`,
        `A ${format(radius)} ${format(radius)} 0 0 0 ${format(x0 + radius)} ${format(yb - radius)}`,
        `H ${format(x1 - radius)}`,
        `A ${format(radius)} ${format(radius)} 0 0 1 ${format(x1)} ${format(yb)}`,
      );
    } else {
      parts.push(
        `V ${format(yb - 2 * radius)}`,
        `A ${format(radius)} ${format(radius)} 0 0 1 ${format(x1 - radius)} ${format(yb - radius)}`,
        `H ${format(x0 + radius)}`,
        `A ${format(radius)} ${format(radius)} 0 0 0 ${format(x0)} ${format(yb)}`,
      );
    }
  }
  parts.push(`V ${format(depths.length * h)}`);

  const extra = Math.PI * radius + jog - 4 * radius;
  const jogsAbove = (position: number) => jogs.reduce(
    (count, event) => count + (event.rowBottom <= position * h ? 1 : 0),
    0,
  );
  const top = Array.from(
    { length: depths.length + 1 },
    (_, position) => position * h + jogsAbove(position) * extra,
  );
  const centre = depths.map(
    (_, position) => position * h + h / 2 + jogsAbove(position) * extra,
  );

  return {
    d: parts.join(" "),
    total: depths.length * h + jogs.length * extra,
    top,
    centre,
  };
}

/**
 * Scroll-spy marks the active row; clicking a label scrolls to that section.
 * A faint hairline at X0 jogs to X1 beside every expanded top-level block's
 * visible descendants. The active block — the current row's top-level ancestor
 * plus visible descendants — is an accent dash window over that single path.
 * A dot marks the current row (or folded ancestor) and slides along the path.
 * CSS transitions animate stroke-dasharray/dashoffset using OUTLINE_MOTION_MS
 * and OUTLINE_MOTION_EASE; reduced motion disables them, while visible-set
 * changes remount the moving paths. OUTLINE_JOG_RADIUS=0 gives square corners.
 */
export function PanelOutlineList({
  sections, activeRow, onSelect, collapsedIds, onToggle,
}: {
  sections: OutlineSection[];
  activeRow: number | null;
  onSelect: (section: OutlineSection) => void;
  collapsedIds?: ReadonlySet<string>;
  onToggle?: (section: OutlineSection) => void;
}) {
  const hiddenDepths: number[] = [];
  const visible = sections.map((section, index) => {
    while (hiddenDepths.length && section.depth <= hiddenDepths[hiddenDepths.length - 1]!) hiddenDepths.pop();
    const rowVisible = hiddenDepths.length === 0;
    const hasChildren = (sections[index + 1]?.depth ?? -1) > section.depth;
    if (hasChildren && collapsedIds?.has(section.nodeId)) hiddenDepths.push(section.depth);
    return rowVisible;
  });
  const activeIndex = activeRow === null ? -1 : sections.findIndex((section) => section.row === activeRow);
  let displayIndex = activeIndex >= 0 && visible[activeIndex] ? activeIndex : -1;
  if (activeIndex >= 0 && displayIndex < 0) {
    for (let index = activeIndex - 1; index >= 0; index--) {
      if (visible[index] && sections[index]!.depth < sections[activeIndex]!.depth) {
        displayIndex = index;
        break;
      }
    }
  }
  const baseDepth = sections.reduce((minimum, section) => Math.min(minimum, section.depth), Infinity);
  let rootIndex = displayIndex;
  if (displayIndex >= 0) {
    for (let index = displayIndex; index >= 0; index--) {
      if (sections[index]!.depth <= baseDepth) {
        rootIndex = index;
        break;
      }
    }
  }
  let lastBlockIndex = rootIndex;
  if (rootIndex >= 0) {
    const rootDepth = sections[rootIndex]!.depth;
    for (let index = rootIndex + 1; index < sections.length; index++) {
      if (sections[index]!.depth <= rootDepth) break;
      if (visible[index]) lastBlockIndex = index;
    }
  }
  const visibleIndices = sections.flatMap((_, index) => visible[index] ? [index] : []);
  const visiblePositions = new Map(visibleIndices.map((index, position) => [index, position]));
  const geometry = outlineRailGeometry(visibleIndices.map((index) => sections[index]!.depth), baseDepth);
  const rootV = visiblePositions.get(rootIndex);
  const lastV = visiblePositions.get(lastBlockIndex);
  const displayV = visiblePositions.get(displayIndex);
  const activeStart = rootV === undefined ? 0 : geometry.top[rootV]!;
  const activeEnd = lastV === undefined ? 0 : geometry.top[lastV + 1]!;
  const activeLen = activeEnd - activeStart;
  const dotPos = displayV === undefined ? 0 : geometry.centre[displayV]!;
  const railKey = visibleIndices.map((index) => `${sections[index]!.nodeId}:${sections[index]!.row}`).join("|");
  const prefersReducedMotion = usePrefersReducedMotion();
  const railTransition = prefersReducedMotion
    ? "none"
    : `stroke-dasharray ${OUTLINE_MOTION_MS}ms ${OUTLINE_MOTION_EASE}, stroke-dashoffset ${OUTLINE_MOTION_MS}ms ${OUTLINE_MOTION_EASE}`;
  const dotTransition = prefersReducedMotion
    ? "none"
    : `stroke-dashoffset ${OUTLINE_MOTION_MS}ms ${OUTLINE_MOTION_EASE}`;

  return (
    <nav aria-label="Document outline" className="relative flex flex-col">
      {visibleIndices.length > 0 && <svg aria-hidden
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={OUTLINE_RAIL_X1 + OUTLINE_DOT_RADIUS + 2}
        height={visibleIndices.length * OUTLINE_ROW_HEIGHT}
        shapeRendering="geometricPrecision">
        <path d={geometry.d} fill="none" stroke={EDITOR_COLORS.guide} strokeWidth={1} strokeLinecap="butt" />
        {displayIndex >= 0 && <path
          // Remount moving paths when collapse/expand changes the visible geometry.
          key={`accent:${railKey}`}
          d={geometry.d} fill="none" stroke={EDITOR_COLORS.selectionAccent}
          strokeWidth={1} strokeLinecap="butt" pathLength={geometry.total}
          style={{
            strokeDasharray: `${activeLen} ${geometry.total}`,
            strokeDashoffset: -activeStart,
            transition: railTransition,
          }} />}
        {displayIndex >= 0 && <path
          key={`dot:${railKey}`}
          d={geometry.d} fill="none" stroke={EDITOR_COLORS.selectionAccent}
          strokeWidth={2 * OUTLINE_DOT_RADIUS} strokeLinecap="round" pathLength={geometry.total}
          style={{
            strokeDasharray: `0 ${geometry.total}`,
            strokeDashoffset: -dotPos,
            transition: dotTransition,
          }} />}
      </svg>}
      {sections.map((section, index) => {
        const hidden = !visible[index];
        const hasChildren = (sections[index + 1]?.depth ?? -1) > section.depth;
        const collapsed = hasChildren && !!collapsedIds?.has(section.nodeId);
        const current = section.row === activeRow;
        // A folded parent still indicates that the current section is inside it.
        let containsActive = false;
        if (collapsed && activeRow !== null) {
          for (let i = index + 1; i < sections.length && sections[i]!.depth > section.depth; i++) {
            if (sections[i]!.row === activeRow) containsActive = true;
          }
        }
        return (
          <div key={`${section.nodeId}:${section.row}`} hidden={hidden}
            data-lab-outline-row={section.nodeId}
            className="relative items-center"
            style={{ display: hidden ? "none" : "flex", height: OUTLINE_ROW_HEIGHT,
              paddingLeft: OUTLINE_GUTTER + section.depth * OUTLINE_INDENT }}>
            {hasChildren && onToggle ? <button type="button" aria-label={`Toggle ${section.label}`} aria-expanded={!collapsed}
              onClick={() => onToggle(section)} className="flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground">
              <ChevronDown size={12} aria-hidden style={{ transform: collapsed ? "rotate(-90deg)" : undefined }} />
            </button> : <span aria-hidden className="w-4 shrink-0" />}
            <button type="button" onClick={() => onSelect(section)} aria-current={current ? "location" : undefined}
              title={`<${section.label}>${containsActive ? " (contains current section)" : ""}`}
              className={cn("min-w-0 flex-1 truncate rounded-sm py-1 pr-1 text-left text-[11px] leading-4 transition-colors hover:bg-foreground/5", index === displayIndex ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              style={prefersReducedMotion ? { transition: "none" } : { transitionDuration: `${OUTLINE_MOTION_MS}ms` }}>
              {section.label}
            </button>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The FIXTURE list for the state view: selectable, the active fixture marked
 * with the same left accent the switcher uses.
 */
export function PanelFixtureList({
	fixtures,
	activeFixtureId,
	onSelect,
}: {
	fixtures: LabFixture[];
	activeFixtureId: string | null;
	onSelect: (id: string) => void;
}) {
	if (fixtures.length === 0) {
		return (
			<p className="pl-3 text-[11px] leading-relaxed text-muted-foreground/60">
				No fixtures.
			</p>
		);
	}
	return (
		<div className="flex flex-col">
			{fixtures.map((fixture) => {
				const current = fixture.id === activeFixtureId;
				return (
					<button
						key={fixture.id}
						type="button"
						data-lab-fixture={fixture.id}
						aria-pressed={current}
						onClick={() => onSelect(fixture.id)}
						className={cn(
							"border-l py-0.5 pl-3 pr-2 text-left text-[12px] transition-colors",
							current
								? "text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
						style={
							current
								? { borderLeftColor: EDITOR_COLORS.selectionAccent }
								: undefined
						}
					>
						<span className="block truncate">{fixture.label}</span>
					</button>
				);
			})}
		</div>
	);
}

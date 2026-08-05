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
import type { ReactNode } from "react";

import { EDITOR_COLORS } from "../surface/editor-surface";
import type { OutlineSection } from "../editor/buffer/SectionOutline";
import type { LabFixture } from "./StateSurface";

/**
 * The dock's view switcher vocabulary. `state` appears only when the host
 * supplies a `stateZone`.
 */
export type LabView = "system" | "context" | "state";

/** One switcher row: the view plus its estimated token count. */
export interface LabDockView {
	id: LabView;
	tokens: number;
}

/**
 * One dock zone: micro-header (uppercase, letter-spaced, faint) over a quiet
 * body. The optional `action` slot rides the header's right edge in normal
 * case — the ANNOTATE toggle and the open-request count live there.
 */
export function DockZone({
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
			    from one stylesheet — see AnnotateAmbient. */}
			<div
				data-lab-zone-header=""
				className="flex items-center gap-2 pb-1.5 pt-2.5 text-[12px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors"
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
export function DockViewSwitcher({
	views,
	active,
	onSelect,
	rowSublines,
}: {
	views: LabDockView[];
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

/**
 * The dock outline: the same wayfinding contract the editor's old outline
 * column carried (scroll-spy active row, click scrolls the buffer), restyled
 * as a quiet dock list — tighter and dimmer than the switcher above it.
 */
export function DockOutlineList({
	sections,
	activeRow,
	onSelect,
}: {
	sections: OutlineSection[];
	/** Row index of the section currently at the top of the viewport. */
	activeRow: number | null;
	onSelect: (section: OutlineSection) => void;
}) {
	return (
		<nav aria-label="Document outline" className="flex flex-col">
			{sections.map((section) => {
				const current = section.row === activeRow;
				return (
					<button
						key={`${section.nodeId}:${section.row}`}
						type="button"
						onClick={() => onSelect(section)}
						aria-current={current ? "location" : undefined}
						title={`<${section.label}>`}
						className={cn(
							"border-l py-px pr-2 text-left text-[11px] leading-[1.9] transition-colors",
							section.depth > 0 ? "pl-6" : "pl-3",
							current
								? "text-foreground"
								: "border-transparent text-muted-foreground/70 hover:text-foreground",
						)}
						style={
							current
								? { borderLeftColor: EDITOR_COLORS.selectionAccent }
								: undefined
						}
					>
						<span className="block truncate">{section.label}</span>
					</button>
				);
			})}
		</nav>
	);
}

/**
 * The FIXTURE list for the state view: selectable, the active fixture marked
 * with the same left accent the switcher uses.
 */
export function DockFixtureList({
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

// Read-only STATE surface: the rendered state document for the active fixture
// on the same document surface style as the context preview (shared editor
// background, PromptView rendering, native selection/copy only). The fixture
// list and the outline live in the dock — this surface is only the buffer.
"use client";

import { EDITOR_COLORS, EDITOR_METRICS } from "../../surface/editor-surface";
import { PromptView } from "../../view/PromptView";

/** One selectable state fixture in the dock's FIXTURE zone. */
export interface LabFixture {
	id: string;
	label: string;
}

/**
 * The STATE view's host contract. When present the dock's view switcher gains
 * a `state` entry; the surface renders `renderedState` read-only for the
 * active fixture (null = loading/none).
 */
export interface LabStateZone {
	fixtures: LabFixture[];
	activeFixtureId: string | null;
	onFixtureSelect: (id: string) => void;
	/** Rendered state document for the active fixture; null = loading/none. */
	renderedState: string | null;
}

export function StateSurface({
	stateZone,
	centerContent = false,
}: {
	stateZone: LabStateZone;
	/**
	 * Center the content column inside the full-width scroller (the lab's
	 * wide layout) at the same `--prompt-editor-content-width` measure the
	 * SYSTEM and CONTEXT views use, so all three views align.
	 */
	centerContent?: boolean;
}) {
	const rendered = stateZone.renderedState ?? "";
	const hasContent = rendered.trim().length > 0;

	return (
		<div
			className="flex h-full min-h-0 min-w-0 flex-1 flex-col font-mono"
			style={{ background: EDITOR_COLORS.bg }}
		>
			{hasContent ? (
				<div
					data-context-scroll="state"
					className="min-h-0 min-w-0 flex-1 overflow-auto"
					style={{
						// The lab's floating glass reserves space inside the scroller
						// (scrollbar stays at the region's far right).
						paddingRight: "var(--prompt-editor-reserved-right, 0px)",
						transition:
							"padding-right 260ms cubic-bezier(0.32, 0.72, 0, 1)",
					}}
				>
					{/* Same breathing room the editor gives line 1 / the last line.
					    When the host centers, this column carries the content cap and
					    auto margins — the scroller stays full width so its scrollbar
					    hugs the region's far edge. */}
					<div
						style={{
							paddingBlock: EDITOR_METRICS.lineHeight,
							// The editor's own type on the column so the `ch`-based cap
							// resolves in editor characters (PromptView re-applies its
							// type inside), keeping this column the exact width of the
							// SYSTEM one — left-justified at the shared margins.
							fontFamily: EDITOR_METRICS.fontFamily,
							fontSize: EDITOR_METRICS.fontSize,
							maxWidth: EDITOR_METRICS.contentWidth,
							marginInline: "var(--prompt-editor-margin-left, 0px) auto",
							marginTop: "var(--prompt-editor-margin-top, 0px)",
						}}
					>
						<PromptView content={rendered} title="State" bare inheritStyle />
					</div>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 items-center justify-center p-6">
					<p className="max-w-64 text-center text-[12px] leading-relaxed text-muted-foreground/70">
						{stateZone.fixtures.length === 0
							? "No state fixtures for this agent."
							: stateZone.renderedState === null
								? "No rendered state for this fixture yet."
								: "The rendered state for this fixture is empty."}
					</p>
				</div>
			)}
		</div>
	);
}

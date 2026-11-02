"use client";

import { EDITOR_METRICS } from "../../surface/editor-surface";

/**
 * A blank writing position, accessible by pointer or keyboard. The row keeps
 * the buffer's line height. The button centers on it and grows to the
 * design system's large control height, so the hit target never drops under
 * it while the rhythm of the rows stays the same.
 */
export function InsertionSlot({
	label,
	onInsert,
	height = EDITOR_METRICS.lineHeight,
}: {
	label: string;
	onInsert: () => void;
	height?: string;
}) {
	return (
		<div className="relative" style={{ height }}>
			<button
				type="button"
				aria-label={label}
				title="Click to write here. Type / to choose a block."
				data-prompt-affordance="insert"
				className="absolute block cursor-text border-0 bg-transparent p-0 text-left outline-none focus-visible:bg-foreground/5 focus-visible:[outline:var(--ds-border-width-focus)_solid_var(--ds-color-focus-ring)] focus-visible:[outline-offset:calc(-1*var(--ds-border-width-focus))]"
				style={{ insetInline: 0, top: "50%", transform: "translateY(-50%)", height: "100%", minHeight: "var(--ds-control-height-lg)" }}
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					onInsert();
				}}
			/>
		</div>
	);
}

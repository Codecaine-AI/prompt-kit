"use client";

import { EDITOR_METRICS } from "../../surface/editor-surface";

/** A blank writing position, accessible by pointer or keyboard. */
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
		<div style={{ height }}>
			<button
				type="button"
				aria-label={label}
				title="Click to write here. Type / to choose a block."
				data-prompt-affordance="insert"
				className="block w-full cursor-text border-0 bg-transparent p-0 text-left outline-none focus-visible:bg-foreground/5"
				style={{ height: "100%" }}
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					onInsert();
				}}
			/>
		</div>
	);
}

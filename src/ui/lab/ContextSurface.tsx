// Read-only CONTEXT surface: the assembled context preview rendered on the
// shared editor surface (same gutter, grid, zebra tokens, and opportunistic
// XML highlighting as the prompt views) via PromptView. Read-only means no
// hover/insert/drag affordances — native selection/copy only, and the
// rendered text stays byte-exact. The context token count surfaces in the lab
// statusbar, not here.

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
} from "../surface/editor-surface";
import { PromptView } from "../view/PromptView";

export interface LabContextPreview {
	renderedContext?: string | null;
	inputs?: Array<{ loaderKind: string; inputRef: string; status: string; bytes: number }>;
	modulePath?: string | null;
}

export function ContextSurface({ context }: { context?: LabContextPreview }) {
	const rendered = context?.renderedContext ?? "";
	const hasContent = rendered.trim().length > 0;

	return (
		<div
			className="flex h-full min-h-0 min-w-0 flex-1 flex-col font-mono"
			style={{ background: EDITOR_COLORS.bg }}
		>
			{hasContent ? (
				<div className="min-h-0 min-w-0 flex-1 overflow-auto">
					{/* Same breathing room the editor gives line 1 / the last line. */}
					<div style={{ paddingBlock: EDITOR_METRICS.lineHeight }}>
						<PromptView content={rendered} title="Context" bare inheritStyle />
					</div>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 items-center justify-center p-6">
					<p className="max-w-64 text-center text-[12px] leading-relaxed text-muted-foreground/70">
						{context?.modulePath
							? "The context preview could not be assembled for this agent."
							: "This agent has no context module."}
					</p>
				</div>
			)}
		</div>
	);
}

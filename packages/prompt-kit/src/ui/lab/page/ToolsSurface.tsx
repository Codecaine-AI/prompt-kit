// Read-only TOOLS surface: the agent's runtime tool surface rendered as a
// document on the same surface style as the context preview (shared editor
// background, PromptView rendering, native selection/copy only). The outline
// lives in the dock — this surface is only the buffer.
"use client";

import { EDITOR_COLORS, EDITOR_METRICS } from "../../surface/editor-surface";
import { PromptView } from "../../view/PromptView";

/**
 * The TOOLS view's host contract. When present the dock's view switcher
 * gains a `tools` entry; the surface renders `renderedTools` — a pseudo-XML
 * document the host builds from the agent's tool definitions (one
 * `<tool name="…">` element per tool, so the shared outline labels rows by
 * tool name). null = the host has no tool preview for this agent.
 */
export interface LabToolsZone {
	renderedTools: string | null;
}

export function ToolsSurface({
	toolsZone,
	centerContent = false,
}: {
	toolsZone: LabToolsZone;
	/**
	 * Center the content column inside the full-width scroller (the lab's
	 * wide layout) at the same `--prompt-editor-content-width` measure the
	 * SYSTEM and CONTEXT views use, so all views align.
	 */
	centerContent?: boolean;
}) {
	const rendered = toolsZone.renderedTools ?? "";
	const hasContent = rendered.trim().length > 0;

	return (
		<div
			className="flex h-full min-h-0 min-w-0 flex-1 flex-col font-mono"
			style={{ background: EDITOR_COLORS.bg }}
		>
			{hasContent ? (
				<div
					data-context-scroll="tools"
					className="min-h-0 min-w-0 flex-1 overflow-auto"
					style={{
						paddingRight: "var(--prompt-editor-reserved-right, 0px)",
						transition:
							"padding-right 260ms cubic-bezier(0.32, 0.72, 0, 1)",
					}}
				>
					<div
						style={{
							paddingBlock: EDITOR_METRICS.lineHeight,
							fontFamily: EDITOR_METRICS.fontFamily,
							fontSize: EDITOR_METRICS.fontSize,
							maxWidth: EDITOR_METRICS.contentWidth,
							marginInline: "var(--prompt-editor-margin-left, 0px) auto",
							marginTop: "var(--prompt-editor-margin-top, 0px)",
						}}
					>
						<PromptView content={rendered} title="Tools" bare inheritStyle />
					</div>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 items-center justify-center p-6">
					<p className="max-w-64 text-center text-[12px] leading-relaxed text-muted-foreground/70">
						No tool preview for this agent.
					</p>
				</div>
			)}
		</div>
	);
}

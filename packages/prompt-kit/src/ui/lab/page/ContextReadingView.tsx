"use client";

import { EDITOR_COLORS, EDITOR_METRICS } from "../../surface/editor-surface";
import { PromptView } from "../../view/PromptView";
import type { ContextReadingPart } from "./context-reading-model";

function fieldLabel(key: string): string {
	const words = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function ContextValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
	if (value === null) return <code style={{ color: EDITOR_COLORS.syntaxValue }}>null</code>;
	if (typeof value !== "object") return <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: typeof value === "string" ? EDITOR_COLORS.fg : EDITOR_COLORS.inlineCode }}>{String(value) || '""'}</span>;
	if (depth >= 8) return <pre className="whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>;
	if (Array.isArray(value)) {
		if (!value.length) return <code style={{ color: EDITOR_COLORS.syntaxValue }}>[]</code>;
		return <ol className="m-0 grid list-none gap-3 p-0">
			{value.map((item, index) => <li key={index} className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
				<span aria-hidden="true" className="pt-0.5 text-[11px] tabular-nums" style={{ color: EDITOR_COLORS.syntaxPunctuation }}>{index + 1}.</span>
				<div className="min-w-0"><ContextValue value={item} depth={depth + 1} /></div>
			</li>)}
		</ol>;
	}
	const entries = Object.entries(value);
	if (!entries.length) return <code style={{ color: EDITOR_COLORS.syntaxValue }}>{"{}"}</code>;
	return <dl className="m-0 grid min-w-0 gap-5">
		{entries.map(([key, entry]) => {
			const grouped = entry !== null && typeof entry === "object";
			return <div key={key} className="min-w-0">
				<dt title={key} className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em]" style={{ color: EDITOR_COLORS.syntaxAttribute }}>{fieldLabel(key)}</dt>
				<dd className="m-0 min-w-0" style={grouped ? { borderLeft: `1px solid ${EDITOR_COLORS.guide}`, paddingLeft: "1rem", marginTop: ".75rem" } : undefined}>
					<ContextValue value={entry} depth={depth + 1} />
				</dd>
			</div>;
		})}
	</dl>;
}

export function ContextReadingView({ parts }: { parts: ContextReadingPart[] }) {
	return <div data-context-formatted="">
		{parts.map(part => part.kind === "source"
			? <PromptView key={part.row} content={part.content} title="Context" bare inheritStyle rowOffset={part.row} />
			: <div key={part.row} data-prompt-row={part.row} className="min-w-0 px-6 py-5" style={{ fontFamily: EDITOR_METRICS.fontFamily, fontSize: EDITOR_METRICS.fontSize, lineHeight: "1.7", color: EDITOR_COLORS.fg }}>
				<ContextValue value={part.value} />
			</div>)}
	</div>;
}

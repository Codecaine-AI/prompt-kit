// Outline entries for the read-only CONTEXT surface.
//
// The SYSTEM view derives its wayfinding column from the editable document
// model; the context preview is only a rendered string, so the same structure
// is recovered from the text with the shared rendered-line classifier. Same
// rule as the editor's column: one entry per top-level open tag plus its
// depth-1 container children, names only.

import type { OutlineSection } from "../editor/buffer/SectionOutline";
import { classifyRenderedLines } from "../view/rendered-line-model";

/** Tag name of an open-tag line, e.g. `    <phase name="plan">` → "phase". */
const TAG_NAME = /^\s*<([A-Za-z][\w-]*)/;
/** A `name="…"` attribute on the same line, quoted either way. */
const NAME_ATTR = /\sname\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/**
 * Wayfinding label for one rendered open-tag line. Mirrors the editor's
 * `outlineSectionLabel`: a `name` attribute wins (five `<phase>` tags all
 * labeled "phase" is no map), otherwise the bare tag name.
 */
export function contextSectionLabel(line: string): string {
	const named = line.match(NAME_ATTR);
	const name = (named?.[1] ?? named?.[2] ?? "").trim();
	if (name.length > 0) return name;
	return line.match(TAG_NAME)?.[1] ?? "";
}

/**
 * Outline entries for a rendered context string. `row` is the zero-based
 * line index, which is also the anchor the surface scrolls to.
 */
export function contextOutlineSections(content: string): OutlineSection[] {
	if (content.trim().length === 0) return [];
	const lines = content.split("\n");
	const infos = classifyRenderedLines(content);
	const sections: OutlineSection[] = [];
	infos.forEach((info, index) => {
		if (info.role !== "open" || info.depth > 1) return;
		const label = contextSectionLabel(lines[index] ?? "");
		if (label.length === 0) return;
		sections.push({
			row: index,
			// The rendered string has no node identity; the line index is the
			// only stable handle, and it is what the anchor uses.
			nodeId: `context:${index}`,
			label,
			depth: info.depth,
		});
	});
	return sections;
}

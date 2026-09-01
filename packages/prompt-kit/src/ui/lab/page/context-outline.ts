// Outline entries for the read-only CONTEXT surface.
//
// The SYSTEM view derives its wayfinding column from the editable document
// model; the context preview is only a rendered string, so the same structure
// is recovered from the text with the shared rendered-line classifier. Same
// rule as the editor's column: one entry per top-level open tag plus its
// depth-1 container children, names only.

import type { OutlineSection } from "../../editor/buffer/SectionOutline";
import { classifyRenderedLines } from "../../view/rendered-line-model";

/** Tag name of an open-tag line, e.g. `    <phase name="plan">` → "phase". */
const TAG_NAME = /^\s*<([A-Za-z][\w-]*)/;
/** A `name="…"` attribute on the same line, quoted either way. */
const NAME_ATTR = /\sname\s*=\s*(?:"([^"]*)"|'([^']*)')/;
/** A `title="…"` attribute on the same line, quoted either way. */
const TITLE_ATTR = /\stitle\s*=\s*(?:"([^"]*)"|'([^']*)')/;
/** A `path="…"` attribute on the same line, quoted either way. */
const PATH_ATTR = /\spath\s*=\s*(?:"([^"]*)"|'([^']*)')/;

function attrValue(line: string, pattern: RegExp): string {
	const matched = line.match(pattern);
	return (matched?.[1] ?? matched?.[2] ?? "").trim();
}

/**
 * Wayfinding label for one rendered open-tag line. Mirrors the editor's
 * `outlineSectionLabel`: an identity attribute wins (five `<doc>` tags all
 * labeled "doc" is no map) — `name`, then `title`, then `path` — otherwise
 * the bare tag name.
 */
export function contextSectionLabel(line: string): string {
	for (const pattern of [NAME_ATTR, TITLE_ATTR, PATH_ATTR]) {
		const value = attrValue(line, pattern);
		if (value.length > 0) return value;
	}
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
		let labelSource = lines[index] ?? "";
		if (!labelSource.includes(">")) {
			for (let cursor = index + 1; cursor < lines.length; cursor++) {
				labelSource += `\n${lines[cursor] ?? ""}`;
				if (infos[cursor]?.role === "close") break;
			}
		}
		const label = contextSectionLabel(labelSource);
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

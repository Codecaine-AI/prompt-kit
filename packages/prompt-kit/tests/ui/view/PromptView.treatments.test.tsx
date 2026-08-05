import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EDITOR_COLORS, EDITOR_METRICS } from "../../../src/ui/surface/editor-surface";
import { PromptView } from "../../../src/ui/view/PromptView";

const PROMPT = [
	"<system>", // 0: landmark open, depth 0
	"    intro prose", // 1: content, depth 1
	"", // 2: gap before a depth-1 open -> sub height
	"    <rules>", // 3: sub-landmark open, depth 1
	"        - keep it short", // 4: item, depth 2
	"", // 5: gap before content -> base height
	"        prose with an inline <look> mention", // 6: content, depth 2
	"    </rules>", // 7: close, depth 1
	"</system>", // 8: close, depth 0
	"", // 9: gap before a depth-0 open -> top height
	"<user>", // 10: landmark open, depth 0
	"    hi", // 11: content, depth 1
	"</user>", // 12: close, depth 0
].join("\n");

function renderView(content: string): string {
	return renderToStaticMarkup(<PromptView content={content} title="Prompt" />);
}

function rowsOf(markup: string): string[] {
	return markup.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
}

/** Text of one row's content cell (second td), entities decoded. */
function rowText(row: string): string {
	const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [];
	const content = cells[1] ?? "";
	return content
		.replace(/<[^>]+>/g, "")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&");
}

describe("PromptView structural treatments", () => {
	const markup = renderView(PROMPT);
	const rows = rowsOf(markup);

	test("displayed text stays byte-identical to the input string", () => {
		const lines = PROMPT.split("\n");
		expect(rows.length).toBe(lines.length);
		for (const [index, line] of lines.entries()) {
			// Empty lines render a single non-breaking space placeholder;
			// every other line must round-trip byte-exact.
			const expected = line.length === 0 ? " " : line;
			expect(rowText(rows[index])).toBe(expected);
		}
	});

	test("top-level open rows take the landmark color, scale, wash, and band padding", () => {
		for (const row of [rows[0], rows[10]]) {
			expect(row).toContain(
				`--prompt-editor-syntax-tag:${EDITOR_COLORS.syntaxTagLandmark}`,
			);
			expect(row).toContain(
				`font-size:calc(var(--prompt-editor-font-size, 13px) * ${EDITOR_METRICS.landmarkFontScale})`,
			);
			// The landmark wash the editable surface paints on section starts.
			expect(row).toContain(
				`background-color:${EDITOR_COLORS.landmark}`,
			);
			// Both cells share the band padding, so gutter number and tag move
			// together and the row grows into a band.
			const bandCells =
				row.match(/<td[^>]*>[\s\S]*?<\/td>/g)?.filter((cell) =>
					cell.includes(`padding-block:${EDITOR_METRICS.landmarkPad}`),
				) ?? [];
			expect(bandCells.length).toBe(2);
		}
	});

	test("second-level open rows take the sub-landmark tag color, no scale, no band", () => {
		const row = rows[3];
		expect(row).toContain(
			`--prompt-editor-syntax-tag:${EDITOR_COLORS.syntaxTagSublandmark}`,
		);
		expect(row).not.toContain("font-size:calc(");
		expect(row).not.toContain(
			`padding-block:${EDITOR_METRICS.landmarkPad}`,
		);
	});

	test("close rows mirror their opener's tier color, brackets included", () => {
		// Depth-0 closes speak the landmark ink (color only, no scale).
		for (const row of [rows[8], rows[12]]) {
			expect(row).toContain(
				`--prompt-editor-syntax-tag:${EDITOR_COLORS.syntaxTagLandmark}`,
			);
			expect(row).toContain(
				`--prompt-editor-syntax-punctuation:${EDITOR_COLORS.syntaxTagLandmark}`,
			);
			expect(row).not.toContain("font-size:calc(");
		}
		// Depth-1 closes speak the sub-landmark ink.
		expect(rows[7]).toContain(
			`--prompt-editor-syntax-tag:${EDITOR_COLORS.syntaxTagSublandmark}`,
		);
		expect(rows[7]).toContain(
			`--prompt-editor-syntax-punctuation:${EDITOR_COLORS.syntaxTagSublandmark}`,
		);
		// Open rows keep the stock punctuation variable.
		expect(rows[0]).not.toContain("--prompt-editor-syntax-punctuation:");
		expect(rows[3]).not.toContain("--prompt-editor-syntax-punctuation:");
	});

	test("only gaps that precede a section start take the tiered heights", () => {
		expect(rows[9]).toContain(`height:${EDITOR_METRICS.gapHeightTop}`);
		expect(rows[2]).toContain(`height:${EDITOR_METRICS.gapHeightSub}`);
		// A paragraph break inside a section stays one line tall.
		expect(rows[5]).toContain(`height:${EDITOR_METRICS.gapHeightBase}`);
		// Non-gap rows never get an explicit height.
		expect(rows[0]).not.toContain("height:");
	});

	test("indented rows paint one guide stripe per enclosing container", () => {
		// Depth-1 row: ONE stripe, under the top-level container's own column.
		expect(rows[1]).toContain("background-position:calc(0.75rem + 0px) 0");
		expect(rows[1]).not.toContain(
			`calc(0.75rem + calc(${indentTimes(2)})) 0`,
		);
		// Depth-2 row: a second stripe under the depth-1 container's column —
		// never one at the row's own text column.
		expect(rows[4]).toContain("calc(0.75rem + 0px) 0");
		expect(rows[4]).toContain(`calc(0.75rem + calc(${indentTimes(2)})) 0`);
		expect(rows[4]).not.toContain(
			`calc(0.75rem + calc(${indentTimes(4)})) 0`,
		);
		// Stripes honor the rail's show-guides toggle and the guide ink.
		expect(rows[1]).toContain("--prompt-editor-show-guides, 1");
		expect(rows[1]).toContain("--prompt-editor-guide");
		// Depth-0 rows have no guide layers.
		expect(rows[0]).not.toContain("background-image:linear-gradient");
	});

	test("guides run through gap and close rows at their stack depth", () => {
		// Gap at depth 2 keeps both stripes; close at depth 1 keeps one.
		expect(rows[5]).toContain("calc(0.75rem + 0px) 0");
		expect(rows[5]).toContain(`calc(0.75rem + calc(${indentTimes(2)})) 0`);
		expect(rows[7]).toContain(
			"background-position:calc(0.75rem + 0px) 0",
		);
		// Top-level close and top-level gap rows carry none.
		expect(rows[8]).not.toContain("background-image:linear-gradient");
		expect(rows[9]).not.toContain("background-image:linear-gradient");
	});

	test("zebra striping is retired — no row carries the zebra token", () => {
		for (const row of rows) {
			expect(row).not.toContain("--prompt-editor-row-zebra:");
		}
	});

	test("fenced XML-looking lines get no structural treatment", () => {
		const fenced = renderView(
			["```", "<system>", "</system>", "```"].join("\n"),
		);
		// The root projects persisted style vars; the ROWS must stay untreated.
		for (const row of rowsOf(fenced)) {
			expect(row).not.toContain("--prompt-editor-syntax-tag:");
			expect(row).not.toContain("--prompt-editor-syntax-punctuation:");
			expect(row).not.toContain("font-size:calc(");
		}
	});
});

function indentTimes(count: number): string {
	return Array.from({ length: count }, () => EDITOR_METRICS.indentWidth).join(
		" + ",
	);
}

import { describe, expect, test } from "bun:test";

import { DEFAULT_INDENT } from "../../../src/index";
import { promptEditorIndentForSpaces } from "../../../src/ui/surface/editor-surface";
import { promptFlowIndentForDepth } from "../../../src/ui/editor/buffer/node-geometry";

/**
 * Guides and the drop line must sit exactly where the row TEXT sits. Row text
 * gets its indent from promptEditorIndentForSpaces over the renderer's real
 * leading spaces (DEFAULT_INDENT per level), so the depth-based overlay math
 * must resolve to the identical expression.
 */
describe("prompt-flow indent alignment", () => {
	test("depth offsets equal the text indent of the same depth", () => {
		for (const depth of [0, 1, 2, 3]) {
			expect(promptFlowIndentForDepth(depth)).toBe(
				promptEditorIndentForSpaces(depth * DEFAULT_INDENT.length),
			);
		}
	});

	test("one depth level advances by TWO indent widths (four spaces)", () => {
		expect(DEFAULT_INDENT).toBe("    ");
		expect(promptFlowIndentForDepth(0)).toBe("0px");
		expect(promptFlowIndentForDepth(1)).toBe(
			"calc(var(--prompt-editor-indent-width, 2ch) + var(--prompt-editor-indent-width, 2ch))",
		);
	});
});

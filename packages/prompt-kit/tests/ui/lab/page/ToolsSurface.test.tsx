import { describe, expect, test } from "bun:test";

import { formatToolsForDisplay } from "../../../../src/ui/lab/page/ToolsSurface";

describe("formatToolsForDisplay", () => {
	test("expands tool elements with two or more attributes", () => {
		const source = [
			"<available_tools>",
			'    <tool name="kv2_search" label="Search knowledge" use_when="A value with \\"quotes\\" and spaces" />',
			"</available_tools>",
		].join("\n");
		expect(formatToolsForDisplay(source)).toBe([
			"<available_tools>",
			"    <tool",
			'        name="kv2_search"',
			'        label="Search knowledge"',
			'        use_when="A value with \\"quotes\\" and spaces"',
			"    />",
			"</available_tools>",
		].join("\n"));
	});

	test("preserves wrapper, non-tool lines, and single-attribute tools", () => {
		const source = [
			"<available_tools>",
			"literal content  ",
			'    <tool name="one" />',
			"</available_tools>",
		].join("\n");
		expect(formatToolsForDisplay(source)).toBe(source);
	});

	test("leaves malformed tool lines verbatim", () => {
		const source = [
			"<available_tools>",
			'    <tool name="broken label="Still broken" />',
			"</available_tools>",
		].join("\n");
		expect(formatToolsForDisplay(source)).toBe(source);
	});
});

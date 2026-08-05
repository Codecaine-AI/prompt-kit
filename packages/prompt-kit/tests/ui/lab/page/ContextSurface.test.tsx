import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ContextSurface } from "../../../../src/ui/lab/page/ContextSurface";
import { contextOutlineSections } from "../../../../src/ui/lab/page/context-outline";

afterEach(() => {
	cleanup();
});

// Two top-level sections plus one depth-1 container, and one `name` attribute
// so the label rule (name wins over tag) is exercised.
const SECTIONED = [
	"<repo_files>",
	'    <file path="a.ts">',
	"        export const a = 1;",
	"    </file>",
	"</repo_files>",
	'<task name="summary">',
	"    Summarize the diff.",
	"</task>",
].join("\n");

function outline(): HTMLElement | null {
	return screen.queryByRole("navigation", { name: "Prompt sections" });
}

describe("ContextSurface outline", () => {
	test("lists the preview's sections, names only", () => {
		render(<ContextSurface context={{ renderedContext: SECTIONED }} />);
		const nav = outline();
		expect(nav).not.toBeNull();
		// A map, not a chart: an entry's visible content is exactly its name.
		expect(nav?.textContent).toBe("repo_filesfilesummary");
		expect(nav?.textContent).not.toMatch(/\d/);
	});

	test("every entry has a scroll anchor row in the buffer", () => {
		const { container } = render(
			<ContextSurface context={{ renderedContext: SECTIONED }} />,
		);
		for (const section of contextOutlineSections(SECTIONED)) {
			expect(
				container.querySelector(`[data-prompt-row="${section.row}"]`),
			).not.toBeNull();
		}
	});

	test("clicking an entry scrolls the buffer and marks it active", () => {
		const { container } = render(
			<ContextSurface context={{ renderedContext: SECTIONED }} />,
		);
		const scroller = container.querySelector<HTMLElement>(
			'[data-context-scroll="context"]',
		);
		expect(scroller).not.toBeNull();
		const calls: Array<{ top?: number }> = [];
		Object.defineProperty(scroller!, "scrollTo", {
			configurable: true,
			value: (options: { top?: number }) => {
				calls.push(options);
			},
		});

		fireEvent.click(screen.getByRole("button", { name: "repo_files" }));

		expect(calls.length).toBe(1);
		expect(
			screen
				.getByRole("button", { name: "repo_files" })
				.getAttribute("aria-current"),
		).toBe("location");
		expect(
			screen.getByRole("button", { name: "summary" }).getAttribute(
				"aria-current",
			),
		).toBeNull();
	});

	test("flat text and absent context show no outline", () => {
		const { rerender } = render(
			<ContextSurface
				context={{ renderedContext: "just some prose\nno tags here" }}
			/>,
		);
		expect(outline()).toBeNull();

		rerender(<ContextSurface context={{ renderedContext: "   " }} />);
		expect(outline()).toBeNull();

		rerender(<ContextSurface />);
		expect(outline()).toBeNull();
		expect(screen.getByText(/This agent has no context module/)).toBeDefined();
	});

	test("the host's width guard suppresses the column", () => {
		render(
			<ContextSurface
				context={{ renderedContext: SECTIONED }}
				showOutline={false}
			/>,
		);
		expect(outline()).toBeNull();
	});
});

describe("contextOutlineSections", () => {
	test("entries are top-level opens plus depth-1 containers, name attribute first", () => {
		expect(contextOutlineSections(SECTIONED)).toEqual([
			{ row: 0, nodeId: "context:0", label: "repo_files", depth: 0 },
			{ row: 1, nodeId: "context:1", label: "file", depth: 1 },
			{ row: 5, nodeId: "context:5", label: "summary", depth: 0 },
		]);
	});

	test("deeper containers, self-closing tags, and fenced text are not entries", () => {
		const content = [
			"<a>",
			"    <b>",
			"        <c>",
			"        </c>",
			"    </b>",
			"    <meta ref=\"x\" />",
			"    ```",
			"    <d>",
			"    ```",
			"</a>",
		].join("\n");
		expect(contextOutlineSections(content).map((s) => s.label)).toEqual([
			"a",
			"b",
		]);
	});
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EDITOR_COLORS } from "../../../src/ui/surface/editor-surface";
import { highlightXmlLine } from "../../../src/ui/surface/xml-highlight";

/**
 * Inline chips (backtick code spans, {{variable}} tokens) are paint only: the
 * DOM text of a highlighted line must stay byte-identical to the input, and
 * the chip treatment must ride on the shared surface tokens.
 */
describe("xml-highlight inline chips", () => {
	test("backtick spans keep the line byte-exact", () => {
		const line = "    Use `place_sticky` before `commit`, never after.";
		expect(textFromMarkup(render(line))).toBe(line);
	});

	test("backtick spans render as inline-code chips with dimmed ticks", () => {
		const markup = render("Run `ls` now");
		expect(markup).toContain("--prompt-editor-inline-code");
		expect(markup).toContain("--prompt-editor-inline-chip-bg");
		expect(markup).toContain(`color:${EDITOR_COLORS.inlineCode}`);
		expect(markup).toContain(`background:${EDITOR_COLORS.inlineChipBg}`);
		// The tick characters stay in the text, dimmed inside the chip — but
		// only while chips are visible: the dim rides the chip-opacity token,
		// so zeroing it (classic) restores full-opacity plain ticks.
		expect(markup).toContain(
			'<span style="opacity:calc(1 - clamp(0, var(--prompt-editor-inline-chip-opacity, 0.08) * 100, 0.5))">`</span>',
		);
	});

	test("variable tokens keep their ink and gain a color-mix chip", () => {
		const markup = render("Use {{topic}} here");
		expect(markup).toContain("--prompt-editor-syntax-variable");
		expect(markup).toContain(
			"color-mix(in srgb, var(--prompt-editor-syntax-variable, #D9C578) calc(var(--prompt-editor-inline-chip-opacity, 0.08) * 100%), transparent)",
		);
	});

	test("reference tokens keep the reference ink without a variable chip", () => {
		const markup = render("Call {{tool:search}} first");
		expect(markup).toContain(`color:${EDITOR_COLORS.syntaxReference}`);
		expect(markup).not.toContain("color-mix");
	});

	test("mixed tag + chip + variable line stays byte-exact", () => {
		const line =
			'  <hint level="2">Run `ls -la` with {{path}} and {{tool:search}} via `bun test`</hint>';
		const markup = render(line);
		expect(textFromMarkup(markup)).toBe(line);
		expect(markup).toContain("--prompt-editor-inline-code");
		expect(markup).toContain("--prompt-editor-syntax-tag");
	});

	test("unclosed ticks and empty spans render as plain text", () => {
		for (const line of ["a ` stray tick", "``", "```ts"]) {
			const markup = render(line);
			expect(textFromMarkup(markup)).toBe(line);
			expect(markup).not.toContain("--prompt-editor-inline-code");
		}
	});

	test("piece counting stays in lockstep — no duplicate-key warnings", () => {
		// countInlinePieces is the highlighter's hand-maintained React-key
		// budget. If it undercounts the combined token pattern, React logs a
		// duplicate-key error during render.
		const line =
			"<a>`x` {{v}} `y` plain {{tool:z}} tail</a> mid `q` {{w}} end";
		const seen: string[] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => {
			seen.push(args.map(String).join(" "));
		};
		try {
			const markup = render(line);
			expect(textFromMarkup(markup)).toBe(line);
		} finally {
			console.error = original;
		}
		expect(seen.filter((message) => message.includes("key"))).toEqual([]);
	});
});

function render(line: string): string {
	return renderToStaticMarkup(<>{highlightXmlLine(line)}</>);
}

function textFromMarkup(markup: string): string {
	return markup
		.replace(/<[^>]+>/g, "")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&");
}

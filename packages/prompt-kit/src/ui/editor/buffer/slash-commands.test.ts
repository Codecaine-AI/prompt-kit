import { describe, expect, it } from "bun:test";

import { INSERT_OPTIONS } from "../shared";
import {
	SLASH_COMMANDS,
	matchSlashCommands,
	type SlashCommandId,
} from "./slash-commands";

const CANONICAL: SlashCommandId[] = [
	"text",
	"section",
	"bullets",
	"steps",
	"code",
];

function ids(query: string): SlashCommandId[] {
	return matchSlashCommands(query).map((command) => command.id);
}

describe("slash command vocabulary", () => {
	it("is exactly the five authoring blocks, in canonical order", () => {
		expect(SLASH_COMMANDS.map((command) => command.id)).toEqual(CANONICAL);
	});

	it("mirrors the insert palette's block types and order", () => {
		expect(SLASH_COMMANDS.map((command) => command.type)).toEqual(
			INSERT_OPTIONS.map((option) => option.type),
		);
		expect(SLASH_COMMANDS.map((command) => command.label)).toEqual(
			INSERT_OPTIONS.map((option) => option.label),
		);
	});

	it("offers no removed block type", () => {
		const types = SLASH_COMMANDS.map((command) => command.type);
		for (const dropped of ["field", "contextUsage", "example", "raw"] as const) {
			expect(types.includes(dropped)).toBe(false);
		}
	});

	it("gives every command a description and at least one alias", () => {
		for (const command of SLASH_COMMANDS) {
			expect(command.description.length).toBeGreaterThan(0);
			expect(command.aliases.length).toBeGreaterThan(0);
		}
	});
});

describe("matchSlashCommands — empty query", () => {
	it("returns every command in canonical order", () => {
		expect(ids("")).toEqual(CANONICAL);
	});

	it("treats whitespace and a bare slash as empty", () => {
		expect(ids("   ")).toEqual(CANONICAL);
		expect(ids("/")).toEqual(CANONICAL);
		expect(ids(" / ")).toEqual(CANONICAL);
	});

	it("returns a fresh array that cannot mutate the vocabulary", () => {
		const first = matchSlashCommands("");
		first.reverse();
		expect(SLASH_COMMANDS.map((command) => command.id)).toEqual(CANONICAL);
		expect(ids("")).toEqual(CANONICAL);
	});
});

describe("matchSlashCommands — no match", () => {
	it("returns empty for a query nothing contains", () => {
		expect(ids("zzz")).toEqual([]);
		expect(ids("/qqqq")).toEqual([]);
		expect(ids("sectionx")).toEqual([]);
	});
});

describe("matchSlashCommands — ranking", () => {
	it("ranks label prefixes above substrings for /s", () => {
		const result = ids("s");
		expect(result.slice(0, 2)).toEqual(["section", "steps"]);
		// "bullets" only matches as a substring, so it must not outrank either.
		expect(result.indexOf("bullets")).toBeGreaterThan(1);
	});

	it("narrows to a single command as the query grows", () => {
		expect(ids("se")).toEqual(["section"]);
		// Bullets trails on "st" only because its alias "list" contains it.
		expect(ids("st")[0]).toBe("steps");
		expect(ids("bul")).toEqual(["bullets"]);
		expect(ids("co")).toEqual(["code"]);
	});

	it("ranks a label prefix above an alias prefix", () => {
		// "list" is an alias of both lists; "bullets" wins on canonical order.
		expect(ids("list")).toEqual(["bullets", "steps"]);
		// "Code" matches by label prefix, ahead of anything matching by alias.
		expect(ids("code")[0]).toBe("code");
	});

	it("matches aliases when the label does not", () => {
		expect(ids("ol")).toEqual(["steps"]);
		expect(ids("ul")).toEqual(["bullets"]);
		expect(ids("xml")).toEqual(["section"]);
		expect(ids("paragraph")).toEqual(["text"]);
		expect(ids("snippet")).toEqual(["code"]);
	});

	it("matches punctuation aliases", () => {
		expect(ids("-")).toEqual(["bullets"]);
		expect(ids("```")).toEqual(["code"]);
	});

	it("is case-insensitive", () => {
		expect(ids("SEC")).toEqual(ids("sec"));
		expect(ids("SEC")).toEqual(["section"]);
		expect(ids("BuLLeTs")).toEqual(["bullets"]);
		expect(ids("XML")).toEqual(["section"]);
	});

	it("tolerates the leading slash and surrounding whitespace", () => {
		expect(ids("/sec")).toEqual(["section"]);
		expect(ids("  /sec  ")).toEqual(["section"]);
		expect(ids("sec")).toEqual(ids("/sec"));
	});

	it("ranks an alias prefix above a label substring", () => {
		// "e": Section matches the alias "element" by prefix, Text only as a
		// substring of its label, so Section leads despite coming later.
		expect(ids("e")[0]).toBe("section");
		expect(ids("e")).toContain("text");
	});

	it("keeps equally ranked commands in canonical order", () => {
		// Both lists carry the alias "list" — same bucket, canonical tiebreak.
		expect(ids("list")).toEqual(["bullets", "steps"]);
		// Section and Steps both match "s" as a label prefix.
		expect(ids("s").slice(0, 2)).toEqual(["section", "steps"]);
	});

	it("returns commands, not just ids, with their block types intact", () => {
		expect(matchSlashCommands("bul")[0]).toMatchObject({
			id: "bullets",
			type: "bulletList",
			label: "Bullets",
		});
	});
});

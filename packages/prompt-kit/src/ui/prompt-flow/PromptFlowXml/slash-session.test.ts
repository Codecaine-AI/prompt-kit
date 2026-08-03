import { describe, expect, it } from "bun:test";

import {
	advanceSlashSession,
	moveSlashSelection,
	selectedSlashCommand,
	shouldOpenSlash,
	type SlashSession,
} from "./slash-session";

const open = (query: string, selectedIndex = 0): SlashSession => ({
	nodeId: "node-paragraph-1",
	query,
	selectedIndex,
});

describe("shouldOpenSlash", () => {
	it("opens on a slash typed into an empty line", () => {
		expect(shouldOpenSlash("", "/")).toBe(true);
	});

	it("stays shut for a slash inside a sentence", () => {
		expect(shouldOpenSlash("and/or", "and/or/")).toBe(false);
		expect(shouldOpenSlash("a", "a/")).toBe(false);
	});
});

describe("advanceSlashSession", () => {
	it("takes the text after the slash as the query", () => {
		expect(advanceSlashSession(open(""), "/bul")?.query).toBe("bul");
	});

	it("resets the selection when the query changes", () => {
		expect(advanceSlashSession(open("", 3), "/s")?.selectedIndex).toBe(0);
	});

	it("clamps a stale selection when the query is unchanged", () => {
		expect(advanceSlashSession(open("bul", 4), "/bul")?.selectedIndex).toBe(0);
	});

	it("retires when the slash is gone", () => {
		expect(advanceSlashSession(open("bul"), "bul")).toBeNull();
		expect(advanceSlashSession(open(""), "")).toBeNull();
	});

	it("retires when nothing matches", () => {
		expect(advanceSlashSession(open("z"), "/zzz")).toBeNull();
	});
});

describe("moveSlashSelection", () => {
	it("walks the match list", () => {
		expect(moveSlashSelection(open("", 0), 1)).toBe(1);
		expect(moveSlashSelection(open("", 1), -1)).toBe(0);
	});

	it("wraps at both ends", () => {
		expect(moveSlashSelection(open("", 0), -1)).toBe(4);
		expect(moveSlashSelection(open("", 4), 1)).toBe(0);
	});

	it("stays put in a one-row list", () => {
		expect(moveSlashSelection(open("bul", 0), 1)).toBe(0);
	});
});

describe("selectedSlashCommand", () => {
	it("names the command Enter would run", () => {
		expect(selectedSlashCommand(open("sec"))?.type).toBe("section");
		expect(selectedSlashCommand(open("", 2))?.type).toBe("bulletList");
	});

	it("clamps an out-of-range selection", () => {
		expect(selectedSlashCommand(open("bul", 9))?.type).toBe("bulletList");
	});

	it("has nothing to run when nothing matches", () => {
		expect(selectedSlashCommand(open("zzz"))).toBeUndefined();
	});
});

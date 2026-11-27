import { describe, expect, it } from "bun:test";

import {
	advanceSlashSession,
	moveSlashSelection,
	selectedSlashCommand,
	shouldOpenSlash,
	type SlashSession,
} from "../../../../src/ui/editor/buffer/slash-session";

const open = (query: string, selectedIndex = 0): SlashSession => ({
	nodeId: "node-paragraph-1",
	query,
	selectedIndex,
});

describe("shouldOpenSlash", () => {
	it("opens on a slash typed into an empty line", () => {
		expect(shouldOpenSlash("", "/")).toBe(true);
		expect(shouldOpenSlash("and/or", "and/or/")).toBe(false);
		expect(shouldOpenSlash("a", "a/")).toBe(false);
	});
});

describe("advanceSlashSession", () => {
	it("takes the text after the slash as the query", () => {
		expect(advanceSlashSession(open(""), "/bul")?.query).toBe("bul");
		expect(advanceSlashSession(open("", 3), "/s")?.selectedIndex).toBe(0);
		expect(advanceSlashSession(open("bul", 4), "/bul")?.selectedIndex).toBe(0);
		expect(advanceSlashSession(open("bul"), "bul")).toBeNull();
		expect(advanceSlashSession(open(""), "")).toBeNull();
		expect(advanceSlashSession(open("z"), "/zzz")).toBeNull();
	});
});

describe("moveSlashSelection", () => {
	it("walks the match list", () => {
		expect(moveSlashSelection(open("", 0), 1)).toBe(1);
		expect(moveSlashSelection(open("", 1), -1)).toBe(0);
		expect(moveSlashSelection(open("", 0), -1)).toBe(4);
		expect(moveSlashSelection(open("", 4), 1)).toBe(0);
		expect(moveSlashSelection(open("bul", 0), 1)).toBe(0);
	});
});

describe("selectedSlashCommand", () => {
	it("names the command Enter would run", () => {
		expect(selectedSlashCommand(open("sec"))?.type).toBe("section");
		expect(selectedSlashCommand(open("", 2))?.type).toBe("bulletList");
		expect(selectedSlashCommand(open("bul", 9))?.type).toBe("bulletList");
		expect(selectedSlashCommand(open("zzz"))).toBeUndefined();
	});
});

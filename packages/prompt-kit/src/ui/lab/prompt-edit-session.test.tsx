import { afterEach, describe, expect, test } from "bun:test";
import type { PromptDocument } from "../../index";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { buildXmlLineModel } from "../../document/render/line-model";
import { PromptInlineLab } from ".";
import {
	acceptDisabledReason,
	rejectDisabledReason,
	stagedRowPlan,
	targetAnchorRow,
	undoDisabledReason,
	type PromptEditProposal,
	type PromptEditRequest,
	type PromptEditSession,
} from "./prompt-edit-session";

afterEach(() => {
	cleanup();
});

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "session-test",
	nodes: [
		{ type: "paragraph", id: "paragraph-1", content: ["Hello"] },
		{
			type: "bulletList",
			id: "list-1",
			items: [
				{ type: "listItem", id: "item-1", content: ["First item"] },
				{ type: "listItem", id: "item-2", content: ["Second item"] },
			],
		},
	],
};

// The current whole-document render — the invariant base of every proposal.
const renderedBase = buildXmlLineModel(prompt).rendered;

function proposalFor(
	alias: string,
	options: {
		changedIds: string[];
		renderedAfter: string;
		summary?: string;
	},
): PromptEditProposal {
	return {
		requestAlias: alias,
		transactionId: `txn-${alias}`,
		changedIds: options.changedIds,
		summary: options.summary ?? `Change for ${alias}`,
		renderedBefore: renderedBase,
		renderedAfter: options.renderedAfter,
		steps: [],
	};
}

const paragraphProposal = proposalFor("R1", {
	changedIds: ["paragraph-1"],
	renderedAfter: renderedBase.replace("Hello", "Hi there"),
	summary: "Made the greeting concrete.",
});

const itemProposal = proposalFor("R2", {
	changedIds: ["item-1"],
	renderedAfter: renderedBase.replace("- First item", "- First item, tightened"),
	summary: "Tightened the first bullet.",
});

function request(
	alias: string,
	status: PromptEditRequest["status"],
	overrides: Partial<PromptEditRequest> = {},
): PromptEditRequest {
	return {
		alias,
		author: "you",
		status,
		body: `Request ${alias}`,
		target: { kind: "prompt-node", docId: prompt.id, nodeId: "paragraph-1" },
		...overrides,
	};
}

function renderLab(session: PromptEditSession) {
	return render(
		<PromptInlineLab prompt={prompt} promptEditSession={session} />,
	);
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

describe("prompt-edit-session helpers", () => {
	const lines = buildXmlLineModel(prompt).lines;

	test("stagedRowPlan derives del/add lines at the changed node's rows", () => {
		const plan = stagedRowPlan(lines, paragraphProposal)!;
		expect(plan).toBeTruthy();
		expect(plan.rowStart).toBe(0);
		expect(plan.rowEnd).toBe(0);
		expect(plan.delLines).toEqual(["Hello"]);
		expect(plan.addLines).toEqual(["Hi there"]);
	});

	test("stagedRowPlan anchors list items at their own rows", () => {
		const plan = stagedRowPlan(lines, itemProposal)!;
		expect(plan.delLines).toEqual(["- First item"]);
		expect(plan.addLines).toEqual(["- First item, tightened"]);
		// Row 1 is the gap between paragraph and list; row 2 is item-1.
		expect(plan.rowStart).toBe(2);
	});

	test("stagedRowPlan returns null when no changed id is on screen", () => {
		expect(
			stagedRowPlan(lines, {
				...paragraphProposal,
				changedIds: ["missing-node"],
			}),
		).toBeNull();
	});

	test("targetAnchorRow: node, item, range, and document targets", () => {
		expect(
			targetAnchorRow(lines, {
				kind: "prompt-node",
				docId: prompt.id,
				nodeId: "paragraph-1",
			}),
		).toBe(0);
		expect(
			targetAnchorRow(lines, {
				kind: "prompt-node",
				docId: prompt.id,
				nodeId: "item-2",
			}),
		).toBe(3);
		// Range offsets inside the list's rendered extent anchor at the first
		// intersecting row: "Second item" starts past the first bullet's line.
		expect(
			targetAnchorRow(lines, {
				kind: "prompt-range",
				docId: prompt.id,
				nodeId: "list-1",
				start: 15,
				end: 26,
				quote: "Second item",
			}),
		).toBe(3);
		// Document-level (null target, or nodeId === docId) anchors at row 0.
		expect(targetAnchorRow(lines, null)).toBe(0);
	});

	test("ordering discipline reasons", () => {
		const proposals = [paragraphProposal, itemProposal];
		expect(acceptDisabledReason(proposals, "R1")).toBeNull();
		expect(acceptDisabledReason(proposals, "R2")).toContain("R1");
		expect(rejectDisabledReason(proposals, "R2")).toBeNull();
		expect(rejectDisabledReason(proposals, "R1")).toContain("R2");
		expect(undoDisabledReason({ undoableAlias: "R1" }, "R1")).toBeNull();
		expect(undoDisabledReason({ undoableAlias: "R1" }, "R2")).toContain("R1");
		expect(undoDisabledReason({}, "R2")).toBe("Nothing to undo.");
	});
});

/* ------------------------------------------------------------------ */
/* Inline staged diffs                                                 */
/* ------------------------------------------------------------------ */

describe("PromptInlineLab inline staged diffs", () => {
	test("proposals render in place as red del rows + green add rows with an action bar", () => {
		renderLab({
			requests: [request("R1", "ready")],
			proposals: [paragraphProposal],
		});

		// The paragraph's editable rows are REPLACED by the diff.
		expect(
			document.querySelector('[data-prompt-node-id="paragraph-1"]'),
		).toBeNull();

		const region = document.querySelector(
			'[data-prompt-staged-region="proposal:txn-R1"]',
		)!;
		expect(region).toBeTruthy();
		const delRows = region.querySelectorAll('[data-prompt-diff-row="del"]');
		const addRows = region.querySelectorAll('[data-prompt-diff-row="add"]');
		expect(delRows.length).toBe(1);
		expect(addRows.length).toBe(1);
		expect(delRows[0]!.textContent).toContain("Hello");
		expect(addRows[0]!.textContent).toContain("Hi there");

		// The per-request action bar rides above the rows: alias + summary +
		// Reject/Accept.
		const bar = region.querySelector('[data-prompt-proposal-bar="R1"]')!;
		expect(bar).toBeTruthy();
		expect(bar.textContent).toContain("R1");
		expect(bar.textContent).toContain("Made the greeting concrete.");

		// In place: the diff region precedes the (untouched) list rows.
		const itemRow = document.querySelector('[data-prompt-node-id="item-1"]')!;
		expect(
			region.compareDocumentPosition(itemRow) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	test("inline diffs render in edit mode too — review is a state of the file", () => {
		renderLab({
			requests: [request("R1", "ready")],
			proposals: [paragraphProposal],
		});
		// No annotate toggle clicked: this IS edit mode.
		expect(
			document.querySelector('[data-prompt-diff-row="del"]'),
		).toBeTruthy();
		expect(
			document.querySelector('[data-prompt-diff-row="add"]'),
		).toBeTruthy();
	});

	test("accept ordering: only the first staged proposal accepts; later ones disable with a reason", () => {
		const accepted: string[] = [];
		renderLab({
			requests: [request("R1", "ready"), request("R2", "ready")],
			proposals: [paragraphProposal, itemProposal],
			onAccept: (alias) => {
				accepted.push(alias);
			},
		});

		const acceptR1 = screen.getByLabelText(
			"Accept R1",
		) as HTMLButtonElement;
		const acceptR2 = screen.getByLabelText(
			"Accept R2",
		) as HTMLButtonElement;
		expect(acceptR1.disabled).toBe(false);
		expect(acceptR2.disabled).toBe(true);
		expect(acceptR2.title).toContain("Accept R1 first");

		fireEvent.click(acceptR1);
		expect(accepted).toEqual(["R1"]);
		// A disabled accept never errors — the click simply does nothing.
		fireEvent.click(acceptR2);
		expect(accepted).toEqual(["R1"]);
	});

	test("reject ordering: only the LATEST staged proposal rejects", () => {
		const rejected: string[] = [];
		renderLab({
			requests: [request("R1", "ready"), request("R2", "ready")],
			proposals: [paragraphProposal, itemProposal],
			onReject: (alias) => {
				rejected.push(alias);
			},
		});

		const rejectR1 = screen.getByLabelText(
			"Reject R1",
		) as HTMLButtonElement;
		const rejectR2 = screen.getByLabelText(
			"Reject R2",
		) as HTMLButtonElement;
		expect(rejectR1.disabled).toBe(true);
		expect(rejectR1.title).toContain("R2");
		expect(rejectR2.disabled).toBe(false);

		fireEvent.click(rejectR2);
		expect(rejected).toEqual(["R2"]);
	});

	test("a block with a pending proposal cannot be manually edited", () => {
		renderLab({
			requests: [request("R1", "ready")],
			proposals: [paragraphProposal],
		});

		// The block's rows are gone from the editable surface, so there is
		// nothing to click into; clicking the diff rows opens no editor.
		fireEvent.click(document.querySelector('[data-prompt-diff-row="del"]')!);
		expect(document.querySelector("textarea")).toBeNull();
		// Untouched blocks stay editable.
		const itemRegion = document.querySelector<HTMLElement>(
			'[data-prompt-node-id="item-1"] [data-prompt-row-text]',
		)!;
		fireEvent.click(itemRegion);
		expect(document.querySelector("textarea")).toBeTruthy();
	});
});

/* ------------------------------------------------------------------ */
/* Banner                                                              */
/* ------------------------------------------------------------------ */

describe("PromptInlineLab draft banner", () => {
	test("counts staged changes and wires Accept all / Discard", () => {
		let acceptedAll = 0;
		let discarded = 0;
		renderLab({
			requests: [request("R1", "ready"), request("R2", "ready")],
			proposals: [paragraphProposal, itemProposal],
			onAcceptAll: () => {
				acceptedAll += 1;
			},
			onDiscardDraft: () => {
				discarded += 1;
			},
		});

		const banner = document.querySelector("[data-prompt-draft-banner]")!;
		expect(banner).toBeTruthy();
		expect(banner.textContent).toContain("2 changes staged, nothing saved");

		fireEvent.click(screen.getByLabelText("Accept all"));
		expect(acceptedAll).toBe(1);
		fireEvent.click(screen.getByLabelText("Discard draft"));
		expect(discarded).toBe(1);
	});

	test("no proposals → no banner", () => {
		renderLab({ requests: [request("R1", "open")], proposals: [] });
		expect(document.querySelector("[data-prompt-draft-banner]")).toBeNull();
	});
});

/* ------------------------------------------------------------------ */
/* Inline thread bars                                                  */
/* ------------------------------------------------------------------ */

describe("PromptInlineLab inline thread bars", () => {
	test("a waiting request renders an amber inline bar above its target and replies inline", () => {
		const replies: Array<[string, string]> = [];
		renderLab({
			requests: [
				request("R2", "waiting", {
					body: "Reconcile this rule with autosave.",
					thread: [
						{
							author: "agent",
							body: "Should this rule say edits are staged for review?",
						},
					],
				}),
			],
			proposals: [],
			onReplyToRequest: (alias, body) => {
				replies.push([alias, body]);
			},
		});

		const bar = document.querySelector('[data-prompt-thread-bar="R2"]')!;
		expect(bar).toBeTruthy();
		// The bar shows the agent's QUESTION (latest agent message).
		expect(bar.textContent).toContain(
			"Should this rule say edits are staged for review?",
		);
		// Above its target: the bar precedes the paragraph row in the flow.
		const targetRow = document.querySelector(
			'[data-prompt-node-id="paragraph-1"]',
		)!;
		expect(
			bar.compareDocumentPosition(targetRow) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		const input = screen.getByLabelText("Reply to R2") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Yes — staged." } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(replies).toEqual([["R2", "Yes — staged."]]);
		expect(input.value).toBe("");
	});

	test("non-waiting requests render no inline bar", () => {
		renderLab({
			requests: [request("R1", "open"), request("R3", "resolved")],
			proposals: [],
		});
		expect(document.querySelector("[data-prompt-thread-bar]")).toBeNull();
	});
});

/* ------------------------------------------------------------------ */
/* Session rail                                                        */
/* ------------------------------------------------------------------ */

describe("PromptInlineLab session rail", () => {
	function openRail(session: PromptEditSession) {
		renderLab(session);
		fireEvent.click(screen.getByRole("button", { name: "AI" }));
	}

	test("the queue holds live notes and closed loops file as compact records", () => {
		openRail({
			requests: [
				request("R1", "applied", { body: "Make it concrete." }),
				request("R2", "ready", { body: "Reconcile with autosave." }),
			],
			proposals: [itemProposal],
			undoableAlias: "R1",
			onUndo: () => {},
		});

		// The annotate panel owns the sidebar; the session rail mounts inside it.
		expect(document.querySelector("[data-lab-annotate-panel]")).toBeTruthy();
		expect(document.querySelector('[data-plannotator="root"]')).toBeNull();

		// R1's loop is closed — it leaves a record, not a card.
		expect(document.querySelector('[data-prompt-session-card="R1"]')).toBeNull();
		const recordR1 = document.querySelector(
			'[data-prompt-session-record="R1"]',
		)!;
		expect(recordR1.textContent).toContain("R1");
		expect(recordR1.textContent).toContain("paragraph-1");
		expect(recordR1.getAttribute("data-prompt-record-state")).toBe("resolved");

		// R2 is still live, so it is a card — with its note as reading matter.
		const cardR2 = document.querySelector(
			'[data-prompt-session-card="R2"]',
		)!;
		expect(cardR2.textContent).toContain("Reconcile with autosave.");
		// A staged proposal shows as staged, whatever the request status says.
		expect(
			document.querySelector('[data-prompt-card-state="R2"]')!.textContent,
		).toBe("staged");
	});

	test("Undo fires with the applied alias and only the most recent applied is enabled", () => {
		const undone: string[] = [];
		openRail({
			requests: [
				request("R1", "applied"),
				request("R2", "applied"),
			],
			proposals: [],
			undoableAlias: "R2",
			onUndo: (alias) => {
				undone.push(alias);
			},
		});

		const undoR1 = screen.getByLabelText("Undo R1") as HTMLButtonElement;
		const undoR2 = screen.getByLabelText("Undo R2") as HTMLButtonElement;
		expect(undoR1.disabled).toBe(true);
		expect(undoR1.title).toContain("R2");
		expect(undoR2.disabled).toBe(false);
		fireEvent.click(undoR2);
		expect(undone).toEqual(["R2"]);
	});

	test("the rail's waiting card replies through onReplyToRequest", () => {
		const replies: Array<[string, string]> = [];
		openRail({
			requests: [request("R2", "waiting")],
			proposals: [],
			onReplyToRequest: (alias, body) => {
				replies.push([alias, body]);
			},
		});

		const input = screen.getByLabelText(
			"Reply to unblock R2",
		) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Go ahead." } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(replies).toEqual([["R2", "Go ahead."]]);
	});

	test("the doc-level input sends a document request (null target)", () => {
		const sent: Array<[unknown, string]> = [];
		openRail({
			requests: [],
			proposals: [],
			onSendRequest: (target, body) => {
				sent.push([target, body]);
			},
		});

		const input = screen.getByLabelText(
			"Message the whole prompt",
		) as HTMLInputElement;
		fireEvent.change(input, {
			target: { value: "Check for contradictions." },
		});
		fireEvent.keyDown(input, { key: "Enter" });
		expect(sent).toEqual([[null, "Check for contradictions."]]);
	});
});

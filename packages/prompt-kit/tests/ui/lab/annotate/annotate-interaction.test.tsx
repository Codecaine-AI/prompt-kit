// The settled annotate interaction, end to end through the lab shell:
//
//   RUN NOW lives at the section — an inline thread above the row, a shimmer
//   on the row while the agent works, the staged diff in place, and NOTHING
//   in the sidebar until the loop closes.
//   BATCH and GLOBAL live in the sidebar — filed instantly, run on Apply,
//   narrated one card at a time.
//   The mode itself is ambient: an edge line, a tinted dock, a breathing chip.

import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";

import type { PromptDocument } from "../../../../src/index";
import { buildXmlLineModel } from "../../../../src/document/render/line-model";
import {
	PromptInlineLab,
	type PromptEditProposal,
	type PromptEditRequest,
	type PromptEditRequestStatus,
	type PromptEditSession,
	type PromptRequestDisposition,
} from "../../../../src/ui/lab";

afterEach(() => {
	cleanup();
});

const prompt: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "annotate-interaction",
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

const renderedBase = buildXmlLineModel(prompt).rendered;

function request(
	alias: string,
	disposition: PromptRequestDisposition,
	status: PromptEditRequestStatus,
	overrides: Partial<PromptEditRequest> = {},
): PromptEditRequest {
	return {
		alias,
		annotationId: `ann-${alias}`,
		author: "you",
		status,
		disposition,
		body: `Request ${alias}`,
		target:
			disposition === "global"
				? null
				: { kind: "prompt-node", docId: prompt.id, nodeId: "paragraph-1" },
		...overrides,
	};
}

function proposal(alias: string): PromptEditProposal {
	return {
		requestAlias: alias,
		transactionId: `txn-${alias}`,
		changedIds: ["paragraph-1"],
		summary: `Change for ${alias}`,
		renderedBefore: renderedBase,
		renderedAfter: renderedBase.replace("Hello", "Hi there"),
		steps: [],
	};
}

/** Renders the lab in annotate mode with the given session. */
function openAnnotate(session: PromptEditSession) {
	const result = render(
		<PromptInlineLab prompt={prompt} promptEditSession={session} />,
	);
	fireEvent.click(screen.getByRole("button", { name: "AI" }));
	return result;
}

const railCard = (alias: string) =>
	document.querySelector(`[data-prompt-session-card="${alias}"]`);
const railRecord = (alias: string) =>
	document.querySelector(`[data-prompt-session-record="${alias}"]`);

/* ------------------------------------------------------------------ */
/* The queue owns agent work (run-now retired 2026-08-05)              */
/* ------------------------------------------------------------------ */

describe("the queue owns agent work", () => {
	test("a legacy run-now request queues like everything else", () => {
		openAnnotate({
			requests: [request("R4", "run-now", "working")],
			proposals: [],
		});

		// No inline thread, no hidden population: the request is a queue card.
		expect(document.querySelector("[data-prompt-run-thread]")).toBeNull();
		expect(railCard("R4")).toBeTruthy();
	});

	test("staged: the diff in place carries the proposal action bar", () => {
		const accepted: string[] = [];
		const discarded: string[] = [];
		openAnnotate({
			requests: [request("R4", "batch", "ready")],
			proposals: [proposal("R4")],
			onAccept: (alias) => {
				accepted.push(alias);
			},
			onReject: (alias) => {
				discarded.push(alias);
			},
		});

		// The staged diff is rendered in place, with ONE action bar on it.
		expect(document.querySelector("[data-prompt-staged-region]")).toBeTruthy();
		const bar = document.querySelector<HTMLElement>(
			"[data-prompt-proposal-bar]",
		)!;
		expect(bar).toBeTruthy();
		expect(
			document.querySelectorAll('[aria-label="Accept R4"]'),
		).toHaveLength(1);

		fireEvent.click(within(bar).getByLabelText("Accept R4"));
		expect(accepted).toEqual(["R4"]);
		fireEvent.click(within(bar).getByLabelText("Reject R4"));
		expect(discarded).toEqual(["R4"]);
	});

	test("Accept resolves that ONE request: the diff closes and a record files", () => {
		// A miniature host: accepting flips the request to `applied` and drops
		// its proposal, exactly as the container does.
		function Host() {
			const [requests, setRequests] = useState<PromptEditRequest[]>([
				request("R4", "batch", "ready"),
				request("R5", "batch", "open"),
			]);
			const [proposals, setProposals] = useState<PromptEditProposal[]>([
				proposal("R4"),
			]);
			return (
				<PromptInlineLab
					prompt={prompt}
					promptEditSession={{
						requests,
						proposals,
						undoableAlias: "R4",
						onUndo: () => {},
						onAccept: (alias) => {
							setProposals((current) =>
								current.filter((entry) => entry.requestAlias !== alias),
							);
							setRequests((current) =>
								current.map((entry) =>
									entry.alias === alias
										? { ...entry, status: "applied" }
										: entry,
								),
							);
						},
					}}
				/>
			);
		}
		render(<Host />);
		fireEvent.click(screen.getByRole("button", { name: "AI" }));

		expect(railRecord("R4")).toBeNull();
		const bar = document.querySelector<HTMLElement>(
			"[data-prompt-proposal-bar]",
		)!;
		fireEvent.click(within(bar).getByLabelText("Accept R4"));

		// The loop is closed: no staged diff, and the request has filed itself
		// into the rail as `✓ R4 · paragraph-1 · resolved`.
		expect(document.querySelector("[data-prompt-staged-region]")).toBeNull();
		const record = railRecord("R4")!;
		expect(record.textContent).toContain("R4");
		expect(record.textContent).toContain("paragraph-1");
		expect(record.getAttribute("data-prompt-record-state")).toBe("resolved");
		// Undo stayed reachable on the record.
		expect(within(record as HTMLElement).getByLabelText("Undo R4")).toBeTruthy();
		// The other request's queue card is untouched — one loop closed, not two.
		expect(railCard("R5")).toBeTruthy();
	});
});

/* ------------------------------------------------------------------ */
/* The sidebar — batch, global, Apply, narration                       */
/* ------------------------------------------------------------------ */

describe("the sidebar queue", () => {
	test("Apply launches the queued set in order and narrates one card at a time", () => {
		const applied: string[][] = [];
		function Host() {
			const [proposals, setProposals] = useState<PromptEditProposal[]>([]);
			return (
				<>
					<button
						type="button"
						aria-label="stage next"
						onClick={() =>
							setProposals((current) => [
								...current,
								proposal(current.length === 0 ? "R1" : "R2"),
							])
						}
					/>
					<PromptInlineLab
						prompt={prompt}
						promptEditSession={{
							requests: [
								request("R1", "batch", "open"),
								request("R2", "batch", "open"),
								request("R3", "global", "open"),
							],
							proposals,
							onApplyQueue: (ids) => {
								applied.push(ids);
							},
						}}
					/>
				</>
			);
		}
		render(<Host />);
		fireEvent.click(screen.getByRole("button", { name: "AI" }));

		const cardState = (alias: string) =>
			document.querySelector(`[data-prompt-card-state="${alias}"]`)!.textContent;

		// Filed and waiting: nothing runs until Apply, and rows carry NO
		// position chatter — order is the list order (2026-08-05).
		expect(cardState("R1")).toBe("");
		expect(cardState("R3")).toBe("");
		expect(document.querySelector("[data-prompt-queue-pipeline]")).toBeNull();

		fireEvent.click(screen.getByLabelText("Apply queue"));
		// The host is handed the queued annotation ids, in queue order.
		expect(applied).toEqual([["ann-R1", "ann-R2", "ann-R3"]]);
		expect(cardState("R1")).toBe("processing");
		expect(cardState("R2")).toBe("");
		expect(cardState("R3")).toBe("");
		// Apply does not re-arm mid-run.
		expect(
			(screen.getByLabelText("Apply queue") as HTMLButtonElement).disabled,
		).toBe(true);

		// A proposal stages → the narration advances by itself.
		fireEvent.click(screen.getByLabelText("stage next"));
		expect(cardState("R1")).toBe("staged");
		expect(cardState("R2")).toBe("processing");

		fireEvent.click(screen.getByLabelText("stage next"));
		expect(cardState("R3")).toBe("processing");
	});

	test("a global note is a queue entry with a document chip and no node", () => {
		openAnnotate({
			requests: [request("R3", "global", "open")],
			proposals: [],
		});
		const card = railCard("R3")!;
		expect(
			card.querySelector('[data-prompt-card-target="R3"]')!.textContent,
		).toBe("document");
	});

	test("the rail's document input files a global note", () => {
		const filed: Array<[string, string | null]> = [];
		openAnnotate({
			requests: [],
			proposals: [],
			onFileRequest: (filing) => {
				filed.push([
					filing.disposition,
					filing.target ? filing.target.nodeId : null,
				]);
			},
		});
		const input = screen.getByLabelText(
			"Message the whole prompt",
		) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Check for contradictions." } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(filed).toEqual([["global", null]]);
	});

	test("a queued note whose node moved under it picks up the conflict chip", () => {
		openAnnotate({
			requests: [
				// Filed against paragraph-1 when it rendered something else.
				request("R2", "batch", "open", {
					target: {
						kind: "prompt-node",
						docId: prompt.id,
						nodeId: "paragraph-1",
						fingerprint: "stale-fingerprint",
					},
				}),
				// Filed against a node that has NOT moved (no stamp, no claim).
				request("R6", "batch", "open", {
					target: {
						kind: "prompt-node",
						docId: prompt.id,
						nodeId: "item-1",
					},
				}),
			],
			proposals: [],
		});

		const chip = document.querySelector('[data-prompt-card-conflict="R2"]')!;
		expect(chip.textContent).toBe("target changed since filed");
		expect(document.querySelector('[data-prompt-card-conflict="R6"]')).toBeNull();
	});
});

/* ------------------------------------------------------------------ */
/* The mode as a temperature                                           */
/* ------------------------------------------------------------------ */

describe("ambient mode signals", () => {
	test("entering morphs the glass and shows the breathing dot — no edge line", () => {
		render(<PromptInlineLab prompt={prompt} />);
		expect(document.querySelector("[data-lab-annotate-chip]")).toBeNull();
		// Edit mode: the floating glass dock is up in its dock shape.
		expect(
			document.querySelector("[data-lab-dock]")!.getAttribute("data-lab-float-mode"),
		).toBe("dock");
		expect(document.querySelector("[data-lab-annotate-panel]")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "AI" }));

		// The far-left edge line retired 2026-08-05 — no stray chrome.
		expect(document.querySelector("[data-lab-annotate-edge]")).toBeNull();
		// The same glass morphs into the annotations shape.
		expect(
			document.querySelector("[data-lab-dock]")!.getAttribute("data-lab-float-mode"),
		).toBe("annotate");
		expect(document.querySelector("[data-lab-annotate-panel]")).toBeTruthy();
		// The tab bar swaps roles: the AI tab is now the wide text tab and
		// carries the breathing dot.
		const header = document.querySelector("[data-lab-annotate-panel-header]")!;
		expect(header.textContent).toContain("Annotations");
		expect(
			header.querySelector("[data-lab-annotate-dot]")!.getAttribute(
				"data-lab-annotate-dot",
			),
		).toBe("slow");
	});

	test("the tab's dot beats faster while the queue is draining", () => {
		openAnnotate({
			requests: [request("R4", "batch", "open")],
			proposals: [],
			onApplyQueue: () => {},
		});
		fireEvent.click(screen.getByLabelText("Apply queue"));
		expect(
			document
				.querySelector("[data-lab-annotate-dot]")!
				.getAttribute("data-lab-annotate-dot"),
		).toBe("fast");
	});

	test("leaving returns the glass to its dock shape with no mode signals", () => {
		openAnnotate({
			requests: [request("R2", "batch", "open")],
			proposals: [proposal("R2")],
		});
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));

		// The parting-chip morph retired with the chip (2026-08-04 audit): the
		// glass simply returns to dock shape and the ambient signals drop.
		expect(
			document.querySelector("[data-lab-dock]")!.getAttribute("data-lab-float-mode"),
		).toBe("dock");
		expect(document.querySelector("[data-lab-annotate-edge]")).toBeNull();
		expect(document.querySelector("[data-lab-annotate-dot]")).toBeNull();
	});

	test("Escape finishes the mode when no composer is open", () => {
		render(<PromptInlineLab prompt={prompt} />);
		fireEvent.click(screen.getByRole("button", { name: "AI" }));
		// The dock unmounts in annotate mode — mode state reads off the root.
		const annotating = () =>
			document
				.querySelector("[data-lab-mode]")!
				.getAttribute("data-lab-mode") === "annotate";
		expect(annotating()).toBe(true);

		// An open composer owns Escape first — the target clears, mode stays.
		fireEvent.click(document.querySelector('[data-prompt-node-id="paragraph-1"]')!);
		expect(document.querySelector("[data-lab-composer]")).toBeTruthy();
		fireEvent.keyDown(
			document.querySelector("[data-lab-composer]")!.querySelector(
				"textarea",
			)!,
			{ key: "Escape" },
		);
		expect(document.querySelector("[data-lab-composer]")).toBeNull();
		expect(annotating()).toBe(true);

		// With nothing pinned, Escape finishes.
		fireEvent.keyDown(document, { key: "Escape" });
		expect(annotating()).toBe(false);
	});
});

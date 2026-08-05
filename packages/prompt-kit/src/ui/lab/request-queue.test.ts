import { describe, expect, test } from "bun:test";

import {
	buildRequestQueue,
	pipelineSummary,
	queuePositionLabel,
	requestDisposition,
	requestNodeId,
} from "./request-queue";
import type {
	PromptEditProposal,
	PromptEditRequest,
	PromptEditRequestStatus,
	PromptRequestDisposition,
} from "./prompt-edit-session";

const DOC_ID = "queue-doc";

function request(
	alias: string,
	status: PromptEditRequestStatus,
	overrides: Partial<PromptEditRequest> = {},
): PromptEditRequest {
	return {
		alias,
		author: "you",
		status,
		body: `Request ${alias}`,
		target: { kind: "prompt-node", docId: DOC_ID, nodeId: `node-${alias}` },
		...overrides,
	};
}

function filed(
	alias: string,
	disposition: PromptRequestDisposition,
	status: PromptEditRequestStatus = "open",
): PromptEditRequest {
	return request(alias, status, {
		disposition,
		annotationId: `ann-${alias}`,
		...(disposition === "global" ? { target: null } : {}),
	});
}

function proposal(alias: string): PromptEditProposal {
	return {
		requestAlias: alias,
		transactionId: `txn-${alias}`,
		changedIds: [`node-${alias}`],
		summary: `Change for ${alias}`,
		renderedBefore: "before",
		renderedAfter: "after",
		steps: [],
	};
}

describe("requestDisposition", () => {
	test("an explicit disposition wins", () => {
		expect(requestDisposition(filed("R2", "batch"))).toBe("batch");
		expect(requestDisposition(filed("R3", "global"))).toBe("global");
	});

	test("requests filed before dispositions existed default to the QUEUE", () => {
		expect(requestDisposition(request("R9", "open"))).toBe("batch");
		expect(requestDisposition(request("R9", "open", { target: null }))).toBe(
			"global",
		);
	});
});

describe("buildRequestQueue populations", () => {
	test("every open request is a queue card — legacy run-now included", () => {
		const model = buildRequestQueue({
			requests: [
				filed("R1", "run-now", "working"),
				filed("R2", "batch"),
				filed("R3", "global"),
			],
			proposals: [],
			applying: false,
		});

		// Run-now retired (2026-08-05): a legacy run-now entry queues like
		// everything else instead of hiding from the sidebar.
		expect(model.queue.map((entry) => entry.request.alias)).toEqual([
			"R1",
			"R2",
			"R3",
		]);
		expect(model.records).toEqual([]);
	});

	test("accepting closes the loop: the request reappears as a record", () => {
		const model = buildRequestQueue({
			requests: [filed("R1", "run-now", "applied")],
			proposals: [],
			applying: false,
		});
		expect(model.queue).toEqual([]);
		expect(model.records).toHaveLength(1);
		expect(model.records[0]).toMatchObject({
			ok: true,
			stateLabel: "resolved",
			targetLabel: "node-R1",
		});
	});

	test("discarding files the other kind of record", () => {
		const model = buildRequestQueue({
			requests: [filed("R1", "run-now", "declined"), filed("R2", "global", "resolved")],
			proposals: [],
			applying: false,
		});
		expect(model.records.map((record) => record.stateLabel)).toEqual([
			"discarded",
			"resolved",
		]);
		expect(model.records[0]!.ok).toBe(false);
		// A global note names the document, not a node.
		expect(model.records[1]!.targetLabel).toBe("document");
	});
});

describe("buildRequestQueue narration", () => {
	const queued = [filed("R1", "batch"), filed("R2", "batch"), filed("R3", "global")];

	test("before Apply the queue is quiet — positions only, nothing processing", () => {
		const model = buildRequestQueue({
			requests: queued,
			proposals: [],
			applying: false,
		});
		expect(model.activeAlias).toBeNull();
		expect(model.queue.map((entry) => entry.stateLabel)).toEqual([
			"queued · next",
			"queued · #2",
			"queued · #3",
		]);
		expect(model.pipeline).toBe("3 queued");
		expect(model.canApply).toBe(true);
	});

	test("Apply narrates one card at a time and advances as proposals stage", () => {
		const first = buildRequestQueue({
			requests: queued,
			proposals: [],
			applying: true,
		});
		expect(first.activeAlias).toBe("R1");
		expect(first.queue.map((entry) => entry.stateLabel)).toEqual([
			"processing",
			"queued · next",
			"queued · #2",
		]);
		expect(first.pipeline).toBe("processing R1 · 2 queued");
		// Apply is not re-armed while the batch drains.
		expect(first.canApply).toBe(false);

		// R1's proposal lands: R1 reads staged, R2 takes over, R3 moves up.
		const second = buildRequestQueue({
			requests: queued,
			proposals: [proposal("R1")],
			applying: true,
		});
		expect(second.activeAlias).toBe("R2");
		expect(second.queue.map((entry) => entry.stateLabel)).toEqual([
			"staged",
			"processing",
			"queued · next",
		]);
		expect(second.pipeline).toBe("processing R2 · 1 queued · 1 staged");

		// Everything staged: the run has drained and there is nothing active.
		const done = buildRequestQueue({
			requests: queued,
			proposals: [proposal("R1"), proposal("R2"), proposal("R3")],
			applying: true,
		});
		expect(done.activeAlias).toBeNull();
		expect(done.pipeline).toBe("3 staged");
	});

	test("an empty queue idles and Apply has nothing to do", () => {
		const model = buildRequestQueue({
			requests: [filed("R1", "batch", "resolved")],
			proposals: [],
			applying: false,
		});
		expect(model.pipeline).toBe("queue idle");
		expect(model.canApply).toBe(false);
	});

	test("conflicted aliases mark their card, and only theirs", () => {
		const model = buildRequestQueue({
			requests: queued,
			proposals: [],
			applying: false,
			conflictedAliases: new Set(["R2"]),
		});
		expect(model.queue.map((entry) => entry.conflict)).toEqual([
			false,
			true,
			false,
		]);
	});
});

describe("small vocabulary", () => {
	test("queuePositionLabel", () => {
		expect(queuePositionLabel(0)).toBe("queued · next");
		expect(queuePositionLabel(1)).toBe("queued · #2");
		expect(queuePositionLabel(-1)).toBe("queued");
	});

	test("pipelineSummary drops the parts that are zero", () => {
		expect(pipelineSummary({ activeAlias: null, queued: 0, staged: 0 })).toBe(
			"queue idle",
		);
		expect(pipelineSummary({ activeAlias: "R4", queued: 0, staged: 2 })).toBe(
			"processing R4 · 2 staged",
		);
	});

	test("requestNodeId reads document-level targets as no node", () => {
		expect(requestNodeId(request("R1", "open"))).toBe("node-R1");
		expect(requestNodeId({ target: null })).toBeNull();
		expect(
			requestNodeId({
				target: { kind: "prompt-node", docId: DOC_ID, nodeId: DOC_ID },
			}),
		).toBeNull();
	});

});

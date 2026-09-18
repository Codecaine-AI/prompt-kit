import { describe, expect, test } from "bun:test";
import type { PromptDocument, SectionNode } from "@codecaine-ai/prompt-kit";
import {
	PROMPT_DOCUMENT_ROOT_ID,
	compilePromptEditOps,
	lintPrompt,
	parsePromptEditOps,
	readPromptAddressMap,
} from "@codecaine-ai/prompt-kit/authoring";

function document(nodes: PromptDocument["nodes"] = baseNodes()): PromptDocument {
	return { kind: "prompt", schemaVersion: "prompt-kit/v1", id: "test", nodes };
}

function baseNodes(): PromptDocument["nodes"] {
	return [
		{ type: "section", id: "purpose", tag: "purpose", children: [{ type: "paragraph", id: "purpose-text", content: ["Do useful work."] }] },
		{ type: "section", id: "rules", tag: "rules", children: [] },
	];
}

function nestedListDocument(): PromptDocument {
	return document([
		{
			type: "bulletList", id: "outer-list", items: [{
				type: "listItem", id: "outer-item", content: ["Outer"], children: [{
					type: "orderedList", id: "inner-list", items: [{
						type: "listItem", id: "inner-item", content: ["Inner"], children: [{
							type: "section", id: "nested-section", tag: "nested", children: [
								{ type: "paragraph", id: "nested-paragraph", content: ["Nested text."] },
							],
						}],
					}],
				}],
			}],
		},
		{ type: "paragraph", id: "root-reference", content: ["Root reference."] },
	]);
}

const section = (tag: string, children: PromptDocument["nodes"] = []): SectionNode => ({
	type: "section",
	id: tag,
	tag,
	children,
});

describe("semantic authoring operations", () => {
	test("later operations address a node inserted earlier in the same batch", () => {
		const result = compilePromptEditOps(document(), [
			{ op: "insert_after", refNodeId: "purpose-text", node: { type: "paragraph", id: "draft", content: ["Draft."] } },
			{ op: "update_node", nodeId: "draft", patch: { content: ["Final."] } },
			{ op: "move_after", nodeId: "draft", refNodeId: "rules" },
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.changedIds).toEqual(["draft"]);
		expect(result.steps.map((step) => step.op)).toEqual(["insert", "update", "move"]);
		expect(result.doc.nodes.at(-1)).toMatchObject({ id: "draft", content: ["Final."] });
	});

	test("root insertion uses the documented root address and index", () => {
		const result = compilePromptEditOps(document(), [{
			op: "insert_into",
			parentNodeId: PROMPT_DOCUMENT_ROOT_ID,
			index: 1,
			node: { type: "paragraph", id: "root-child", content: ["At root."] },
		}]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.steps[0]).toMatchObject({ op: "insert", path: ["nodes", 1] });
		expect(result.doc.nodes[1]?.id).toBe("root-child");
	});

	test("an invalid later operation rejects the batch without mutating input", () => {
		const input = document();
		const before = JSON.stringify(input);
		const result = compilePromptEditOps(input, [
			{ op: "update_node", nodeId: "purpose-text", patch: { content: ["Changed."] } },
			{ op: "remove_node", nodeId: "missing" },
		]);
		expect(result).toMatchObject({ ok: false, errors: [{ code: "unknown_node", opIndex: 1, nodeId: "missing" }] });
		expect(JSON.stringify(input)).toBe(before);
	});

	test("rejects unknown and malformed target-specific patch fields", () => {
		const input = document();
		const unknown = compilePromptEditOps(input, [
			{ op: "update_node", nodeId: "purpose-text", patch: { bogus: "x" } as never },
		]);
		expect(unknown).toMatchObject({ ok: false, errors: [{ code: "invalid_patch", opIndex: 0, nodeId: "purpose-text" }] });
		const malformed = compilePromptEditOps(input, [
			{ op: "update_node", nodeId: "purpose-text", patch: { content: "not-inline-content" } as never },
		]);
		expect(malformed).toMatchObject({ ok: false, errors: [{ code: "invalid_patch", opIndex: 0, nodeId: "purpose-text" }] });
		expect(input.nodes[0]).toMatchObject({ id: "purpose", tag: "purpose" });
	});

	test("parsing reports invalid untrusted operation shapes", () => {
		const parsed = parsePromptEditOps([{ op: "insert_into", parentNodeId: "$root", index: "first", node: { type: "paragraph", content: [] } }]);
		expect(parsed).toMatchObject({ ok: false, errors: [{ code: "invalid_op_shape", opIndex: 0 }] });
	});

	test("parsing enforces the strict public schema fields and index domain", () => {
		for (const raw of [
			[{ op: "remove_node", nodeId: "x", unexpected: true }],
			[{ op: "update_node", nodeId: "x", patch: { bogus: true } }],
			[{ op: "insert_into", parentNodeId: "$root", index: -1, node: { type: "paragraph", content: [] } }],
			[{ op: "insert_into", parentNodeId: "$root", index: 1.5, node: { type: "paragraph", content: [] } }],
		]) {
			expect(parsePromptEditOps(raw).ok).toBe(false);
		}
	});

	test("updates a block below nested list items", () => {
		const result = compilePromptEditOps(nestedListDocument(), [
			{ op: "update_node", nodeId: "nested-paragraph", patch: { content: ["Updated."] } },
		]);
		expect(result.ok && result.doc.nodes[0]).toBeTruthy();
		if (!result.ok) return;
		expect(result.steps[0]).toMatchObject({ op: "update", id: "nested-paragraph" });
	});

	test("inserts after and removes blocks below nested list items", () => {
		const inserted = compilePromptEditOps(nestedListDocument(), [{
			op: "insert_after", refNodeId: "nested-paragraph",
			node: { type: "paragraph", id: "nested-sibling", content: ["Sibling."] },
		}]);
		expect(inserted.ok).toBe(true);
		if (!inserted.ok) return;
		expect(inserted.steps[0]).toMatchObject({
			op: "insert",
			path: ["nodes", 0, "items", 0, "children", 0, "items", 0, "children", 0, "children", 1],
		});
		const removed = compilePromptEditOps(inserted.doc, [{ op: "remove_node", nodeId: "nested-sibling" }]);
		expect(removed.ok && removed.steps[0]).toMatchObject({ op: "remove" });
	});

	test("moves a section from a nested list item to the document root", () => {
		const result = compilePromptEditOps(nestedListDocument(), [
			{ op: "move_after", nodeId: "nested-section", refNodeId: "root-reference" },
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.nodes.map((node) => node.id)).toEqual(["outer-list", "root-reference", "nested-section"]);
	});
});

describe("address map", () => {
	test("exposes block paths and parent ids without making list items addressable", () => {
		const doc = document([{ type: "section", id: "outer", tag: "purpose", children: [
			{ type: "bulletList", id: "list", items: [{ type: "listItem", id: "item", content: ["One"] }] },
		] }]);
		expect(readPromptAddressMap(doc)).toEqual({
			rootId: "$root",
			nodes: [
				{ nodeId: "outer", type: "section", path: ["nodes", 0], parentNodeId: "$root", index: 0 },
				{ nodeId: "list", type: "bulletList", path: ["nodes", 0, "children", 0], parentNodeId: "outer", index: 0 },
			],
		});
	});

	test("rejects documents whose addressable blocks have not been normalized", () => {
		expect(() => readPromptAddressMap(document([{ type: "paragraph", content: ["No id"] }]))).toThrow("ensurePromptNodeIds");
	});

	test("includes blocks below nested list items while omitting list-item targets", () => {
		const map = readPromptAddressMap(nestedListDocument());
		expect(map.nodes.map((entry) => entry.nodeId)).toEqual([
			"outer-list", "inner-list", "nested-section", "nested-paragraph", "root-reference",
		]);
		expect(map.nodes.find((entry) => entry.nodeId === "nested-section")).toMatchObject({
			path: ["nodes", 0, "items", 0, "children", 0, "items", 0, "children", 0],
			parentNodeId: "inner-item",
		});
	});
});

describe("writing profile lint", () => {
	test("agent profile checks canonical sections and workflow phase fields", () => {
		const workflow = section("workflow", [section("phase", [section("objective")])]);
		const findings = lintPrompt(document([
			section("rules"), section("purpose"), section("state_structure"), workflow,
		]), "agent");
		expect(findings.map((finding) => finding.code)).toContain("profile_section_order");
		expect(findings).toContainEqual(expect.objectContaining({ code: "workflow_phase_missing_steps", nodeId: "phase" }));
	});

	test("a complete single-output profile passes", () => {
		const findings = lintPrompt(document([
			section("purpose"), section("instructions"), section("output_format"), section("constraints"),
		]), "single-output");
		expect(findings).toEqual([]);
	});

	test("requires the constraints section to remain last", () => {
		const findings = lintPrompt(document([
			section("purpose"), section("instructions"), section("output_format"), section("constraints"), section("appendix"),
		]), "single-output");
		expect(findings).toContainEqual(expect.objectContaining({ code: "profile_final_section", nodeId: "appendix" }));
	});

	test("generic profile does not impose profile-specific structure", () => {
		const findings = lintPrompt(document([section("anything"), section("another_thing")]), "generic");
		expect(findings).toEqual([]);
	});
});

/**
 * Prompt shape gate for the first-party prompt-editor bundle (the canvas
 * layout-editor prompt-assembly test, ported to the kernel catalog).
 *
 * The static prompt is the purpose, declared state shape, phased workflow,
 * proposal-repair handling, and final rules — operational text only. Reference
 * and tool semantics live in shared and local context blocks (section ②); the
 * target prompt, applied-diff log, and request queue are session STATE rendered
 * by the state sidecar (section ③), and tool mechanics live in the schemas.
 *
 * Shape is part of the contract: every bullet and step carries one sentence
 * with its qualifications nested beneath it, and the body declares no spawn
 * variables.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	canonicalizePrompt,
	hashPrompt,
	renderXmlMarkdown,
	validatePrompt,
	validatePromptDocumentShape,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";
import {
	buildRegistry,
	refreshBundlePromptSnapshot,
	resolvePromptEntry,
	validateVariables,
} from "@agent-kernel/kernel/agent-registry";
import type {
	LoadedMap,
	SpawnContext,
} from "@agent-kernel/kernel/context";
import {
	DEFAULT_WINDOW,
	normalizeRenderOutput,
	type RenderContext,
	type SessionEvent,
} from "@agent-kernel/kernel/state";

import promptEditorContext, {
	CONTEXT_BLOCKS,
	CONTEXT_FILES,
	GUIDANCE_FILES,
} from "./prompt-editor/context/index";
import { loadGuidance } from "../../prompt-kit-server/src/guidance";
import promptEditorState, {
	type PromptEditorState,
} from "./prompt-editor/state/index";

const CATALOG_DIR = import.meta.dir;
const BUNDLE_DIR = join(CATALOG_DIR, "prompt-editor");
const PROMPT_FILE = join(BUNDLE_DIR, "prompt", "prompt.json");
const STATE_FIXTURE_FILE = join(
	BUNDLE_DIR,
	"state",
	"fixtures",
	"default.json",
);

interface PromptNode {
	type: string;
	tag?: string;
	[key: string]: unknown;
}

function readPrompt(): {
	raw: string;
	document: PromptDocument;
	nodes: PromptNode[];
	text: string;
} {
	const raw = readFileSync(PROMPT_FILE, "utf8");
	const document = JSON.parse(raw) as PromptDocument;
	const strings: string[] = [];
	const collect = (value: unknown, key?: string): void => {
		if (typeof value === "string") {
			if (key === "content") strings.push(value);
			return;
		}
		if (Array.isArray(value)) {
			for (const entry of value) collect(entry, key);
			return;
		}
		if (value && typeof value === "object") {
			for (const [childKey, child] of Object.entries(value)) {
				collect(child, childKey);
			}
		}
	};
	collect(document);
	return {
		raw,
		document,
		nodes: document.nodes as unknown as PromptNode[],
		text: strings.join("\n"),
	};
}

/** Every listItem in the tree, as { id, text } pairs. */
function listItems(root: unknown): { id: string; text: string }[] {
	const found: { id: string; text: string }[] = [];
	const walk = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const entry of value) walk(entry);
			return;
		}
		if (!value || typeof value !== "object") return;
		const node = value as PromptNode;
		if (node.type === "listItem") {
			const content = Array.isArray(node.content) ? node.content : [];
			found.push({
				id: String(node.id ?? "(unnamed)"),
				text: content
					.filter((part): part is string => typeof part === "string")
					.join(""),
			});
		}
		for (const child of Object.values(node)) walk(child);
	};
	walk(root);
	return found;
}

function manifestVariables(): string[] {
	const manifest = JSON.parse(
		readFileSync(join(BUNDLE_DIR, "agent.json"), "utf8"),
	) as { variables?: Record<string, unknown> };
	return Object.keys(manifest.variables ?? {});
}

function fakeSpawnContext(
	overrides: Partial<SpawnContext> = {},
): SpawnContext {
	return {
		agentName: "prompt-editor",
		variables: {},
		caller: { kind: "system", id: "test" },
		runtime: { cwd: BUNDLE_DIR },
		paths: { workingDir: BUNDLE_DIR, activeSessionDir: BUNDLE_DIR },
		...overrides,
	};
}

async function loadDeclaredFiles(): Promise<LoadedMap> {
	return promptEditorContext.loaders.map((decl) => {
		const path = String((decl as { path?: unknown }).path ?? "");
		const content = readFileSync(path, "utf8");
		return {
			decl,
			status: "ok" as const,
			content,
			bytes: Buffer.byteLength(content, "utf8"),
			hash: "",
			fromCache: false,
		};
	});
}

/** A state fixture file: the kernel lab's envelope around an S sample. */
interface StateFixtureEnvelope {
	label?: unknown;
	variables?: Record<string, unknown>;
	state: PromptEditorState;
}

function readStateFixtureEnvelope(file: string): StateFixtureEnvelope {
	return JSON.parse(readFileSync(file, "utf8")) as StateFixtureEnvelope;
}

function readStateFixture(): PromptEditorState {
	return readStateFixtureEnvelope(STATE_FIXTURE_FILE).state;
}

function fakeRenderContext(): RenderContext {
	return {
		agentName: "prompt-editor",
		messages: [],
		turnIndex: 0,
		window: { ...DEFAULT_WINDOW },
	};
}

/** Render S over an empty conversation and flatten the state block's text. */
function renderStateBlock(state: PromptEditorState): {
	text: string;
	stateMessageCount: number;
	messageCount: number;
} {
	const result = normalizeRenderOutput(
		promptEditorState.render(state, fakeRenderContext()),
	);
	const first = result.messages[0] as {
		content?: Array<{ type: string; text?: string }>;
	};
	const text = (first?.content ?? [])
		.map((entry) => (entry.type === "text" ? (entry.text ?? "") : ""))
		.join("\n");
	return {
		text,
		stateMessageCount: result.stateMessageCount ?? 0,
		messageCount: result.messages.length,
	};
}

describe("prompt-editor bundle", () => {
	test("the registry discovers the bundle from the catalog root", async () => {
		const registry = await buildRegistry({ roots: [CATALOG_DIR] });
		expect(registry.list().map((def) => def.name)).toContain("prompt-editor");
		const def = registry.get("prompt-editor");
		expect(def.contextResolver).not.toBeNull();
		expect(def.manifest.model).toBe("prompt-editor");
		expect(Object.keys(def.manifest.variables)).toEqual([]);
		// The state sidecar attaches by convention (state/index.ts) and alone
		// activates the state extension — agent.json carries no state block.
		expect(def.stateModulePath).toBe(join(BUNDLE_DIR, "state", "index.ts"));
		expect(def.stateModule).not.toBeNull();
		expect(typeof def.stateModule?.seed).toBe("function");
		expect(typeof def.stateModule?.update).toBe("function");
		expect(typeof def.stateModule?.render).toBe("function");
		expect(def.stateConfig).toBeNull();
		// Boot-time variable validation passed with nothing left over.
		expect(def.warnings).toEqual([]);
	});

	test("the bundle is in folder form with no flat-file shadows", () => {
		expect(resolvePromptEntry(BUNDLE_DIR).form).toBe("folder");
		expect(existsSync(join(BUNDLE_DIR, "context", "index.ts"))).toBe(true);
		expect(existsSync(join(BUNDLE_DIR, "state", "index.ts"))).toBe(true);
		expect(existsSync(join(BUNDLE_DIR, "prompt.json"))).toBe(false);
		expect(existsSync(join(BUNDLE_DIR, "prompt.rendered.md"))).toBe(false);
		expect(existsSync(join(BUNDLE_DIR, "context.ts"))).toBe(false);
		expect(existsSync(join(BUNDLE_DIR, "state.ts"))).toBe(false);
	});

	test("prompt.json is canonical bytes and hashes as pk1", () => {
		const { raw, document } = readPrompt();
		const shape = validatePromptDocumentShape(document);
		expect(shape.errors).toEqual([]);
		expect(canonicalizePrompt(document)).toBe(raw);
		expect(hashPrompt(document)).toStartWith("pk1-");
	});

	test("the prompt validates with no declared variables", () => {
		const { document } = readPrompt();
		const declared = manifestVariables();
		expect(declared).toEqual([]);
		const result = validatePrompt(document, { declaredVariables: declared });
		expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
			[],
		);
		expect(result.ok).toBe(true);
		// The rendered body references exactly the declared set — no strays,
		// no unused declarations.
		const body = renderXmlMarkdown(document);
		const vars = validateVariables(
			body,
			Object.fromEntries(declared.map((name) => [name, {}])),
		);
		expect(vars.missingDeclarations).toEqual([]);
		expect(vars.unusedDeclarations).toEqual([]);
	});

	test("the committed system.md is fresh and the render is stable", () => {
		const { document } = readPrompt();
		const result = refreshBundlePromptSnapshot(BUNDLE_DIR, { dryRun: true });
		expect(result.form).toBe("folder");
		expect(result.changed).toBe(false);
		expect(result.canonicalized).toBe(false);
		// Same document, same bytes, every time.
		expect(renderXmlMarkdown(document)).toBe(renderXmlMarkdown(document));
		expect(canonicalizePrompt(document)).toBe(
			canonicalizePrompt(JSON.parse(canonicalizePrompt(document))),
		);
	});

	test("ships the canonical sections and phased workflow in reading order", () => {
		const { nodes } = readPrompt();
		expect(
			nodes.filter((node) => node.type === "section").map((node) => node.tag),
		).toEqual([
			"purpose",
			"state_structure",
			"workflow",
			"error_handling",
			"rules",
		]);

		const workflow = nodes.find((node) => node.tag === "workflow");
		const phases = (workflow?.children ?? []) as PromptNode[];
		expect(
			phases.map((phase) => ({
				name: (phase.attrs as { name?: unknown } | undefined)?.name,
				fields: ((phase.children ?? []) as PromptNode[]).map(
					(field) => field.tag,
				),
			})),
		).toEqual([
			{ name: "survey_queue", fields: ["objective", "steps"] },
			{ name: "work_requests", fields: ["objective", "steps"] },
			{ name: "close_out", fields: ["objective", "steps"] },
		]);
	});

	test("every bullet and step carries a single sentence", () => {
		const { nodes } = readPrompt();
		for (const entry of listItems(nodes)) {
			expect(entry.text, `${entry.id} packs more than one sentence`).not.toMatch(
				/[.!?]"?\s+[A-Z`]/,
			);
		}
	});

	test("pins the identity and the staged-review framing", () => {
		const { text } = readPrompt();
		expect(text).toContain(
			"You are the prompt editor: you change a target agent's system prompt on behalf of the human who owns it.",
		);
		expect(text).toContain(
			"its rendered markdown is a projection you never touch",
		);
		expect(text).toContain(
			"Your edits are staged proposals for human review, and nothing lands in the live prompt until the human accepts it.",
		);
	});

	test("pins the declared state and structural-transaction rules", () => {
		const { text } = readPrompt();
		expect(text).toContain('<target_prompt agent="…" hash="…">');
		expect(text).toContain("stamped ids are the only edit addresses");
		expect(text).toContain("hash is the transaction base");
		expect(text).toContain("<diffs>");
		expect(text).toContain("the transactions applied so far");
		expect(text).toContain("the open queue of R-alias entries");
		expect(text).toContain(
			"an edit is a transaction of id-relative steps against the document tree, and rewritten markdown is never an edit",
		);
		expect(text).toContain("Preserve node ids");
		expect(text).toContain("Prefer the minimal transaction");
		expect(text).toContain("prefer update_node over removal and insertion");
		expect(text).toContain(
			"every variable placeholder it references must stay declared",
		);
		expect(text).toContain("Match the target prompt's voice and nomenclature");
		expect(text).toContain("never introduce a synonym");
		expect(text).toContain("Never silently comply with a conflicting request");
		expect(text).toContain("ask only questions whose answers materially change");
		expect(text).toContain(
			"notes, replies, and resolutions are a sentence or two",
		);
	});

	test("repairs failed proposals by narrowing the transaction", () => {
		const { text } = readPrompt();
		expect(text).toContain("proposal validation fails or bounces back");
		expect(text).toContain("narrow the transaction");
		expect(text).toContain("re-propose; never widen the edit");
	});

	test("pins the queue workflow: read all, one proposal each, resolve each", () => {
		const { text } = readPrompt();
		expect(text).toContain(
			"Read the whole <requests> queue before editing anything",
		);
		expect(text).toContain("Read <diffs> before proposing");
		expect(text).toContain("collisions, overlaps, and shared nodes");
		expect(text).toContain("Plan each request in alias order");
		expect(text).toContain(
			"use propose_transaction to propose exactly one transaction",
		);
		expect(text).toContain("when no change is needed, propose none");
		expect(text).toContain(
			"Resolve each disposable request individually with resolve_request",
		);
		expect(text).toContain("never as a lump");
		expect(text).toContain("use reply_request to ask an open question");
		expect(text).toContain("keep working the others");
		expect(text).toContain(
			"use add_note to pin placed notes at the implicated nodes",
		);
		expect(text).toContain(
			"Loop to step 1 until no open request remains that can be disposed",
		);
	});

	test("names the five v1 tools and no others", () => {
		const { text } = readPrompt();
		for (const tool of [
			"read_prompt",
			"propose_transaction",
			"resolve_request",
			"reply_request",
			"add_note",
		]) {
			expect(text).toContain(tool);
		}
		// Retired / sibling-surface names stay out of the model's vocabulary.
		for (const absent of [
			"apply_steps",
			"save_prompt",
			"write_prompt",
			"add_annotation",
			"reply_annotation",
			"resolve_annotation",
		]) {
			expect(text).not.toContain(absent);
		}
	});

	test("the rendered body references no spawn variables", () => {
		const { document } = readPrompt();
		const body = renderXmlMarkdown(document);
		const refs = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
		expect([...new Set(refs)]).toEqual([]);
	});
});

describe("prompt-editor context sidecar", () => {
	test("declares canonical guidance and local references in loader order", () => {
		const expectedBlocks = [
			{
				tag: "prompt_kit_authoring",
				files: GUIDANCE_FILES,
			},
			{
				tag: "tool_guide",
				files: [join(BUNDLE_DIR, "context", "blocks", "20-tool-guide.md")],
			},
			{
				tag: "state_reference",
				files: [join(BUNDLE_DIR, "context", "blocks", "10-state-reference.md")],
			},
		];
		expect(CONTEXT_BLOCKS).toEqual(expectedBlocks);
		expect(CONTEXT_FILES).toEqual(
			expectedBlocks.flatMap((entry) => entry.files),
		);
		expect(promptEditorContext.loaders).toHaveLength(CONTEXT_FILES.length);
		expect(
			promptEditorContext.loaders.map((decl) =>
				String((decl as { path?: unknown }).path ?? ""),
			),
		).toEqual([...CONTEXT_FILES]);
		for (const decl of promptEditorContext.loaders) {
			expect(decl.kind).toBe("file");
			const path = String((decl as { path?: unknown }).path ?? "");
			expect(existsSync(path), `missing reference file: ${path}`).toBe(true);
		}
	});

	test("assembles the same agent guidance plus local tool and state references", async () => {
		const loaded = await loadDeclaredFiles();
		const out = await promptEditorContext.assemble(loaded, fakeSpawnContext());
		const shared = await loadGuidance({ profile: "agent" });
		// The kernel's L2 context set owns the <context> envelope. These three
		// self-describing blocks are direct siblings and need no prompt inventory.
		const tags = [
			"prompt_kit_authoring",
			"tool_guide",
			"state_reference",
		];
		expect(out.startsWith("<prompt_kit_authoring>")).toBe(true);
		expect(out.endsWith("</state_reference>")).toBe(true);
		for (const tag of tags) {
			expect(out).toContain(`<${tag}>`);
			expect(out).toContain(`</${tag}>`);
		}
		expect(tags.map((tag) => out.indexOf(`<${tag}>`))).toEqual(
			[...tags]
				.map((tag) => out.indexOf(`<${tag}>`))
				.sort((a, b) => a - b),
		);
		expect(out).not.toContain("<doc ");
		const sharedBody = out
			.match(/<prompt_kit_authoring>\n([\s\S]*?)\n<\/prompt_kit_authoring>/)?.[1]
			?.split("\n")
			.map((line) => line.replace(/^ {4}/, ""))
			.join("\n");
		expect(sharedBody).toBe(shared.text);
		expect(shared.sources.every((source) => source.path.endsWith("/doc.json"))).toBe(
			true,
		);
		expect(shared.sources.every((source) => source.sourceSha256.length === 64)).toBe(
			true,
		);
		expect(shared.sources.every((source) => source.renderedSha256.length === 64)).toBe(
			true,
		);
		expect(sharedBody).toContain("# Workflow Structure");
		expect(sharedBody).toContain("| update_node | Shallow-merge supported fields");
		expect(sharedBody).toContain("| insert_after | Insert one block");
		expect(sharedBody).toContain("## Repair");
		expect(sharedBody).toContain("Errors identify the offending operation");
		expect(out).toContain("# Prompt Editor Tool Guide");
		// state_reference documents the section-③ vocabulary, but this assembled
		// context carries no live session instance.
	});

	test("a missing canonical source degrades the shared guidance block honestly", async () => {
		const loaded = await loadDeclaredFiles();
		const withoutCanonicalSource = loaded.filter((input) => {
			const path = String((input.decl as { path?: unknown }).path ?? "");
			return path !== GUIDANCE_FILES[0];
		});
		const out = await promptEditorContext.assemble(
			withoutCanonicalSource,
			fakeSpawnContext(),
		);
		expect(out).toContain(
			'<prompt_kit_authoring status="missing"></prompt_kit_authoring>',
		);
		expect(out).not.toContain("# Agent Prompt Structure");
		// Unaffected tags still assemble normally.
		expect(out).toContain("# Prompt Editor Tool Guide");
		expect(out).toContain("# Prompt Editor State Reference");
	});

	test("assemble ignores session data — context is session-invariant", async () => {
		const loaded = await loadDeclaredFiles();
		const fixture = readStateFixture();
		const withoutSession = await promptEditorContext.assemble(
			loaded,
			fakeSpawnContext(),
		);
		const withSession = await promptEditorContext.assemble(
			loaded,
			fakeSpawnContext({
				sessionData: {
					targetAgent: fixture.targetAgent,
					targetPromptRender: fixture.targetPromptRender,
					targetPromptHash: fixture.targetPromptHash,
					appliedDiffs: fixture.appliedDiffs,
					requestQueue: fixture.requestQueue,
				},
			}),
		);
		expect(withSession).toBe(withoutSession);
		expect(withSession).not.toContain(fixture.targetPromptHash);
		expect(withSession).not.toContain("You find primary sources.");
		expect(withSession).not.toContain(
			"Make the opening say WHAT counts as a primary source.",
		);
	});
});

describe("prompt-editor state sidecar", () => {
	test("seed round-trips the spawn payload into the section-③ render", () => {
		const fixture = readStateFixture();
		const seeded = promptEditorState.seed(
			fakeSpawnContext({
				sessionData: {
					targetAgent: fixture.targetAgent,
					targetPromptRender: fixture.targetPromptRender,
					targetPromptHash: fixture.targetPromptHash,
					appliedDiffs: fixture.appliedDiffs,
					requestQueue: fixture.requestQueue,
				},
			}),
		);
		expect(seeded).toEqual(fixture);
		const { text, stateMessageCount, messageCount } =
			renderStateBlock(seeded);
		// One kernel:state message over an empty conversation — no tail.
		expect(stateMessageCount).toBe(1);
		expect(messageCount).toBe(1);
		expect(text).toContain(
			`<target_prompt agent="${fixture.targetAgent}" hash="${fixture.targetPromptHash}">`,
		);
		expect(text).toContain("<!-- #sec-purpose -->");
		expect(text).toContain("<!-- #para-0 -->");
		expect(text).toContain("You find primary sources.");
		expect(text).toContain("<diffs>");
		expect(text).toContain(fixture.appliedDiffs);
		expect(text).toContain("<requests>");
		expect(text.indexOf("<target_prompt ")).toBeLessThan(
			text.indexOf("<diffs>"),
		);
		expect(text.indexOf("<diffs>")).toBeLessThan(
			text.indexOf("<requests>"),
		);
		expect(text).toContain("REQUESTS · 0/3 disposed");
		expect(text).toContain(
			'R1 open  node:para-0  ford — "Make the opening say WHAT counts as a primary source."',
		);
		expect(text).toContain("R2 open  range:para-1[10..17]");
		expect(text).not.toContain("(unset)");
		expect(text).not.toContain("(target prompt not loaded");
		expect(text).not.toContain("(no open requests");
	});

	test("seed with an empty context renders honest placeholders", () => {
		const seeded = promptEditorState.seed(fakeSpawnContext());
		const { text, stateMessageCount } = renderStateBlock(seeded);
		expect(stateMessageCount).toBe(1);
		expect(text).toContain('<target_prompt agent="(unset)" hash="(unset)">');
		expect(text).toContain(
			"sessionData.targetPromptRender to the node-id-stamped render",
		);
		expect(text).toContain("<diffs>");
		expect(text).toContain(
			"sessionData.appliedDiffs to the applied-transaction log",
		);
		expect(text).toContain("<requests>");
		expect(text).toContain("sessionData.requestQueue to the rendered queue");
	});

	test("seed prefers prior state over the spawn payload", () => {
		const fixture = readStateFixture();
		const seeded = promptEditorState.seed(fakeSpawnContext(), fixture);
		expect(seeded).toEqual(fixture);
		expect(seeded).not.toBe(fixture);
	});

	test("update is a v1 pass-through", () => {
		const fixture = readStateFixture();
		const event: SessionEvent = {
			kind: "turn_end",
			seq: 0,
			messageIndex: 0,
			timestamp: Date.now(),
			turnIndex: 0,
		};
		expect(promptEditorState.update(fixture, event)).toBe(fixture);
	});

	test("state/fixtures/default.json is a data-only fixture envelope whose state previews render", () => {
		const raw = JSON.parse(readFileSync(STATE_FIXTURE_FILE, "utf8")) as Record<
			string,
			unknown
		>;
		// The kernel lab envelope needs only a label and the complete S sample.
		expect(Object.keys(raw).sort()).toEqual(["label", "state"]);
		expect(raw.label).toBe("default");
		expect(raw.variables).toBeUndefined();
		// The state key is exactly the S shape, strings throughout.
		const state = raw.state as Record<string, unknown>;
		expect(Object.keys(state).sort()).toEqual([
			"appliedDiffs",
			"requestQueue",
			"targetAgent",
			"targetPromptHash",
			"targetPromptRender",
		]);
		for (const value of Object.values(state)) {
			expect(typeof value).toBe("string");
		}
		// The envelope's state plugs straight into render() as S.
		const { text, stateMessageCount } = renderStateBlock(
			state as unknown as PromptEditorState,
		);
		expect(stateMessageCount).toBe(1);
		expect(text).toContain('hash="pk1-9f4c2e7ab31d58c6"');
		expect(text).toContain("R2 open  range:para-1[10..17]");
		expect(text).not.toContain("(unset)");
	});

	test("every state/fixtures/*.json is a valid envelope with an S-shaped state", () => {
		const fixturesDir = join(BUNDLE_DIR, "state", "fixtures");
		const files = readdirSync(fixturesDir)
			.filter((name) => name.endsWith(".json"))
			.sort();
		expect(files).toEqual([
			"default.json",
			"empty-run.json",
			"long-run.json",
			"mid-session.json",
		]);
		for (const name of files) {
			const envelope = readStateFixtureEnvelope(join(fixturesDir, name));
			expect(typeof envelope.label).toBe("string");
			expect(Object.keys(envelope).sort()).toEqual(["label", "state"]);
			expect(envelope.variables).toBeUndefined();
			const state = envelope.state as unknown as Record<string, unknown>;
			expect(Object.keys(state).sort()).toEqual([
				"appliedDiffs",
				"requestQueue",
				"targetAgent",
				"targetPromptHash",
				"targetPromptRender",
			]);
			for (const value of Object.values(state)) {
				expect(typeof value).toBe("string");
			}
			const { text, stateMessageCount } = renderStateBlock(envelope.state);
			expect(stateMessageCount).toBe(1);
			expect(text).not.toContain("(unset)");
			expect(text).not.toContain("(target prompt not loaded");
		}
	});
});

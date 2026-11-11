import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	GUIDANCE_SOURCE_MANIFEST,
	loadGuidance,
	writeGuidanceBundle,
	type GuidanceSnapshot,
	type GuidanceTopicId,
} from "../src/guidance";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const BUNDLE = resolve(import.meta.dir, "../guidance");
/** One topic's text from a snapshot. */
const topic = (snapshot: GuidanceSnapshot, id: GuidanceTopicId) => snapshot.topics.find((entry) => entry.id === id)!.text;
/** Every file under dir, by its relative path. */
async function files(dir: string, base = dir): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) Object.assign(out, await files(path, base));
		else out[path.slice(base.length + 1)] = await readFile(path, "utf8");
	}
	return out;
}
const temporary: string[] = [];

async function temp(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "prompt-kit-guidance-"));
	temporary.push(path);
	return path;
}

/** A checkout copy with docs/ and every guidance source outside it, such as the prompt-editor blocks. */
async function copyCorpus(root: string): Promise<void> {
	await cp(join(REPO_ROOT, "docs"), join(root, "docs"), { recursive: true });
	for (const source of GUIDANCE_SOURCE_MANIFEST.filter((entry) => !entry.path.startsWith("docs/"))) {
		await mkdir(dirname(join(root, source.path)), { recursive: true });
		await cp(join(REPO_ROOT, source.path), join(root, source.path));
	}
}

afterEach(async () => {
	await Promise.all(
		temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("prompt authoring guidance", () => {
	test("serves each profile's standards and the shared topics, and catalogs detailed canonical references", async () => {
		const agent = await loadGuidance({ profile: "agent" });
		const single = await loadGuidance({ profile: "single-output" });
		const generic = await loadGuidance();

		expect(agent.profile).toBe("agent");
		expect(topic(agent, "standards")).toContain("## Agent prompt structure");
		expect(topic(agent, "standards")).not.toContain("## Single-output prompt structure");
		expect(topic(single, "standards")).toContain("## Single-output prompt structure");
		expect(topic(single, "standards")).not.toContain("## Agent prompt structure");
		expect(generic.profile).toBe("generic");
		expect(topic(generic, "standards")).toContain("## Prompt placement and structure");
		expect(topic(generic, "standards")).toContain("## Prompt quality");
		expect(topic(generic, "operations")).toContain("The canonical prompt object is a `PromptDocument`");
		expect(topic(generic, "operations")).toContain("## Prompt edit operation guide");
		expect(topic(agent, "standards")).toContain("# Workflow Structure");
		expect(topic(agent, "operations")).toContain("| update_node | Shallow-merge supported fields");
		expect(topic(agent, "operations")).toContain("Errors identify the offending operation");
		expect(Object.keys(generic.references)).toEqual(
			GUIDANCE_SOURCE_MANIFEST.map((source) => source.id),
		);
		expect(agent.catalog.map((entry) => entry.id)).toContain("workflow");
		expect(agent.catalog.map((entry) => entry.id)).not.toContain(
			"single-output-structure",
		);
	});

	test("new loads observe source changes while a pinned snapshot stays immutable", async () => {
		const root = await temp();
		await copyCorpus(root);
		const before = await loadGuidance({ repoRoot: root, profile: "agent" });
		const source = GUIDANCE_SOURCE_MANIFEST.find(
			(entry) => entry.id === "agent-structure",
		)!;
		const target = join(root, source.path);
		const document = JSON.parse(await readFile(target, "utf8"));
		const titleBlock = Object.values(document.blocks as Record<string, any>).find(
			(block: any) => Array.isArray(block.text) && block.text.length > 0,
		) as any;
		titleBlock.text[0].insert = "Fresh Agent Guidance";
		await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
		const after = await loadGuidance({ repoRoot: root, profile: "agent" });

		expect(after.snapshotId).not.toBe(before.snapshotId);
		expect(topic(after, "standards")).toContain("Fresh Agent Guidance");
		expect(topic(before, "standards")).not.toContain("Fresh Agent Guidance");
		const beforeSource = before.sources.find((entry) => entry.path === source.path)!;
		const afterSource = after.sources.find((entry) => entry.path === source.path)!;
		expect(afterSource.sourceSha256).not.toBe(beforeSource.sourceSha256);
		expect(afterSource.renderedSha256).not.toBe(beforeSource.renderedSha256);
		expect(afterSource.sha256).not.toBe(beforeSource.sha256);
		await writeFile(target, ` ${await readFile(target, "utf8")}`);
		const sourceOnly = await loadGuidance({ repoRoot: root, profile: "agent" });
		const sourceOnlyProvenance = sourceOnly.sources.find(
			(entry) => entry.path === source.path,
		)!;
		expect(sourceOnly.topics).toEqual(after.topics);
		expect(sourceOnly.snapshotId).not.toBe(after.snapshotId);
		expect(sourceOnlyProvenance.sourceSha256).not.toBe(afterSource.sourceSha256);
		expect(sourceOnlyProvenance.renderedSha256).toBe(afterSource.renderedSha256);
		expect(Object.isFrozen(before)).toBe(true);
		expect(Object.isFrozen(before.references)).toBe(true);
		expect(Object.isFrozen(before.sources)).toBe(true);
	});

	test("an incomplete canonical corpus fails instead of silently using a bundle", async () => {
		const root = await temp();
		await copyCorpus(root);
		const bundle = await temp();
		await writeGuidanceBundle(bundle, await loadGuidance());
		const missing = GUIDANCE_SOURCE_MANIFEST[0]!;
		await unlink(join(root, missing.path));

		await expect(
			loadGuidance({ repoRoot: root, bundledRoot: bundle }),
		).rejects.toThrow(`Canonical guidance source is unavailable: ${missing.path}`);
	});

	test("invalid native Docs input fails before guidance assembly", async () => {
		const root = await temp();
		await copyCorpus(root);
		const source = GUIDANCE_SOURCE_MANIFEST[0]!;
		await writeFile(join(root, source.path), "not json\n");
		await expect(loadGuidance({ repoRoot: root })).rejects.toThrow(
			`Prompt guidance is not valid JSON: ${source.path}`,
		);
		await writeFile(join(root, source.path), "{}\n");
		await expect(loadGuidance({ repoRoot: root })).rejects.toThrow(
			`Prompt guidance is structurally invalid: ${source.path}`,
		);
	});

	test("the bundle preserves provenance and provides an explicit portable fallback", async () => {
		const output = await temp();
		const canonical = await loadGuidance({ profile: "agent" });
		await writeGuidanceBundle(output, canonical);
		const portable = await loadGuidance({
			profile: "agent",
			bundledRoot: output,
			sourceMode: "bundled",
		});

		expect(portable.snapshotId).toBe(canonical.snapshotId);
		expect(portable.topics).toEqual(canonical.topics);
		expect(portable.references).toEqual(canonical.references);
		expect(await readFile(join(output, "references/details/quality.md"), "utf8")).toContain(
			canonical.snapshotId,
		);
		expect(Object.keys(await files(output)).sort()).toEqual(
			["snapshot.json", ...GUIDANCE_SOURCE_MANIFEST.map((source) => `references/details/${source.id}.md`)].sort(),
		);
		const manifest = JSON.parse(await readFile(join(output, "snapshot.json"), "utf8"));
		expect(manifest.sources).toEqual(canonical.sources);

		await unlink(join(output, "references/details/quality.md"));
		await expect(
			loadGuidance({ profile: "agent", bundledRoot: output, sourceMode: "bundled" }),
		).rejects.toThrow("Bundled guidance reference is unavailable: quality");
	});

	test("the committed bundle equals a fresh build from the canonical docs", async () => {
		// Run `bun run --cwd packages/prompt-kit-server guidance:bundle` when this fails.
		const fresh = await temp();
		await writeGuidanceBundle(fresh);
		const again = await files(fresh);
		await writeGuidanceBundle(fresh);
		expect(await files(fresh)).toEqual(again);
		expect(await files(BUNDLE)).toEqual(again);
	});
});

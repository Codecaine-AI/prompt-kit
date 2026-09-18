import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	generateSkillReferences,
	GUIDANCE_SOURCE_MANIFEST,
	loadGuidance,
} from "../src/guidance";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const temporary: string[] = [];

async function temp(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "prompt-kit-guidance-"));
	temporary.push(path);
	return path;
}

afterEach(async () => {
	await Promise.all(
		temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("prompt authoring guidance", () => {
	test("assembles profile essentials and catalogs detailed canonical references", async () => {
		const agent = await loadGuidance({ profile: "agent" });
		const single = await loadGuidance({ profile: "single-output" });
		const generic = await loadGuidance();

		expect(agent.profile).toBe("agent");
		expect(agent.text).toContain("## Agent prompt structure");
		expect(agent.text).not.toContain("## Single-output prompt structure");
		expect(single.text).toContain("## Single-output prompt structure");
		expect(single.text).not.toContain("## Agent prompt structure");
		expect(generic.profile).toBe("generic");
		expect(generic.text).toContain("## Prompt placement and structure");
		expect(generic.text).toContain("## Prompt quality");
		expect(generic.text).toContain("The canonical prompt object is a `PromptDocument`");
		expect(generic.text).toContain("## Prompt edit operation guide");
		expect(agent.text).toContain("# Workflow Structure");
		expect(agent.text).toContain("| update_node | Shallow-merge supported fields");
		expect(agent.text).toContain("Errors identify the offending operation");
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
		await cp(join(REPO_ROOT, "docs"), join(root, "docs"), { recursive: true });
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
		expect(after.text).toContain("Fresh Agent Guidance");
		expect(before.text).not.toContain("Fresh Agent Guidance");
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
		expect(sourceOnly.text).toBe(after.text);
		expect(sourceOnly.snapshotId).not.toBe(after.snapshotId);
		expect(sourceOnlyProvenance.sourceSha256).not.toBe(afterSource.sourceSha256);
		expect(sourceOnlyProvenance.renderedSha256).toBe(afterSource.renderedSha256);
		expect(Object.isFrozen(before)).toBe(true);
		expect(Object.isFrozen(before.references)).toBe(true);
		expect(Object.isFrozen(before.sources)).toBe(true);
	});

	test("an incomplete canonical corpus fails instead of silently using a bundle", async () => {
		const root = await temp();
		await cp(join(REPO_ROOT, "docs"), join(root, "docs"), { recursive: true });
		const bundle = await temp();
		await generateSkillReferences(bundle, await loadGuidance());
		const missing = GUIDANCE_SOURCE_MANIFEST[0]!;
		await unlink(join(root, missing.path));

		await expect(
			loadGuidance({ repoRoot: root, bundledRoot: bundle }),
		).rejects.toThrow(`Canonical guidance source is unavailable: ${missing.path}`);
	});

	test("invalid native Docs input fails before guidance assembly", async () => {
		const root = await temp();
		await cp(join(REPO_ROOT, "docs"), join(root, "docs"), { recursive: true });
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

	test("generated references preserve provenance and provide an explicit portable fallback", async () => {
		const output = await temp();
		const canonical = await loadGuidance({ profile: "agent" });
		await generateSkillReferences(output, canonical);
		const portable = await loadGuidance({
			profile: "agent",
			bundledRoot: output,
			sourceMode: "bundled",
		});

		expect(portable.snapshotId).toBe(canonical.snapshotId);
		expect(portable.text).toBe(canonical.text);
		expect(portable.references).toEqual(canonical.references);
		expect(await readFile(join(output, "references/standards.md"), "utf8")).toContain(
			canonical.snapshotId,
		);
		expect(await readFile(join(output, "references/catalog.md"), "utf8")).toContain(
			"details/workflow.md",
		);
		const manifest = JSON.parse(await readFile(join(output, "snapshot.json"), "utf8"));
		expect(manifest.sources).toEqual(canonical.sources);

		await unlink(join(output, "references/details/quality.md"));
		await expect(
			loadGuidance({ profile: "agent", bundledRoot: output, sourceMode: "bundled" }),
		).rejects.toThrow("Bundled guidance reference is unavailable: quality");
	});
});

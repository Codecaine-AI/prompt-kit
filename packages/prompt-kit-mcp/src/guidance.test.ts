import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { generateSkillFolder, SKILL_SOURCES } from "./guidance";
import { PACKAGE_ROOT } from "./lifecycle";

async function files(root: string, dir = root): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, await files(root, path));
    else out[relative(root, path)] = await readFile(path, "utf8");
  }
  return out;
}

test("the skill folder generates the editor references and hashes every source", async () => {
  const out = await mkdtemp(join(tmpdir(), "prompt-skill-"));
  try {
    await generateSkillFolder(out);
    const first = await files(out);
    await generateSkillFolder(out);
    expect(await files(out)).toEqual(first);

    const snapshot = JSON.parse(first["snapshot.json"]!) as { sources: unknown[]; skillSources: Array<{ path: string; sha256: string; output?: string }> };
    expect(snapshot.sources.length).toBeGreaterThan(0);
    const repo = resolve(PACKAGE_ROOT, "../..");
    for (const source of SKILL_SOURCES) {
      const content = await readFile(join(repo, source.path), "utf8");
      const entry = snapshot.skillSources.find((candidate) => candidate.path === source.path)!;
      expect(entry.sha256).toBe(createHash("sha256").update(content).digest("hex"));
      if (source.output) expect(first[source.output]).toEndWith(content);
    }
    expect(Object.keys(first)).toEqual(expect.arrayContaining(["references/prompt-state-reference.md", "references/prompt-tool-guide.md", "references/standards.md"]));

    // The committed skill folder must match its sources. Run `bun packages/prompt-kit-mcp/src/cli.ts guidance --write` when this fails.
    const { "SKILL.md": _skill, ...committed } = await files(join(PACKAGE_ROOT, "skills", "prompt-kit"));
    expect(committed).toEqual(first);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

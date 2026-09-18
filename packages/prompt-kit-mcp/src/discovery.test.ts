import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPromptProjects } from "./discovery";

const prompt = (id: string) => ({ kind: "prompt", schemaVersion: "prompt-kit/v1", id, title: id, nodes: [{ type: "paragraph", id: `${id}-body`, content: ["hello"] }] });

test("discovers explicit standalone and package catalog forms while isolating malformed entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-discovery-"));
  try {
    await mkdir(join(root, "packages", "agents", "catalog", "folder", "prompt"), { recursive: true });
    await mkdir(join(root, "packages", "agents", "catalog", "file"), { recursive: true });
    await mkdir(join(root, "standalone"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    await writeFile(join(root, "codecaine.prompts.json"), JSON.stringify({
      name: "workspace-prompts", profile: "generic",
      standalonePrompts: [{ path: "standalone/one.json", profile: "single-output", variables: ["name"] }],
    }));
    await writeFile(join(root, "standalone", "one.json"), JSON.stringify(prompt("standalone")));
    await writeFile(join(root, "packages", "agents", "catalog", "folder", "agent.json"), JSON.stringify({ profile: "agent", variables: {} }));
    await writeFile(join(root, "packages", "agents", "catalog", "folder", "prompt", "prompt.json"), JSON.stringify(prompt("folder")));
    await writeFile(join(root, "packages", "agents", "catalog", "file", "prompt.json"), "{bad");

    const found = await discoverPromptProjects(root);
    expect(found.projects.flatMap((project) => project.prompts.map((entry) => entry.id)).sort()).toEqual(["folder", "standalone"]);
    const folder = found.projects.flatMap((project) => project.prompts).find((entry) => entry.id === "folder")!;
    expect(folder.profile).toBe("agent");
    expect(folder.target.declaredVariables).toEqual([]);
    expect(found.projects.flatMap((project) => project.errors)).toHaveLength(1);
    expect(found.configurationFingerprint).toHaveLength(64);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("confines configured projects and prompt symlinks to the active workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-discovery-"));
  const outside = await mkdtemp(join(tmpdir(), "prompt-outside-"));
  try {
    await writeFile(join(outside, "prompt.json"), JSON.stringify(prompt("outside")));
    await writeFile(join(root, "codecaine.prompts.json"), JSON.stringify({ projects: ["../escape"], standalone: ["linked.json"] }));
    await symlink(join(outside, "prompt.json"), join(root, "linked.json"));
    const found = await discoverPromptProjects(root);
    expect(found.warnings.join(" ")).toContain("escapes project");
    expect(found.projects[0]?.errors[0]?.detail).toContain("symlink escapes project");
    expect(found.projects.flatMap((project) => project.prompts)).toHaveLength(0);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { PACKAGE_ROOT } from "./lifecycle";
import { loadGuidance } from "./guidance";

const repositoryRoot = resolve(PACKAGE_ROOT, "../..");
const packagePaths = ["packages/prompt-kit-mcp", "packages/prompt-kit-server", "packages/prompt-kit"];

async function git(args: string[]) {
  const run = Bun.spawn(["git", "-C", repositoryRoot, ...args], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(run.stdout).text();
  return await run.exited === 0 ? output.trim() : null;
}
export async function runtimePackages() {
  return Promise.all(packagePaths.map(async relative => {
    const root = join(repositoryRoot, relative);
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const hash = createHash("sha256").update(await readFile(join(root, "package.json")));
    const sources = [...new Bun.Glob("src/**/*.{ts,tsx,json}").scanSync({ cwd: root, onlyFiles: true })]
      .filter(file => !file.includes("__tests__") && !file.endsWith(".test.ts") && !file.endsWith(".test.tsx")).sort();
    for (const file of sources) hash.update(file).update(await readFile(join(root, file)));
    return { name: manifest.name, version: manifest.version, path: relative, sourceHash: hash.digest("hex"), dependencies: manifest.dependencies ?? {} };
  }));
}
export async function runtimeHash() {
  return createHash("sha256").update(JSON.stringify(await runtimePackages())).digest("hex");
}
export async function createDevelopmentSnapshot(toolContract?: unknown) {
  const guidance = await loadGuidance();
  const packages = await runtimePackages();
  const body = {
    schemaVersion: 1, kind: "local-development", packages,
    repository: { name: basename(repositoryRoot), commit: await git(["rev-parse", "HEAD"]), dirty: !!await git(["status", "--porcelain", "--untracked-files=normal"]) },
    guidanceSnapshot: guidance.snapshotId, guidanceSources: guidance.sources,
    toolContractHash: toolContract ? createHash("sha256").update(JSON.stringify(toolContract)).digest("hex") : null,
    clients: ["codex", "claude", "pi"],
  };
  return { ...body, snapshotId: createHash("sha256").update(JSON.stringify(body)).digest("hex"), createdAt: new Date().toISOString() };
}

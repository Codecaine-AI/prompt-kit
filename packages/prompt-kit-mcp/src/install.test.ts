import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeConfig, codexConfig, doctorClients, installClients, restoreInstallation } from "./install";

const dirs: string[] = [];
async function fixture() {
  const homeDir = await mkdtemp(join(tmpdir(), "docs-install-test-"));
  dirs.push(homeDir);
  return { homeDir, packageRoot: "/checkout with spaces/prompt-kit-mcp", bunPath: "/bin/bun", skillFiles: { "SKILL.md": "---\nname: codecaine-prompts\ndescription: Read and edit docs.\n---\nUse the tools.\n", "references/standards.md": "Standards\n" } };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("client installation", () => {
  test("preview creates no user files and includes all three clients", async () => {
    const options = await fixture();
    const result = await installClients(options);
    expect(result.mode).toBe("preview");
    expect(result.clients).toEqual(["codex", "claude", "pi"]);
    expect(result.changes.every((change) => change.action === "create" && !change.written)).toBe(true);
    expect(await readdir(options.homeDir)).toEqual([]);
    expect(result.command.args).toEqual(["/checkout with spaces/prompt-kit-mcp/src/cli.ts", "mcp"]);
  });
  test("preserves user settings, creates backups, and reinstalls without changes", async () => {
    const options = await fixture();
    await mkdir(join(options.homeDir, ".codex"));
    const originalToml = '# keep my comment\nmodel = "my-model"\n[mcp_servers.other]\ncommand = "other"\n';
    const originalClaude = JSON.stringify({ theme: "dark", mcpServers: { other: { type: "stdio", command: "other" } }, projects: { "/work": { trusted: true } } });
    await writeFile(join(options.homeDir, ".codex/config.toml"), originalToml);
    await writeFile(join(options.homeDir, ".claude.json"), originalClaude);
    const result = await installClients({ ...options, write: true });
    const codex = await readFile(join(options.homeDir, ".codex/config.toml"), "utf8");
    expect(codex.startsWith(originalToml)).toBe(true);
    expect((Bun.TOML.parse(codex) as Record<string, unknown>).mcp_servers).toMatchObject({ other: { command: "other" }, "codecaine-prompts": { command: "/bin/bun" } });
    const claude = JSON.parse(await readFile(join(options.homeDir, ".claude.json"), "utf8"));
    expect(claude).toMatchObject({ theme: "dark", mcpServers: { other: { command: "other" }, "codecaine-prompts": { type: "stdio", command: "/bin/bun" } } });
    expect(claude.mcpServers["codecaine-prompts"].args).not.toContain("--workspace");
    for (const change of result.changes.filter((entry) => entry.backup)) {
      expect(await readFile(change.backup!, "utf8")).toBe(change.path.endsWith("toml") ? originalToml : originalClaude);
    }
    const repeat = await installClients({ ...options, write: true });
    expect(repeat.changes.every((change) => change.action === "unchanged" && !change.written)).toBe(true);
    expect((await doctorClients(options)).ok).toBe(true);
    const pi = await readFile(join(options.homeDir, ".pi/agent/extensions/codecaine-prompts.ts"), "utf8");
    expect(pi).toContain("createPiExtension");
  });
  test("invalid existing config aborts before any install writes", async () => {
    const options = await fixture();
    await writeFile(join(options.homeDir, ".claude.json"), "broken JSON");
    await expect(installClients({ ...options, write: true })).rejects.toThrow();
    expect(await readdir(options.homeDir)).toEqual([".claude.json"]);
  });
  test("rolls back earlier commits when a later destination fails", async () => {
    const options = await fixture();
    await mkdir(join(options.homeDir, ".codex"));
    const originalCodex = 'model = "keep"\n';
    const originalClaude = '{"theme":"keep"}\n';
    await writeFile(join(options.homeDir, ".codex/config.toml"), originalCodex);
    await writeFile(join(options.homeDir, ".claude.json"), originalClaude);
    await expect(installClients({ ...options, write: true, testFault: (_phase, _path, index) => {
      if (index === 1) throw new Error("injected commit failure");
    } })).rejects.toThrow("injected commit failure");
    expect(await readFile(join(options.homeDir, ".codex/config.toml"), "utf8")).toBe(originalCodex);
    expect(await readFile(join(options.homeDir, ".claude.json"), "utf8")).toBe(originalClaude);
    const leftovers = [...new Bun.Glob("**/*codecaine-*").scanSync({ cwd: options.homeDir, onlyFiles: true })];
    expect(leftovers).toEqual([]);
  });
  test("individual clients install only their bindings; doctor reports skill drift", async () => {
    const options = await fixture();
    await installClients({ ...options, clients: ["pi"], write: true });
    expect((await readdir(options.homeDir)).sort()).toEqual([".agents", ".pi"]);
    const result = await doctorClients({ ...options, clients: ["pi"], skillFiles: { ...options.skillFiles, "references/standards.md": "New standards\n" } });
    expect(result.ok).toBe(false);
    expect(result.checks.filter((check) => check.status === "outdated")).toHaveLength(1);
  });
  test("does not overwrite unmanaged or customized Codex server entries", () => {
    expect(() => codexConfig('[mcp_servers.codecaine-prompts]\ncommand = "custom"\n', "bun", [])).toThrow("unmanaged");
    const managed = codexConfig("", "bun", []).replace("tool_timeout_sec = 120", 'tool_timeout_sec = 120\nenabled = false');
    expect(() => codexConfig(managed, "bun", [])).toThrow("custom fields");
  });
  test("refuses unmanaged Claude collisions and marks installer-owned entries", () => {
    for (const entry of [
      { type: "http", url: "https://example.com/mcp" },
      { type: "stdio", command: "custom", args: [] },
    ]) expect(() => claudeConfig(JSON.stringify({ mcpServers: { "codecaine-prompts": entry } }), "bun", ["cli.ts", "mcp"])).toThrow("unmanaged");
    const installed = claudeConfig(null, "bun", ["cli.ts", "mcp"]);
    expect(JSON.parse(installed).mcpServers["codecaine-prompts"].env.CODECAINE_PROMPTS_INSTALLER).toBe("prompt-kit-mcp/v1");
    expect(() => claudeConfig(installed, "new-bun", ["new-cli.ts", "mcp"])).not.toThrow();
  });
  test("rejects skill path traversal before installation", async () => {
    const options = await fixture();
    await expect(installClients({ ...options, write: true, skillFiles: { "../../escape": "bad" } })).rejects.toThrow("Invalid skill file path");
    expect(await readdir(options.homeDir)).toEqual([]);
  });
  test("restore previews, restores exact old configuration, and refuses later edits", async () => {
    const options = await fixture();
    const original = '{"theme":"dark"}\n';
    await writeFile(join(options.homeDir, ".claude.json"), original);
    const report = await installClients({ ...options, clients: ["claude"], write: true });
    const generated = await readFile(join(options.homeDir, ".claude.json"), "utf8");
    const preview = await restoreInstallation(report);
    expect(preview.changes.every((item) => !item.written)).toBe(true);
    await writeFile(join(options.homeDir, ".claude.json"), "changed by user");
    await expect(restoreInstallation(report, { write: true })).rejects.toThrow("installed file changed");
    const current = report.changes.find((item) => item.path.endsWith(".claude.json"))!;
    await writeFile(current.path, generated);
    await restoreInstallation(report, { write: true });
    expect(await readFile(current.path, "utf8")).toBe(original);
    expect(await readdir(join(options.homeDir, ".claude/skills/codecaine-prompts"))).not.toContain("SKILL.md");
  });
});

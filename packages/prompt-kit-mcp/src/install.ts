import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ClientName = "codex" | "claude" | "pi";
export interface InstallOptions {
  clients?: ClientName[];
  write?: boolean;
  homeDir?: string;
  packageRoot?: string;
  bunPath?: string;
  /** Explicit paths support non-default client installations. */
  codexDir?: string;
  claudeDir?: string;
  claudeConfigFile?: string;
  piDir?: string;
  /** Pre-rendered skill files, also useful for isolated installer tests. */
  skillFiles?: Record<string, string>;
  /** Failure injection for transactional installer tests. */
  testFault?: (phase: "before-commit", path: string, index: number) => void | Promise<void>;
}
export interface InstallChange {
  path: string;
  kind: "config" | "skill" | "extension";
  action: "create" | "update" | "remove" | "unchanged";
  sha256: string;
  written: boolean;
  backup?: string;
  backupSha256?: string;
}
export interface InstallResult {
  mode: "preview" | "write";
  clients: ClientName[];
  changes: InstallChange[];
  command: { command: string; args: string[] };
  notes: string[];
}
/** `after: null` removes a file this installer wrote under the legacy name. */
type PlannedFile = { path: string; kind: InstallChange["kind"]; before: string | null; after: string | null };
const NAME = "prompt-kit";
const START = "# BEGIN PROMPT KIT MCP (managed by prompt-kit-mcp install)";
const END = "# END PROMPT KIT MCP";
// Earlier versions installed under this name. Install removes only what they marked as managed.
const LEGACY_NAME = "codecaine-prompts";
const LEGACY_START = "# BEGIN CODECAINE PROMPTS MCP (managed by prompt-kit-mcp install)";
const LEGACY_END = "# END CODECAINE PROMPTS MCP";
const PI_BANNER = "// Managed by Prompt Kit.";
const LEGACY_PI_BANNER = "// Managed by Codecaine Prompts.";
const CLAUDE_OWNER_KEY = "CODECAINE_PROMPTS_INSTALLER";
const CLAUDE_OWNER_VALUE = "prompt-kit-mcp/v1";
const DEFAULT_PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

async function existing(path: string): Promise<string | null> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to replace symlink ${path}. Supply its actual target as an explicit installer path.`);
    if (!stat.isFile()) throw new Error(`Expected a regular file: ${path}`);
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function managedBlock(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) throw new Error("Incomplete Prompt Kit managed block in Codex config");
  return { start, end: end < 0 ? end : end + endMarker.length };
}

/** Preserve all unrelated TOML, including comments. Reject unmanaged name collisions. */
export function codexConfig(original: string, command: string, args: string[]): string {
  const legacy = managedBlock(original, LEGACY_START, LEGACY_END);
  let before = original;
  if (legacy.start >= 0) {
    const servers = object(Bun.TOML.parse(original), "Codex config").mcp_servers as Record<string, unknown> | undefined;
    const owned = object(servers?.[LEGACY_NAME], LEGACY_NAME);
    if (Object.keys(owned).some((key) => !["command", "args", "startup_timeout_sec", "tool_timeout_sec"].includes(key))) throw new Error("The managed Codex server has custom fields. Move its configuration out of installer management before reinstalling.");
    const head = original.slice(0, legacy.start).replace(/\n+$/, "\n");
    before = (head === "\n" ? "" : head) + original.slice(legacy.end).replace(/^\n/, "");
  }
  const parsed = object(Bun.TOML.parse(before), "Codex config");
  const { start, end } = managedBlock(before, START, END);
  const servers = parsed.mcp_servers === undefined ? {} : object(parsed.mcp_servers, "mcp_servers");
  if (start < 0 && servers[NAME] !== undefined) {
    throw new Error("Codex already has an unmanaged prompt-kit server. Rename that entry or remove it before installing; other MCP servers are preserved.");
  }
  const block = `${START}\n[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\n${END}`;
  if (start >= 0) {
    // The block is installer-owned. Refuse custom fields rather than silently discard them.
    const owned = object(servers[NAME], NAME);
    const supported = new Set(["command", "args", "startup_timeout_sec", "tool_timeout_sec"]);
    if (Object.keys(owned).some((key) => !supported.has(key))) throw new Error("The managed Codex server has custom fields. Move its configuration out of installer management before reinstalling.");
  }
  const after = start < 0 ? `${before}${before && !before.endsWith("\n") ? "\n" : ""}\n${block}\n` : before.slice(0, start) + block + before.slice(end);
  Bun.TOML.parse(after);
  return after;
}

/** Preserve unrelated Claude settings and refuse to commandeer an entry not created by this installer. */
export function claudeConfig(before: string | null, command: string, args: string[]): string {
  const config = before ? object(JSON.parse(before), "Claude config") : {};
  const servers = { ...(config.mcpServers === undefined ? {} : object(config.mcpServers, "mcpServers")) };
  const owned = (entry: unknown) => typeof entry === "object" && entry !== null && (entry as { env?: Record<string, unknown> }).env?.[CLAUDE_OWNER_KEY] === CLAUDE_OWNER_VALUE;
  // A legacy entry is removed only when this installer marked it; its local options carry over.
  const legacy = owned(servers[LEGACY_NAME]) ? servers[LEGACY_NAME] : undefined;
  if (legacy !== undefined) delete servers[LEGACY_NAME];
  const candidate = servers[NAME] ?? legacy;
  let previous: Record<string, unknown> = {};
  if (candidate !== undefined) {
    previous = object(candidate, NAME);
    const env = previous.env === undefined ? {} : object(previous.env, `${NAME} env`);
    if (env[CLAUDE_OWNER_KEY] !== CLAUDE_OWNER_VALUE) {
      throw new Error("Claude already has an unmanaged prompt-kit server. Rename or remove it before installing; unrelated MCP servers are preserved.");
    }
  }
  const previousEnv = previous.env === undefined ? {} : object(previous.env, `${NAME} env`);
  const { url: _url, headers: _headers, ...localOptions } = previous;
  const entry = { ...localOptions, type: "stdio", command, args, env: { ...previousEnv, [CLAUDE_OWNER_KEY]: CLAUDE_OWNER_VALUE } };
  const after = { ...config, mcpServers: { ...servers, [NAME]: entry } };
  return JSON.stringify(config) === JSON.stringify(after) && before ? before : JSON.stringify(after, null, 2) + "\n";
}

async function collectFiles(root: string, relative = ""): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(files, await collectFiles(root, path));
    else if (entry.isFile()) files[path] = await readFile(join(root, path), "utf8");
    else throw new Error(`Skill sources must be ordinary files or directories: ${path}`);
  }
  return files;
}

async function skillFiles(options: InstallOptions, root: string): Promise<Record<string, string>> {
  if (options.skillFiles) return options.skillFiles;
  const template = await collectFiles(join(root, "skills", NAME));
  const temp = await mkdtemp(join(tmpdir(), "codecaine-prompt-skills-"));
  try {
    const { generateSkillReferences } = await import("./guidance");
    await generateSkillReferences(temp);
    return { ...template, ...await collectFiles(temp) };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function plan(options: InstallOptions) {
  const clients = [...new Set(options.clients ?? ["codex", "claude", "pi"])] as ClientName[];
  if (!clients.length || clients.some((name) => !["codex", "claude", "pi"].includes(name))) throw new Error("Choose codex, claude, pi, or all clients");
  const home = resolve(options.homeDir ?? homedir());
  // A supplied test home must never inherit real user configuration overrides.
  const useEnv = options.homeDir === undefined;
  const root = resolve(options.packageRoot ?? DEFAULT_PACKAGE_ROOT);
  const bunPath = options.bunPath ?? Bun.which("bun");
  if (!bunPath) throw new Error("Bun is required. Install Bun, then run the installer again.");
  const command = { command: resolve(bunPath), args: [join(root, "src/cli.ts"), "mcp"] };
  const files: PlannedFile[] = [];
  const add = async (path: string, kind: PlannedFile["kind"], make: (before: string | null) => string | null) => {
    const before = await existing(path);
    files.push({ path, kind, before, after: make(before) });
  };
  if (clients.includes("codex")) {
    const dir = options.codexDir ?? (useEnv ? process.env.CODEX_HOME : undefined) ?? join(home, ".codex");
    await add(join(dir, "config.toml"), "config", (before) => codexConfig(before ?? "", command.command, command.args));
  }
  if (clients.includes("claude")) {
    if (useEnv && process.env.CLAUDE_CONFIG_DIR && !options.claudeConfigFile) throw new Error("CLAUDE_CONFIG_DIR is customized. Supply claudeConfigFile and claudeDir explicitly to avoid changing the wrong Claude configuration.");
    await add(options.claudeConfigFile ?? join(home, ".claude.json"), "config", (before) => claudeConfig(before, command.command, command.args));
  }
  if (clients.includes("pi")) {
    const dir = options.piDir ?? (useEnv ? process.env.PI_CODING_AGENT_DIR : undefined) ?? join(home, ".pi/agent");
    const legacyBridge = join(dir, `extensions/${LEGACY_NAME}.ts`);
    if ((await existing(legacyBridge))?.startsWith(LEGACY_PI_BANNER)) await add(legacyBridge, "extension", () => null);
    await add(join(dir, `extensions/${NAME}.ts`), "extension", () => `${PI_BANNER} Re-run install to update this checkout path.\nimport { createPiExtension } from ${JSON.stringify(join(root, "src/pi-extension.ts"))};\nexport default createPiExtension(${JSON.stringify(command)});\n`);
  }
  const rendered = await skillFiles(options, root);
  const skillRoots = new Set<string>();
  if (clients.includes("codex") || clients.includes("pi")) skillRoots.add(join(home, ".agents/skills"));
  if (clients.includes("claude")) skillRoots.add(join(options.claudeDir ?? join(home, ".claude"), "skills"));
  for (const skillRoot of skillRoots) {
    // Remove the files this installer writes from a real legacy skill folder whose skill it named. Other files and backups stay.
    const legacy = join(skillRoot, LEGACY_NAME);
    const stat = await lstat(legacy).catch(() => null);
    const legacySkill = stat?.isDirectory() ? await existing(join(legacy, "SKILL.md")) : null;
    if (legacySkill?.includes(`\nname: ${LEGACY_NAME}\n`)) {
      for (const relative of Object.keys(rendered)) {
        if (await existing(join(legacy, relative)) !== null) await add(join(legacy, relative), "skill", () => null);
      }
    }
    const destination = join(skillRoot, NAME);
    for (const [relative, content] of Object.entries(rendered)) {
      const path = resolve(destination, relative);
      if (!path.startsWith(destination + "/")) throw new Error(`Invalid skill file path: ${relative}`);
      await add(path, "skill", () => content);
    }
  }
  return { clients, command, files };
}

/** Preview by default. Back up every changed existing file before an explicit write. */
export async function installClients(options: InstallOptions = {}): Promise<InstallResult> {
  const planned = await plan(options);
  const result: InstallResult = {
    mode: options.write ? "write" : "preview", clients: planned.clients, command: planned.command, changes: [],
    notes: ["Restart Codex and Claude Code after installation. In pi, use /reload or start a new session.", "Each connection discovers its active workspace; no fixed project is written into user configuration.", "pi uses a native extension that forwards the same MCP tools. It has no built-in MCP client.", "Skills are selected by the host model. Verify automatic guidance and editing in each client before considering setup accepted."],
  };
  // Complete parsing and generation for all clients before changing any user file.
  for (const file of planned.files) {
    const action = file.before === file.after ? "unchanged" : file.before === null ? "create" : file.after === null ? "remove" : "update";
    const change: InstallChange = { path: file.path, kind: file.kind, action, sha256: digest(file.after ?? ""), written: false };
    result.changes.push(change);
  }
  if (!options.write) return result;

  type Staged = { file: PlannedFile; change: InstallChange; temp: string; mode: number };
  const staged: Staged[] = [];
  const committed: Staged[] = [];
  try {
    // Every backup and replacement is durable before the first destination changes.
    for (let index = 0; index < planned.files.length; index++) {
      const file = planned.files[index]!;
      const change = result.changes[index]!;
      if (change.action === "unchanged") continue;
      await mkdir(dirname(file.path), { recursive: true });
      if (await existing(file.path) !== file.before) throw new Error(`Configuration changed during installation: ${file.path}. Run the installer again.`);
      const mode = file.before === null ? 0o600 : (await lstat(file.path)).mode & 0o777;
      const temp = `${file.path}.codecaine-${randomUUID()}.tmp`;
      staged.push({ file, change, temp, mode });
      if (file.before !== null) {
        change.backup = `${file.path}.codecaine-backup-${Date.now()}-${randomUUID()}`;
        change.backupSha256 = digest(file.before);
        await writeFile(change.backup, file.before, { flag: "wx", mode: 0o600 });
      }
      if (file.after !== null) await writeFile(temp, file.after, { flag: "wx", mode });
    }
    for (let index = 0; index < staged.length; index++) {
      const item = staged[index]!;
      if (await existing(item.file.path) !== item.file.before) throw new Error(`Configuration changed during installation: ${item.file.path}. Run the installer again.`);
      await options.testFault?.("before-commit", item.file.path, index);
      if (item.file.after === null) await rm(item.file.path);
      else await rename(item.temp, item.file.path);
      item.change.written = true;
      committed.push(item);
    }
    return result;
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const item of committed.reverse()) {
      try {
        if (item.file.before === null) await rm(item.file.path, { force: true });
        else {
          const rollback = `${item.file.path}.codecaine-rollback-${randomUUID()}.tmp`;
          try { await writeFile(rollback, item.file.before, { flag: "wx", mode: item.mode }); await rename(rollback, item.file.path); }
          finally { await rm(rollback, { force: true }); }
        }
        item.change.written = false;
      } catch (rollbackError) { rollbackErrors.push(`${item.file.path}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`); }
    }
    await Promise.all(staged.map(item => rm(item.temp, { force: true }).catch(() => {})));
    if (rollbackErrors.length) throw new Error(`Installation failed: ${error instanceof Error ? error.message : String(error)}. Rollback also failed: ${rollbackErrors.join("; ")}`);
    await Promise.all(staged.map(item => item.change.backup ? rm(item.change.backup, { force: true }).catch(() => {}) : Promise.resolve()));
    throw error;
  }
}

export async function doctorClients(options: InstallOptions = {}) {
  const preview = await installClients({ ...options, write: false });
  const checks = preview.changes.map((change) => ({ path: change.path, kind: change.kind, status: change.action === "unchanged" ? "ok" : change.action === "create" ? "missing" : "outdated" }));
  return { ok: checks.every((check) => check.status === "ok"), checks, notes: [...preview.notes, "Doctor checks installed files against current sources. Client connection and model-driven editing require the acceptance exercises."] };
}

/** Restore one saved write result. Refuse to overwrite edits made since installation. */
export async function restoreInstallation(report: InstallResult, options: { write?: boolean } = {}) {
  if (report.mode !== "write") throw new Error("Restore requires the saved result of an install --write run");
  const planned: Array<{ path: string; action: "remove-created-file" | "restore-backup"; content: string | null; expected: string | null }> = [];
  for (const change of report.changes.filter((entry) => entry.written).reverse()) {
    const current = await existing(change.path);
    if (change.action === "remove") {
      const backup = change.backup ? await existing(change.backup) : null;
      if (current !== null) throw new Error(`Refusing restore because the installed file changed: ${change.path}`);
      if (backup === null || digest(backup) !== change.backupSha256) throw new Error(`Missing or modified installation backup: ${change.backup}`);
      planned.push({ path: change.path, action: "restore-backup", content: backup, expected: null });
      continue;
    }
    if (current === null || digest(current) !== change.sha256) throw new Error(`Refusing restore because the installed file changed: ${change.path}`);
    if (change.action === "create") planned.push({ path: change.path, action: "remove-created-file", content: null, expected: current });
    else if (change.action === "update" && change.backup && change.backupSha256) {
      const backup = await existing(change.backup);
      if (backup === null || digest(backup) !== change.backupSha256) throw new Error(`Missing or modified installation backup: ${change.backup}`);
      planned.push({ path: change.path, action: "restore-backup", content: backup, expected: current });
    } else throw new Error(`Incomplete installation restore record: ${change.path}`);
  }
  if (options.write) for (const item of planned) {
    if (await existing(item.path) !== item.expected) throw new Error(`File changed during restore: ${item.path}`);
    if (item.content === null) await rm(item.path);
    else {
      const mode = item.expected === null ? 0o600 : (await lstat(item.path)).mode & 0o777;
      const temp = `${item.path}.codecaine-restore-${randomUUID()}.tmp`;
      try {
        await writeFile(temp, item.content, { mode, flag: "wx" });
        await rename(temp, item.path);
      } finally { await rm(temp, { force: true }); }
    }
  }
  return { mode: options.write ? "write" : "preview", changes: planned.map(({ path, action }) => ({ path, action, written: !!options.write })), notes: ["Backup files and empty directories are retained. Restart clients after restoring."] };
}

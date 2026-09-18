import { chmod, mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

export const PACKAGE_ROOT = resolve(import.meta.dir, "..");
export const CLI_PATH = join(PACKAGE_ROOT, "src/cli.ts");
export const stateDirectory = () => process.env.CODECAINE_PROMPTS_STATE_DIR || join(homedir(), ".local", "state", "codecaine-prompts");
export interface DaemonState { url: string; token: string; pid: number; packageRoot: string; startedAt: string }

export async function readDaemonState(): Promise<DaemonState | null> {
  try { return JSON.parse(await readFile(join(stateDirectory(), "daemon.json"), "utf8")); } catch { return null; }
}
export async function writeDaemonState(state: DaemonState) {
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });
  const path = join(stateDirectory(), "daemon.json");
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}
export async function daemonFetch(state: DaemonState, pathname: string, body?: unknown) {
  const url = new URL(state.url);
  if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("Invalid local service address");
  return Bun.fetch(new URL(pathname, state.url), {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
export async function daemonHealthy(state: DaemonState | null): Promise<boolean> {
  if (!state) return false;
  try {
    const url = new URL(state.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return false;
    const response = await Bun.fetch(`${state.url}/health`, { headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(1000) });
    const body = await response.json() as any;
    return response.ok && body.service === "codecaine-prompts" && body.pid === state.pid;
  } catch { return false; }
}
function assertOwner(state: DaemonState) {
  if (state.packageRoot !== PACKAGE_ROOT) throw new Error("Another Prompt Kit checkout owns the service. Run its stop command before switching installations.");
}
export async function ensureDaemon(): Promise<DaemonState> {
  let state = await readDaemonState();
  if (await daemonHealthy(state)) { assertOwner(state!); return state!; }
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });
  const lock = join(stateDirectory(), "startup.lock");
  for (let attempt = 0; attempt < 100; attempt++) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try { handle = await open(lock, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      state = await readDaemonState();
      if (await daemonHealthy(state)) { assertOwner(state!); return state!; }
      const age = Date.now() - (await stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      if (age > 30_000) await unlink(lock).catch(() => {});
      await Bun.sleep(100); continue;
    }
    try {
      state = await readDaemonState();
      if (await daemonHealthy(state)) { assertOwner(state!); return state!; }
      const log = await open(join(stateDirectory(), "service.log"), "a", 0o600);
      const child = spawn(process.execPath, [CLI_PATH, "daemon"], { cwd: PACKAGE_ROOT, detached: true, stdio: ["ignore", log.fd, log.fd], env: process.env });
      child.unref(); await log.close();
      for (let n = 0; n < 100; n++) {
        await Bun.sleep(100); state = await readDaemonState();
        if (await daemonHealthy(state)) { assertOwner(state!); return state!; }
      }
      throw new Error(`Prompt service did not start. Inspect ${join(stateDirectory(), "service.log")}`);
    } finally { await handle.close(); await unlink(lock).catch(() => {}); }
  }
  throw new Error("Timed out waiting for Prompt service startup");
}
export async function stopDaemon() {
  const state = await readDaemonState();
  if (!await daemonHealthy(state)) return { stopped: false, reason: "not running" };
  assertOwner(state!);
  return daemonFetch(state!, "/shutdown", {}).then(response => response.json());
}
export async function implementationFingerprint() {
  const { runtimeHash } = await import("./snapshot");
  return runtimeHash();
}

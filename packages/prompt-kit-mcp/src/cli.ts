#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runDaemon } from "./daemon";
import { doctorClients, installClients, restoreInstallation } from "./install";
import { daemonFetch, daemonHealthy, ensureDaemon, PACKAGE_ROOT, readDaemonState, stateDirectory, stopDaemon } from "./lifecycle";
import { startMcp } from "./mcp";
import { createInteractionService } from "./service";
import { loadGuidance, generateSkillReferences } from "./guidance";
import { createDevelopmentSnapshot } from "./snapshot";

const args = process.argv.slice(2);
const command = args.shift() ?? "help";
function option(name: string, fallback?: string) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; }
const workspace = resolve(option("--workspace", process.env.CLAUDE_PROJECT_DIR || process.cwd())!);
const out = (value: unknown) => console.log(JSON.stringify(value, null, 2));
try {
  switch (command) {
    case "mcp": await startMcp(workspace); break;
    case "daemon": await runDaemon(); break;
    case "start": { const state = await ensureDaemon(); out({ url: state.url, pid: state.pid, stateDirectory: stateDirectory() }); break; }
    case "stop": out(await stopDaemon()); break;
    case "status": { const state = await readDaemonState(); out({ running: await daemonHealthy(state), url: state?.url, pid: state?.pid, packageRoot: state?.packageRoot, stateDirectory: stateDirectory() }); break; }
    case "discover": case "call": case "tools": {
      const state = await ensureDaemon();
      const name = command === "discover" ? "prompts_discover" : args[0];
      const response = command === "tools" ? await daemonFetch(state, "/tools") : await daemonFetch(state, "/rpc", { workspace, name, arguments: command === "discover" ? {} : JSON.parse(option("--args", "{}")!) });
      const result = await response.json(); out(result); if (!response.ok || (result as any).isError) process.exitCode = 1; break;
    }
    case "install": {
      const clients = option("--clients")?.split(",") as ("codex" | "claude" | "pi")[] | undefined;
      if (clients?.some(client => !["codex", "claude", "pi"].includes(client))) throw new Error("Clients must be codex,claude,pi");
      out(await installClients({ clients, write: args.includes("--write"), homeDir: option("--home") })); break;
    }
    case "restore": { const file = args[0]; if (!file) throw new Error("Provide a saved installation report"); out(await restoreInstallation(await Bun.file(file).json(), { write: args.includes("--write") })); break; }
    case "doctor": { const report = await doctorClients({ homeDir: option("--home") }); out(report); if (!report.ok) process.exitCode = 1; break; }
    case "snapshot": {
      const destination = resolve(option("--out", join(PACKAGE_ROOT, "artifacts", "snapshot.json"))!);
      const snapshot = await createDevelopmentSnapshot(createInteractionService().listTools());
      await mkdir(resolve(destination, ".."), { recursive: true }); await writeFile(destination, JSON.stringify(snapshot, null, 2) + "\n");
      out({ path: destination, snapshot: snapshot.snapshotId }); break;
    }
    case "guidance": {
      const profile = option("--profile") as "agent" | "single-output" | "generic" | undefined;
      const snapshot = await loadGuidance({ profile });
      if (args.includes("--write")) await generateSkillReferences(join(PACKAGE_ROOT, "skills", "codecaine-prompts"), snapshot);
      out({ snapshotId: snapshot.snapshotId, profile: snapshot.profile, sources: snapshot.sources }); break;
    }
    default: console.log(`Codecaine Prompts\n\n  install [--write] [--clients codex,claude,pi]  Install connection and skills (preview by default)\n  restore REPORT [--write]                  Restore a saved installation report\n  doctor                                    Check installed bindings\n  mcp [--workspace PATH]                    Start stdio MCP bridge\n  discover [--workspace PATH]               List prompt projects\n  tools                                     List typed tools\n  call TOOL --args JSON [--workspace PATH]  Invoke a tool for testing\n  guidance [--profile PROFILE] [--write]    Inspect/regenerate skill references\n  snapshot [--out FILE]                     Record development snapshot\n  start | status | stop                     Control the shared local service`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }

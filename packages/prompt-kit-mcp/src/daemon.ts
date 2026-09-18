import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server as NetServer } from "node:net";
import { mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInteractionService } from "./service";
import { implementationFingerprint, PACKAGE_ROOT, stateDirectory, writeDaemonState } from "./lifecycle";

/** One deterministic kernel-owned TCP port is the singleton lease for a canonical state directory. */
export function daemonLeasePort(canonicalStateDirectory: string): number {
  const word = createHash("sha256").update(canonicalStateDirectory).digest().readUInt32BE(0);
  return 20_000 + word % 20_000;
}

async function acquireDaemonLease(): Promise<NetServer> {
  const canonical = await realpath(stateDirectory());
  const port = daemonLeasePort(canonical);
  const lease = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    const failed = (error: NodeJS.ErrnoException) => {
      lease.removeListener("listening", ready);
      reject(error.code === "EADDRINUSE"
        ? new Error(`A Prompt service already owns this state directory (singleton lease ${port}). Use start or mcp to connect.`)
        : error);
    };
    const ready = () => { lease.removeListener("error", failed); resolve(); };
    lease.once("error", failed);
    lease.once("listening", ready);
    lease.listen({ host: "127.0.0.1", port, exclusive: true });
  });
  return lease;
}

async function releaseDaemonLease(lease: NetServer) {
  if (!lease.listening) return;
  await new Promise<void>((resolve, reject) => lease.close(error => error ? reject(error) : resolve()));
}

export async function runDaemon() {
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });
  const lockPath = join(stateDirectory(), "daemon.lock");
  const lease = await acquireDaemonLease();
  let server: ReturnType<typeof Bun.serve> | undefined;
  let closing = false;
  try {
    // This file is diagnostic metadata only. The bound TCP lease is the authority.
    await writeFile(lockPath, String(process.pid), { mode: 0o600 });
    const token = randomBytes(32).toString("hex");
    const fingerprint = await implementationFingerprint();
    const service = createInteractionService();
    const startedAt = new Date().toISOString();
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 120, async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || (request.headers.get("origin") && request.headers.get("origin") !== url.origin)) return new Response("Forbidden origin", { status: 403 });
    if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("Unauthorized", { status: 401 });
    try {
      if (url.pathname === "/health") return Response.json({ service: "codecaine-prompts", pid: process.pid, startedAt, packageRoot: PACKAGE_ROOT, fingerprint, ...service.stats() });
      if (url.pathname === "/shutdown" && request.method === "POST") { setTimeout(() => { void shutdown(); }, 100); return Response.json({ stopped: true }); }
      if (url.pathname === "/tools" && request.method === "GET") return Response.json({ tools: service.listTools() });
      if (url.pathname === "/rpc" && request.method === "POST") {
        const body = await request.json() as any;
        if (typeof body.workspace !== "string" || typeof body.name !== "string") return Response.json({ error: "workspace and name required" }, { status: 400 });
        return Response.json(await service.call(body.workspace, body.name, body.arguments ?? {}));
      }
      return new Response("Not found", { status: 404 });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
    }});
    await writeDaemonState({ url: `http://127.0.0.1:${server.port}`, token, pid: process.pid, packageRoot: PACKAGE_ROOT, startedAt });
    console.error(`Codecaine Prompt service listening at http://127.0.0.1:${server.port}`);
    async function shutdown() {
      if (closing) return; closing = true; server?.stop(true);
      await unlink(join(stateDirectory(), "daemon.json")).catch(() => {});
      await releaseDaemonLease(lease).catch(() => {});
      await unlink(lockPath).catch(() => {});
      process.exit(0);
    }
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGINT", () => void shutdown());
    return server;
  } catch (error) {
    server?.stop(true);
    await releaseDaemonLease(lease).catch(() => {});
    await unlink(lockPath).catch(() => {});
    throw error;
  }
}

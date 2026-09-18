import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_PATH, daemonFetch, daemonHealthy, PACKAGE_ROOT, stopDaemon } from "./lifecycle";

const previousStateDir = process.env.CODECAINE_PROMPTS_STATE_DIR;
afterEach(() => {
  if (previousStateDir === undefined) delete process.env.CODECAINE_PROMPTS_STATE_DIR;
  else process.env.CODECAINE_PROMPTS_STATE_DIR = previousStateDir;
});

describe("daemon lifecycle safety", () => {
  test("never fetches or sends a token to a non-loopback state URL", async () => {
    const state = { url: "https://example.com/", token: "secret", pid: 1, packageRoot: PACKAGE_ROOT, startedAt: "now" };
    expect(await daemonHealthy(state)).toBe(false);
    await expect(daemonFetch(state, "/health")).rejects.toThrow("Invalid local service address");
  });

  test("stop refuses a healthy daemon owned by another checkout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prompt-lifecycle-"));
    process.env.CODECAINE_PROMPTS_STATE_DIR = dir;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      if (new URL(request.url).pathname === "/health") return Response.json({ service: "codecaine-prompts", pid: 123 });
      throw new Error("shutdown must not run");
    }});
    const state = { url: `http://127.0.0.1:${server.port}`, token: "secret", pid: 123, packageRoot: "/other/checkout", startedAt: "now" };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "daemon.json"), JSON.stringify(state));
    try { await expect(stopDaemon()).rejects.toThrow("Another Prompt Kit checkout owns"); }
    finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
  });

  test("stale PID metadata cannot block startup or permit a competing daemon", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prompt-daemon-start-"));
    const env = { ...process.env, CODECAINE_PROMPTS_STATE_DIR: dir } as Record<string, string>;
    const start = () => Bun.spawn([process.execPath, CLI_PATH, "start"], { cwd: PACKAGE_ROOT, env, stdout: "pipe", stderr: "pipe" });
    try {
      await writeFile(join(dir, "daemon.lock"), "999999");
      const [first, second] = await Promise.all([start(), start()]);
      const [firstText, secondText] = await Promise.all([new Response(first.stdout).text(), new Response(second.stdout).text()]);
      expect(await first.exited).toBe(0); expect(await second.exited).toBe(0);
      const owners = [JSON.parse(firstText).pid, JSON.parse(secondText).pid];
      expect(owners[0]).toBe(owners[1]);
      const state = JSON.parse(await readFile(join(dir, "daemon.json"), "utf8"));
      expect(state.pid).toBe(owners[0]); expect(state.packageRoot).toBe(PACKAGE_ROOT);
      const contender = Bun.spawn([process.execPath, CLI_PATH, "daemon"], { cwd: PACKAGE_ROOT, env, stdout: "pipe", stderr: "pipe" });
      const contenderError = await new Response(contender.stderr).text();
      expect(await contender.exited).not.toBe(0);
      expect(contenderError).toContain("already owns this state directory");
      expect(JSON.parse(await readFile(join(dir, "daemon.json"), "utf8")).pid).toBe(owners[0]);
    } finally {
      const stop = Bun.spawn([process.execPath, CLI_PATH, "stop"], { cwd: PACKAGE_ROOT, env, stdout: "pipe", stderr: "pipe" });
      await stop.exited; await Bun.sleep(150); await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

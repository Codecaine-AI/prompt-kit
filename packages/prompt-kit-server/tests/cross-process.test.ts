import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hashPrompt, type PromptDocument } from "@codecaine-ai/prompt-kit";

test("independent writers with different project roots share a canonical-file lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-cross-process-"));
  const nested = join(root, "catalog", "agent");
  await mkdir(nested, { recursive: true });
  const before: PromptDocument = { kind: "prompt", schemaVersion: "prompt-kit/v1", id: "concurrency", nodes: [{ type: "paragraph", id: "p", content: ["before"] }] };
  await writeFile(join(nested, "prompt.json"), JSON.stringify(before));
  const moduleUrl = pathToFileURL(resolve(import.meta.dir, "../src/store.ts")).href;
  const children: Bun.Subprocess<"ignore", "pipe", "pipe">[] = [];
  try {
    const source = `import { createPromptStore } from ${JSON.stringify(moduleUrl)};
      const [root, path, text, hash] = process.argv.slice(2);
      const result = await createPromptStore({root}).save({promptPath:path}, {
        expectedHash:hash,
        document:{kind:'prompt',schemaVersion:'prompt-kit/v1',id:'concurrency',nodes:[{type:'paragraph',id:'p',content:[text]}]},
        validate:async()=>{await Bun.sleep(150);return {ok:true};}
      });
      console.log(JSON.stringify(result));`;
    const script = join(root, "writer.ts");
    await writeFile(script, source);
    for (const [projectRoot, promptPath, text] of [[root, "catalog/agent/prompt.json", "external"], [nested, "prompt.json", "kernel"]]) {
      children.push(Bun.spawn([process.execPath, script, projectRoot!, promptPath!, text!, hashPrompt(before)], { stdin: "ignore", stdout: "pipe", stderr: "pipe" }));
    }
    const results = await Promise.all(children.map(async child => {
      const output = await new Response(child.stdout as ReadableStream<Uint8Array>).text();
      const errors = await new Response(child.stderr as ReadableStream<Uint8Array>).text();
      expect(await child.exited, errors).toBe(0);
      return JSON.parse(output);
    }));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    const loser = results.find(result => !result.ok);
    const winner = results.find(result => result.ok);
    expect(loser.code).toBe("conflict");
    expect(loser.currentHash).toBe(winner.hash);
    const onDisk = JSON.parse(await readFile(join(nested, "prompt.json"), "utf8"));
    expect(onDisk).toEqual(winner.document);
    expect(hashPrompt(onDisk)).toBe(winner.hash);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(child => child.exited));
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

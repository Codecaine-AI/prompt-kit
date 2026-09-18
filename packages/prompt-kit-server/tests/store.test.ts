import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";

import {
  canonicalizePrompt,
  hashPrompt,
  type PromptDocument,
} from "@codecaine-ai/prompt-kit";
import { createPromptStore, RENDERED_PROMPT_HEADER } from "../src";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function doc(text: string, withId = true): PromptDocument {
  return {
    kind: "prompt",
    schemaVersion: "prompt-kit/v1",
    id: "agent",
    nodes: [{ type: "paragraph", ...(withId ? { id: "intro" } : {}), content: [text] }],
  };
}

async function fixture(initial = doc("before")) {
  const root = await mkdtemp(join(tmpdir(), "prompt-store-test-"));
  roots.push(root);
  await writeFile(join(root, "prompt.json"), canonicalizePrompt(initial));
  return {
    root,
    target: { promptPath: "prompt.json", declaredVariables: [] as string[] },
    store: createPromptStore({ root, lockTimeoutMs: 2_000 }),
  };
}

describe("filesystem prompt store", () => {
  test("read normalizes in memory without mutating disk and derives flat render path", async () => {
    const f = await fixture(doc("read only", false));
    const before = await readFile(join(f.root, "prompt.json"), "utf8");
    const result = await f.store.read(f.target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes[0]?.id).toBe("node-paragraph-1");
    expect(result.renderedPath).toBe("prompt.rendered.md");
    expect(await readFile(join(f.root, "prompt.json"), "utf8")).toBe(before);
    expect(await readdir(f.root)).toEqual(["prompt.json"]);
  });


  test("applyOps compiles against the locked fresh revision", async () => {
    const f = await fixture();
    const applied = await f.store.applyOps(f.target, {
      expectedHash: hashPrompt(doc("before")),
      ops: [{ op: "update_node", nodeId: "intro", patch: { content: ["edited"] } }],
      source: "mcp:test",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.changedIds).toEqual(["intro"]);
    expect(applied.rendered).toBe("edited");
    expect(JSON.parse(await readFile(join(f.root, "prompt.json"), "utf8"))).toEqual(doc("edited"));
  });


  test("returns the exact canonical roundtrip and validates hyphenated variables", async () => {
    const f = await fixture();
    const input = {
      ...doc("hello {{user-name}}"),
      unknownEnvelope: "drop me",
      nodes: [{ ...doc("x").nodes[0], content: ["hello {{user-name}}"], unknownNode: true }],
    } as unknown as PromptDocument;
    const saved = await f.store.save(
      { promptPath: "prompt.json", declaredVariables: ["user-name"] },
      { document: input, expectedHash: hashPrompt(doc("before")) },
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const disk = JSON.parse(await readFile(join(f.root, "prompt.json"), "utf8"));
    expect(saved.document).toEqual(disk);
    expect(disk.unknownEnvelope).toBeUndefined();
    expect(disk.nodes[0].unknownNode).toBeUndefined();
  });


  test("uses mutation-time declarations instead of a stale target snapshot", async () => {
    const f = await fixture();
    const target = { promptPath: "prompt.json", declaredVariables: [] };
    const accepted = await f.store.save(target, {
      document: doc("hello {{new-name}}"),
      expectedHash: hashPrompt(doc("before")),
      validate: () => ({ ok: true, declaredVariables: ["new-name"] }),
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const rejected = await f.store.save(target, {
      document: doc("hello {{still-missing}}"),
      expectedHash: accepted.hash,
      validate: () => ({ ok: true, declaredVariables: ["new-name"] }),
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.detail).toContain("still-missing");
  });


  test("a host validator cannot bypass target variable declarations", async () => {
    const f = await fixture();
    const target = { promptPath: "prompt.json", declaredVariables: [] };
    const raw = await f.store.save(target, {
      document: doc("{{missing-name}}"),
      expectedHash: hashPrompt(doc("before")),
      validate: () => ({ ok: true }),
    });
    expect(raw.ok).toBe(false);
    if (!raw.ok) expect(raw.detail).toContain("missing-name");

    const structured: PromptDocument = {
      ...doc("ignored"),
      nodes: [{ type: "paragraph", id: "intro", content: [{ type: "variable", name: "missing-name" }] }],
    };
    const node = await f.store.save(target, {
      document: structured,
      expectedHash: hashPrompt(doc("before")),
      validate: () => ({ ok: true }),
    });
    expect(node.ok).toBe(false);
    if (!node.ok) expect(node.detail).toContain("unknown_variable");
  });

  test("reads validated latest provenance for the current revision", async () => {
    const f = await fixture();
    const saved = await f.store.save(f.target, {
      document: doc("provenance"),
      expectedHash: hashPrompt(doc("before")),
      source: "prompt-kit-mcp",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const latest = await f.store.readLatestChange(f.target, saved.hash);
    expect(latest).toEqual({
      ok: true,
      change: { changeId: saved.changeId, afterHash: saved.hash, source: "prompt-kit-mcp" },
    });
  });


  test("latest provenance survives a later render-path configuration change", async () => {
    const f = await fixture();
    const saved = await f.store.save(f.target, {
      document: doc("moved render"),
      expectedHash: hashPrompt(doc("before")),
      source: "prompt-kit-mcp",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const latest = await f.store.readLatestChange(
      { ...f.target, renderedPath: "generated/system.md" },
      saved.hash,
    );
    expect(latest.ok).toBe(true);
    if (latest.ok) expect(latest.change?.changeId).toBe(saved.changeId);
  });

  test("concurrent saves with one expected hash produce one winner and one conflict", async () => {
    const f = await fixture();
    const current = hashPrompt(doc("before"));
    const [a, b] = await Promise.all([
      f.store.save(f.target, { document: doc("alpha"), expectedHash: current, source: "a" }),
      createPromptStore({ root: f.root }).save(f.target, {
        document: doc("beta"),
        expectedHash: current,
        source: "b",
      }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const loser = a.ok ? b : a;
    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.code).toBe("conflict");
  });

  test("rejects stale saves, malformed documents, and undeclared raw variables", async () => {
    const f = await fixture();
    const stale = await f.store.save(f.target, {
      document: doc("next"),
      expectedHash: "pk1-stale",
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("conflict");

    const invalid = await f.store.save(f.target, {
      document: { ...doc("bad"), nodes: [{ type: "wat" }] } as unknown as PromptDocument,
      expectedHash: hashPrompt(doc("before")),
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe("invalid_document");

    const variable = await f.store.save(f.target, {
      document: doc("hello {{missing}}"),
      expectedHash: hashPrompt(doc("before")),
    });
    expect(variable.ok).toBe(false);
    if (!variable.ok) expect(variable.detail).toContain("undeclared variable");
  });

  test("reports a canonical commit when render fails and the next mutation recovers it", async () => {
    const f = await fixture();
    let fail = true;
    const broken = createPromptStore({
      root: f.root,
      failAfterCanonicalCommit: () => {
        if (fail) {
          fail = false;
          throw new Error("injected derived failure");
        }
      },
    });
    const attempted = await broken.save(f.target, {
      document: doc("committed"),
      expectedHash: hashPrompt(doc("before")),
    });
    expect(attempted.ok).toBe(false);
    if (!attempted.ok) expect(attempted.committed).toBe(true);
    expect(JSON.parse(await readFile(join(f.root, "prompt.json"), "utf8"))).toEqual(doc("committed"));

    const current = hashPrompt(doc("committed"));
    const recovered = await createPromptStore({ root: f.root }).save(f.target, {
      document: doc("after recovery"),
      expectedHash: current,
    });
    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(recovered.recovered).toBe(true);
    const rendered = await readFile(join(f.root, "prompt.rendered.md"), "utf8");
    expect(rendered).toBe(`${RENDERED_PROMPT_HEADER}after recovery\n`);
  });


  test("recovers an interrupted journal after its prompt directory is relocated", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-store-move-"));
    roots.push(root);
    await mkdir(join(root, "old"));
    await writeFile(join(root, "old", "prompt.json"), canonicalizePrompt(doc("before")));
    const target = { promptPath: "old/prompt.json", declaredVariables: [] };
    const failed = await createPromptStore({
      root,
      failAfterCanonicalCommit: () => { throw new Error("stop after canonical"); },
    }).save(target, {
      document: doc("committed before move"),
      expectedHash: hashPrompt(doc("before")),
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.committed).toBe(true);
    await rename(join(root, "old"), join(root, "moved"));

    const afterMove = await createPromptStore({ root }).save(
      { promptPath: "moved/prompt.json", declaredVariables: [] },
      {
        document: doc("should not commit"),
        expectedHash: hashPrompt(doc("committed before move")),
        validate: () => ({ ok: false, errors: ["stop after recovery"] }),
      },
    );
    expect(afterMove.ok).toBe(false);
    expect(await readFile(join(root, "moved", "prompt.rendered.md"), "utf8")).toBe(
      `${RENDERED_PROMPT_HEADER}committed before move\n`,
    );
  });

  test("undo is revision guarded and scoped to the store root and prompt", async () => {
    const f = await fixture();
    const saved = await f.store.save(f.target, {
      document: doc("one"),
      expectedHash: hashPrompt(doc("before")),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const second = await f.store.save(f.target, {
      document: doc("two"),
      expectedHash: saved.hash,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const guarded = await f.store.undo(f.target, {
      changeId: saved.changeId,
      expectedHash: second.hash,
    });
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.code).toBe("undo_conflict");
    const undone = await f.store.undo(f.target, {
      changeId: second.changeId,
      expectedHash: second.hash,
    });
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.hash).toBe(saved.hash);
  });

  test("confines traversal and symlinks for prompts, renders, and journals", async () => {
    const f = await fixture();
    const traversal = await f.store.read({ promptPath: "../prompt.json" });
    expect(traversal.ok).toBe(false);
    if (!traversal.ok) expect(traversal.code).toBe("invalid_path");

    await mkdir(join(f.root, "outside"));
    await symlink(join(f.root, "outside"), join(f.root, "linked"));
    const linked = await f.store.read({ promptPath: "linked/prompt.json" });
    expect(linked.ok).toBe(false);
    if (!linked.ok) expect(linked.code).toBe("invalid_path");

    await symlink(join(f.root, "outside", "render.md"), join(f.root, "evil.md"));
    const render = await f.store.save(
      { promptPath: "prompt.json", renderedPath: "evil.md" },
      { document: doc("x"), expectedHash: hashPrompt(doc("before")) },
    );
    expect(render.ok).toBe(false);
    if (!render.ok) expect(render.code).toBe("invalid_path");
  });



  test("does not split locks when an unrelated listener releases the prompt port", async () => {
    const f = await fixture();
    const { realpath } = await import("node:fs/promises");
    const promptFile = join(await realpath(f.root), "prompt.json");
    const key = createHash("sha256").update(promptFile).digest("hex");
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    const port = 10_000 + (Number.parseInt(key.slice(0, 8), 16) + uid) % 10_000;
    const blocker = createServer((socket) => socket.destroy());
    await new Promise<void>((resolveListen) => blocker.listen({ host: "127.0.0.1", port }, resolveListen));
    const expectedHash = hashPrompt(doc("before"));
    const writers = ["first", "second"].map((text) =>
      createPromptStore({ root: f.root, lockTimeoutMs: 2_000 }).save(f.target, {
        document: doc(text),
        expectedHash,
      }),
    );
    await Bun.sleep(50);
    await new Promise<void>((resolveClose) => blocker.close(() => resolveClose()));
    const outcomes = await Promise.all(writers);
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    expect(outcomes.filter((result) => !result.ok && result.code === "conflict")).toHaveLength(1);
  });

  test("recovers a stale PID lock safely under multiple contenders", async () => {
    const f = await fixture();
    const { realpath } = await import("node:fs/promises");
    const lockRoot = join(f.root, "locks");
    const promptFile = join(await realpath(f.root), "prompt.json");
    const key = createHash("sha256").update(promptFile).digest("hex");
    const lockDir = join(lockRoot, `${key}.lock`);
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      join(lockDir, "owner.json"),
      JSON.stringify({
        version: 1,
        pid: 2147483647,
        processStartedAt: 0,
        nonce: "dead-owner",
        createdAt: 0,
        promptFile,
      }),
    );
    const expectedHash = hashPrompt(doc("before"));
    const outcomes = await Promise.all(
      ["a", "b", "c"].map((text) =>
        createPromptStore({ root: f.root, lockRoot, lockTimeoutMs: 2_000 }).save(f.target, {
          document: doc(text),
          expectedHash,
        }),
      ),
    );
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    expect(outcomes.filter((result) => !result.ok && result.code === "conflict")).toHaveLength(2);
  });

  test("rejects render overwrite and corrupt undo journals without changing canonical bytes", async () => {
    const f = await fixture();
    const before = await readFile(join(f.root, "prompt.json"), "utf8");
    const overwrite = await f.store.save(
      { promptPath: "prompt.json", renderedPath: "prompt.json" },
      { document: doc("lost"), expectedHash: hashPrompt(doc("before")) },
    );
    expect(overwrite.ok).toBe(false);
    expect(await readFile(join(f.root, "prompt.json"), "utf8")).toBe(before);

    const saved = await f.store.save(f.target, {
      document: doc("saved"),
      expectedHash: hashPrompt(doc("before")),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const journal = join(f.root, ".prompt-kit", "changes", `${saved.changeId}.json`);
    const record = JSON.parse(await readFile(journal, "utf8"));
    record.beforeHash = "pk1-corrupt";
    await writeFile(journal, JSON.stringify(record));
    const undo = await f.store.undo(f.target, {
      changeId: saved.changeId,
      expectedHash: saved.hash,
    });
    expect(undo.ok).toBe(false);
    if (!undo.ok) expect(undo.code).toBe("storage_error");
  });

  test("folder-form prompts derive prompt/system.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-store-folder-"));
    roots.push(root);
    await mkdir(join(root, "prompt"));
    await writeFile(join(root, "prompt", "prompt.json"), canonicalizePrompt(doc("folder")));
    const store = createPromptStore({ root });
    const result = await store.save(
      { promptPath: "prompt/prompt.json", declaredVariables: [] },
      { document: doc("saved"), expectedHash: hashPrompt(doc("folder")) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.renderedPath).toBe("prompt/system.md");
  });
});

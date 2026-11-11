/**
 * The rule-unit manifest of the prompt-kit skill against the served topics, the prompts_capabilities index, the
 * standards gate and the tool list. Every check runs in process on the real guidance, with no network call.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GUIDANCE_PROFILES, GUIDANCE_TOPICS, loadGuidance } from "@codecaine-ai/prompt-kit-server";
import pkg from "../package.json";
import { TOPIC_PART_BYTES, setServedTextHook, topicParts } from "./guidance";
import { PINNED_SHA256, SCENARIOS, SKILL_ROOT, STANDARDS_GATE, guidanceManifest, type ManifestUnit } from "./guidance-manifest";
import { createInteractionService } from "./service";
import { createPromptTools } from "./tools";

const manifest = await guidanceManifest();
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const TOPIC_IDS: readonly string[] = GUIDANCE_TOPICS.map((topic) => topic.id);
/** A file's lines without the empty string after its last newline. */
const fileLines = (text: string) => { const lines = text.split("\n"); return lines.at(-1) === "" ? lines.slice(0, -1) : lines; };

/** SKILL.md and every file under references/, read from disk. */
async function skillFiles(): Promise<Record<string, string>> {
  const files = ["SKILL.md", ...await Array.fromAsync(new Bun.Glob("references/**/*").scan({ cwd: SKILL_ROOT, onlyFiles: true }))].sort();
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(join(SKILL_ROOT, file), "utf8")] as const)));
}

/** Every way the units fail to cover the files: a file with no pin or a changed sha256, a non-blank line in no unit or in two, and a unit whose text is not its lines. */
function lineSpanFindings(files: Record<string, string>, units: readonly ManifestUnit[], pins: Readonly<Record<string, string>>): string[] {
  const findings: string[] = [];
  for (const file of new Set([...Object.keys(files), ...Object.keys(pins)])) {
    const text = files[file];
    if (text === undefined) { findings.push(`${file}: pinned but missing`); continue; }
    if (sha256(text) !== pins[file]) findings.push(`${file}: sha256 ${sha256(text)} is not the pinned ${pins[file] ?? "(none)"}`);
    const lines = fileLines(text);
    const owners = lines.map(() => [] as string[]);
    for (const unit of units.filter((unit) => unit.file === file)) {
      const [first, last] = unit.lines;
      if (first < 1 || last > lines.length || first > last) { findings.push(`${unit.id}: lines ${first}-${last} are outside ${file} (${lines.length} lines)`); continue; }
      for (let line = first; line <= last; line++) owners[line - 1]!.push(unit.id);
      if (unit.text !== lines.slice(first - 1, last).join("\n")) findings.push(`${unit.id}: text differs from ${file}:${first}-${last}`);
    }
    lines.forEach((line, index) => {
      if (line.trim() !== "" && owners[index]!.length === 0) findings.push(`${file}:${index + 1} is in no unit`);
      if (owners[index]!.length > 1) findings.push(`${file}:${index + 1} is in ${owners[index]!.join(" and ")}`);
    });
  }
  return findings;
}

describe("coverage", () => {
  test("every unit has a destination topic or a named drop, a scenario, and anchors only where prose proves it", () => {
    const findings = manifest.flatMap((unit) => {
      const destination = unit.destination as Record<string, unknown>;
      const keys = Object.keys(destination).sort().join(",");
      if (keys === "topic") return TOPIC_IDS.includes(destination.topic as string) ? [] : [`${unit.id}: unknown topic ${destination.topic}`];
      if (keys === "drop,reason") return ["instruments", "skill-folder"].includes(destination.drop as string) && String(destination.reason).trim() !== "" ? [] : [`${unit.id}: a drop names instruments or skill-folder and a reason`];
      return [`${unit.id}: destination ${JSON.stringify(destination)} is not a topic or a drop`];
    });
    expect(findings).toEqual([]);
    expect(new Set(manifest.map((unit) => unit.id)).size).toBe(manifest.length);
    expect(manifest.filter((unit) => !(unit.scenario in SCENARIOS)).map((unit) => unit.id)).toEqual([]);
    // Prose is proved by its anchors. A generated unit is proved by its lines, and a skill-folder drop by nothing.
    const anchorless = (unit: ManifestUnit) => unit.kind === "generated" || ("drop" in unit.destination && unit.destination.drop === "skill-folder");
    expect(manifest.filter((unit) => anchorless(unit) !== (unit.anchors.length === 0)).map((unit) => unit.id)).toEqual([]);
    expect(manifest.filter((unit) => unit.kind === "generated" && "drop" in unit.destination).map((unit) => unit.id)).toEqual([]);
  });

  test("every non-blank line of SKILL.md and of each references/ file sits in one unit, and each file keeps its pinned sha256", async () => {
    const files = await skillFiles();
    expect(Object.keys(files).length).toBe(18);
    expect(lineSpanFindings(files, manifest, PINNED_SHA256)).toEqual([]);
  });

  test("the line-span check fails on an uncovered line, a changed file and a file with no pin", async () => {
    const files = await skillFiles();
    const dropped = manifest.find((unit) => unit.id === "skill.rules.voice")!;
    expect(lineSpanFindings(files, manifest.filter((unit) => unit !== dropped), PINNED_SHA256)).toEqual([`SKILL.md:${dropped.lines[0]} is in no unit`]);
    expect(lineSpanFindings({ ...files, "SKILL.md": `${files["SKILL.md"]}\n` }, manifest, PINNED_SHA256)[0]).toStartWith("SKILL.md: sha256 ");
    expect(lineSpanFindings({ ...files, "references/new.md": "# New\n" }, manifest, PINNED_SHA256)).toEqual([
      `references/new.md: sha256 ${sha256("# New\n")} is not the pinned (none)`,
      "references/new.md:1 is in no unit",
    ]);
  });
});

/** A workspace with one catalog prompt, as the contract and gate tests use it. */
async function workspace(names = ["fixture"]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "prompt-capabilities-"));
  await writeFile(join(root, "members.json"), JSON.stringify(names.map((dir) => ({ dir }))));
  for (const name of names) {
    const dir = names.length === 1 ? root : join(root, name);
    await mkdir(join(dir, "catalog", "writer", "prompt"), { recursive: true });
    await writeFile(join(dir, "codecaine.prompts.json"), JSON.stringify({ name, catalogRoots: ["catalog"] }));
    await writeFile(join(dir, "catalog", "writer", "agent.json"), JSON.stringify({ variables: {} }));
    await writeFile(join(dir, "catalog", "writer", "prompt", "prompt.json"), JSON.stringify({ kind: "prompt", schemaVersion: "prompt-kit/v1", id: "writer", nodes: [{ type: "paragraph", id: "body", content: ["Before."] }] }));
  }
  return root;
}
type Service = ReturnType<typeof createInteractionService>;
const callIn = (service: Service, root: string) => async (name: string, args: Record<string, unknown> = {}) => (await service.call(root, name, args)).structuredContent as Record<string, any>;

/** A served line in the form the skill file holds it: no indent, and a catalog title without its link to the skill folder. */
const servedForm = (line: string) => line.trim().replace(/\[([^\]]+)\]\(details\/[^)]+\.md\)/g, "$1");
/** The tools in tools/list, and the text prompts_apply_ops gets before the standards read. */
type Observed = { tools: ReadonlySet<string>; refusal: string };
const occurrences = (text: string, phrase: string) => text.split(phrase).length - 1;

/** Every way the served topic fails to keep a unit. */
function contractFindings(unit: ManifestUnit, served: string, observed: Observed): string[] {
  const findings: string[] = [];
  if (unit.kind === "generated") {
    const lines = new Set(served.split("\n").map(servedForm));
    const missing = unit.text.split("\n").filter((line) => line.trim() !== "" && !lines.has(servedForm(line)));
    if (missing.length) findings.push(`${unit.id}: the served topic lacks ${missing.length} lines, first "${missing[0]!.trim()}"`);
  }
  for (const anchor of unit.anchors) {
    const count = occurrences(served, anchor);
    if (count !== 1) findings.push(`${unit.id}: the served topic holds "${anchor}" ${count} times, not once`);
  }
  for (const tool of unit.behavior?.tools ?? []) {
    if (!observed.tools.has(tool)) findings.push(`${unit.id}: ${tool} is not in tools/list`);
    if (!served.includes(tool)) findings.push(`${unit.id}: the served topic does not name ${tool}`);
  }
  if (unit.behavior?.refusal !== undefined && unit.behavior.refusal !== observed.refusal) findings.push(`${unit.id}: prompts_apply_ops is refused with "${observed.refusal}"`);
  return findings;
}

/** The test hook body: each served part without the unit's lines and anchor phrases. */
const strip = (unit: ManifestUnit) => (text: string) => {
  const lines = new Set(unit.text.split("\n").filter((line) => line.trim() !== "").map(servedForm));
  let out = text.split("\n").filter((line) => !lines.has(servedForm(line))).join("\n");
  for (const anchor of unit.anchors) out = out.replaceAll(anchor, "");
  return out;
};

describe("manifest contract", () => {
  let service: Service;
  let root: string;
  let observed: Observed;
  const tasks = new Map<string, string>();
  /** Every part of the unit's topic, read through prompts_guidance with a task on the unit's profile. A drop has none here. */
  async function servedFor(unit: ManifestUnit): Promise<string | undefined> {
    if (!("topic" in unit.destination)) return undefined;
    const call = callIn(service, root);
    const task_id = tasks.get(unit.profile ?? "generic")!;
    const first = await call("prompts_guidance", { task_id, topic: unit.destination.topic });
    const parts = [first.guidance as string];
    for (let part = 2; part <= first.parts; part++) parts.push((await call("prompts_guidance", { task_id, topic: unit.destination.topic, part })).guidance);
    return parts.join("\n");
  }
  beforeAll(async () => {
    root = await workspace();
    service = createInteractionService();
    const call = callIn(service, root);
    const project = (await call("prompts_capabilities")).projects[0].id;
    for (const profile of GUIDANCE_PROFILES) tasks.set(profile, (await call("prompts_begin", { project, profile })).task_id);
    // An edit in a fresh task that has not read topic standards records the refusal text.
    const fresh = (await call("prompts_begin", { project })).task_id;
    const read = await call("prompts_read", { project, prompt_id: "writer" });
    const refused = await call("prompts_apply_ops", { project, prompt_id: "writer", task_id: fresh, expected_hash: read.hash, ops: [{ op: "update_node", nodeId: "body", patch: { content: ["Refused."] } }] });
    observed = { tools: new Set(service.listTools().map((tool) => tool.name)), refusal: refused.detail };
  });
  afterAll(async () => { setServedTextHook(); service.close(); await rm(root, { recursive: true, force: true }); });

  test("each unit's served topic keeps its lines or each anchor once, and its recorded behavior, with no network call", async () => {
    const findings: string[] = [];
    for (const unit of manifest) {
      const served = await servedFor(unit);
      if (served !== undefined) findings.push(...contractFindings(unit, served, observed));
    }
    expect(findings).toEqual([]);
    expect(observed.refusal).toBe(STANDARDS_GATE);
  });

  test("stripping one unit from the served topic fails that unit's contract, and the manifest stays unchanged", async () => {
    const before = JSON.stringify(manifest);
    const survivors: string[] = [];
    try {
      for (const unit of manifest.filter((unit) => "topic" in unit.destination)) {
        setServedTextHook(strip(unit));
        if (contractFindings(unit, (await servedFor(unit))!, observed).length === 0) survivors.push(unit.id);
      }
    } finally { setServedTextHook(); }
    expect(survivors).toEqual([]);
    expect(JSON.stringify(manifest)).toBe(before);
    expect(JSON.stringify(await guidanceManifest())).toBe(before);
  });
});

describe("topics", () => {
  test("each topic serves its sources in parts of at most 24,576 bytes, and no line is lost", async () => {
    for (const profile of GUIDANCE_PROFILES) {
      const snapshot = await loadGuidance({ profile });
      expect(snapshot.topics.map((topic): string => topic.id)).toEqual([...TOPIC_IDS]);
      for (const topic of snapshot.topics) {
        const parts = topicParts(topic);
        for (const part of parts) {
          expect(Buffer.byteLength(part)).toBeLessThanOrEqual(TOPIC_PART_BYTES);
          expect(part).toStartWith(`# ${topic.title}\n\n`);
        }
        const served = new Set(parts.join("\n").split("\n"));
        expect(topic.text.split("\n").filter((line) => !served.has(line))).toEqual([]);
      }
    }
    // The agent standards topic is the one that needs two parts.
    expect(topicParts((await loadGuidance({ profile: "agent" })).topics[0]!).length).toBe(2);
    expect(topicParts((await loadGuidance()).topics[0]!).length).toBe(1);
  });
});

const INDEX_FIELDS = ["ok", "protocol_version", "server_version", "tool_contract_hash", "guidance_snapshot", "scope", "guidance_tool", "entry_tool",
  "completion_tools", "operations", "topics", "discovery_tools", "projects", "warnings", "next_cursor"];
const TEN_TOOLS = ["prompts_capabilities", "prompts_discover", "prompts_begin", "prompts_guidance", "prompts_read", "prompts_apply_ops", "prompts_undo",
  "prompts_requests", "prompts_request_reply", "prompts_check"];

describe("prompts_capabilities", () => {
  let service: Service;
  let root: string;
  beforeAll(async () => { service = createInteractionService(); root = await workspace(["alpha", "beta"]); });
  afterAll(async () => { service.close(); await rm(root, { recursive: true, force: true }); });

  test("returns the index fields in 4,096 bytes or less, each topic with its size, parts and gate, and the workspace projects", async () => {
    const result = await service.call(tmpdir(), "prompts_capabilities", { workspace: root });
    expect(Buffer.byteLength(result.content[0]!.text)).toBeLessThanOrEqual(4096);
    const index = result.structuredContent as Record<string, any>;
    expect(Object.keys(index)).toEqual(INDEX_FIELDS);
    const found = await service.discover(root);
    expect(index).toMatchObject({
      protocol_version: "1", server_version: pkg.version, guidance_snapshot: (await loadGuidance()).snapshotId, scope: { workspace: found.workspace },
      guidance_tool: "prompts_guidance", entry_tool: "prompts_begin", completion_tools: ["prompts_check"], warnings: [], next_cursor: null,
      discovery_tools: [{ name: "prompts_discover", purpose: "List the 2 prompts of the 2 projects in this workspace, with discovery errors. Pass project for one project." }],
    });
    expect(index.tool_contract_hash).toBe(`sha256:${sha256(JSON.stringify(service.listTools()))}`);
    const names = service.listTools().map((tool) => tool.name);
    expect(index.operations.filter((name: string) => !names.includes(name))).toEqual([]);
    expect(index.projects).toEqual(found.projects.map((project) => ({ id: project.id, name: project.name, prompts: 1 })));
    expect(index.topics.map((topic: any) => topic.id)).toEqual([...TOPIC_IDS]);
    // Each topic's size is its served size for the largest profile, all parts included.
    for (const topic of index.topics) {
      const sizes = await Promise.all(GUIDANCE_PROFILES.map(async (profile) => topicParts((await loadGuidance({ profile })).topics.find((entry) => entry.id === topic.id)!)));
      expect(topic.bytes, topic.id).toBe(Math.max(...sizes.map((parts) => parts.reduce((sum, part) => sum + Buffer.byteLength(part), 0))));
      expect(topic.parts, topic.id).toBe(Math.max(...sizes.map((parts) => parts.length)));
    }
    expect(index.topics.map((topic: any) => [topic.id, topic.required_for])).toEqual(TOPIC_IDS.map((id) => [id, id === "standards" ? ["prompts_apply_ops"] : []]));
  });

  test("a workspace with many projects pages the index, a changed project list refuses an old cursor, and an unchanged rescan keeps it", async () => {
    const many = await workspace(Array.from({ length: 60 }, (_, i) => `project-with-a-longer-name-${String(i).padStart(2, "0")}`));
    try {
      const pages: Record<string, any>[] = [];
      let cursor: string | undefined;
      do {
        const result = await service.call(many, "prompts_capabilities", cursor === undefined ? {} : { cursor });
        expect(Buffer.byteLength(result.content[0]!.text)).toBeLessThanOrEqual(4096);
        const index = result.structuredContent as Record<string, any>;
        expect(Object.keys(index)).toEqual(INDEX_FIELDS);
        pages.push(index);
        cursor = index.next_cursor ?? undefined;
      } while (cursor !== undefined);
      expect(pages.length).toBeGreaterThan(1);
      expect(pages.flatMap((index) => index.topics).map((topic: any) => topic.id)).toEqual([...TOPIC_IDS]);
      expect(pages.flatMap((index) => index.projects).map((project: any) => project.id)).toEqual((await service.discover(many)).projects.map((project) => project.id));
      // Every call rescans. The same project list keeps the cursor of the first page valid.
      const second = pages[0]!.next_cursor as string;
      expect((await service.call(many, "prompts_capabilities", {})).structuredContent.next_cursor).toBe(second);
      expect((await service.call(many, "prompts_capabilities", { cursor: second })).isError).toBeUndefined();
      // A new project changes the list, so the old cursor is refused and a first page starts over.
      const extra = join(many, "project-new");
      await mkdir(join(extra, "catalog", "writer", "prompt"), { recursive: true });
      await writeFile(join(extra, "codecaine.prompts.json"), JSON.stringify({ name: "project-new", catalogRoots: ["catalog"] }));
      await writeFile(join(extra, "catalog", "writer", "agent.json"), JSON.stringify({ variables: {} }));
      await writeFile(join(extra, "catalog", "writer", "prompt", "prompt.json"), await readFile(join(many, "project-with-a-longer-name-00", "catalog", "writer", "prompt", "prompt.json"), "utf8"));
      const members = JSON.parse(await readFile(join(many, "members.json"), "utf8"));
      await writeFile(join(many, "members.json"), JSON.stringify([...members, { dir: "project-new" }]));
      const stale = await service.call(many, "prompts_capabilities", { cursor: second });
      expect(stale.structuredContent).toEqual({ ok: false, detail: "The project list changed. Call prompts_capabilities without a cursor for the first page." });
      expect((await service.call(many, "prompts_capabilities", {})).structuredContent.next_cursor).not.toBe(second);
      for (const [args, detail] of [
        [{ cursor: "-1" }, "Unknown cursor. Call prompts_capabilities without a cursor for the first page."],
        [{ cursor: 5 }, "cursor must be a non-empty string."],
        [{ workspace: false }, "workspace must be a non-empty string."],
        [{ topic: "standards" }, "Unknown argument: topic."],
      ] as const) expect((await service.call(many, "prompts_capabilities", args as Record<string, unknown>)).structuredContent).toEqual({ ok: false, detail });
      // null counts as absent.
      expect((await service.call(many, "prompts_capabilities", { cursor: null, workspace: null })).structuredContent.ok).toBe(true);
    } finally { await rm(many, { recursive: true, force: true }); }
  });

  test("lists 10 tools", () => {
    const tools = createPromptTools({ resolvePrompt: async () => { throw new Error("unused"); } });
    const listed = service.listTools().map((tool) => tool.name);
    expect(listed).toEqual(TEN_TOOLS);
    expect(tools.map((tool) => tool.name).every((name) => listed.includes(name))).toBe(true);
    expect(listed.length - tools.length).toBe(4);
  });
});

describe("the standards gate", () => {
  test("prompts_apply_ops waits for every part of topic standards in the task, and every other tool stays open", async () => {
    const root = await workspace();
    const service = createInteractionService();
    const call = callIn(service, root);
    try {
      const project = (await call("prompts_capabilities")).projects[0].id;
      const target = { project, prompt_id: "writer" };
      // The agent profile serves standards in two parts.
      const task_id = (await call("prompts_begin", { project, profile: "agent" })).task_id;
      const read = await call("prompts_read", target);
      const apply = (expected_hash: string, text: string) => service.call(root, "prompts_apply_ops", { ...target, task_id, expected_hash, ops: [{ op: "update_node", nodeId: "body", patch: { content: [text] } }] });
      const refused = await apply(read.hash, "Gated.");
      expect(refused.isError).toBe(true);
      expect(refused.structuredContent.detail).toBe(STANDARDS_GATE);
      // The reads stay open before the standards read, and so do the other writes.
      expect((await call("prompts_discover", { project })).ok).toBe(true);
      expect((await call("prompts_requests", { ...target, task_id })).ok).toBe(true);
      expect((await call("prompts_check", { ...target, task_id })).hash).toBe(read.hash);
      expect((await call("prompts_guidance", { task_id })).topics[0]).toMatchObject({ id: "standards", parts: 2, required_for: ["prompts_apply_ops"] });
      // Another topic does not open the gate, and neither does one part of two.
      await call("prompts_guidance", { task_id, topic: "workflow" });
      const first = await call("prompts_guidance", { task_id, topic: "standards" });
      expect(first).toMatchObject({ topic: "standards", part: 1, parts: 2, next: "Read part 2 of topic standards: pass part 2." });
      expect((await apply(read.hash, "Gated.")).structuredContent.detail).toBe(`${STANDARDS_GATE} Unread: part 2 of 2.`);
      expect((await call("prompts_guidance", { task_id, topic: "standards", part: 2 })).next).toBeUndefined();
      const saved = await apply(read.hash, "After.");
      expect(saved.isError).toBeUndefined();
      expect(saved.structuredContent.ok).toBe(true);
      // The read belongs to its task: a new task is gated again.
      const other = (await call("prompts_begin", { project })).task_id;
      const again = await service.call(root, "prompts_apply_ops", { ...target, task_id: other, expected_hash: saved.structuredContent.hash, ops: [{ op: "update_node", nodeId: "body", patch: { content: ["Again."] } }] });
      expect(again.structuredContent.detail).toBe(STANDARDS_GATE);
      // A read without task_id records nothing.
      await call("prompts_guidance", { topic: "standards" });
      expect((await service.call(root, "prompts_apply_ops", { ...target, task_id: other, expected_hash: saved.structuredContent.hash, ops: [{ op: "update_node", nodeId: "body", patch: { content: ["Again."] } }] })).structuredContent.detail).toBe(STANDARDS_GATE);
      for (const [args, detail] of [
        [{ task_id: other, topic: "style" }, 'Unknown topic "style". Topics: standards, workflow, operations, work-requests, catalog, editor.'],
        [{ task_id: other, topic: "standards", part: 2 }, "part must be an integer from 1 to 1 for topic standards."],
        [{ task_id: other, topic: "standards", part: "1" }, "part must be an integer from 1 to 1 for topic standards."],
        [{ task_id: other, part: 1 }, "part needs a topic."],
        [{ task_id: other, reference: "quality" }, "Unknown argument: reference."],
      ] as const) expect(await call("prompts_guidance", args as Record<string, unknown>)).toEqual({ ok: false, detail });
      // null counts as absent: the topic list.
      expect((await call("prompts_guidance", { task_id: other, topic: null, part: null })).topics).toHaveLength(6);
    } finally { service.close(); await rm(root, { recursive: true, force: true }); }
  });
});

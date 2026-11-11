/**
 * The rule-unit manifest of the prompt-kit skill, and the Prompt Kit guidance contract. Every non-blank line of
 * SKILL.md and of each file under references/ sits in one unit, and each unit names the served guidance that now
 * carries it: a prompts_guidance topic, or a drop with a reason. capabilities.test.ts pins each file's sha256, checks
 * the line spans, runs each unit's contract against the served topic and strips each unit to prove its contract
 * fails. cli.ts manifest prints the units as JSON for the prose judge. SKILL.md unit text is a frozen literal, and a
 * generated unit reads its lines from the skill folder.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GuidanceProfile, GuidanceTopicId } from "@codecaine-ai/prompt-kit-server";

export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../skills/prompt-kit");

/** The eval scenario that exercises a unit. The gate runners build one task per scenario. */
export const SCENARIOS = {
  "edit-prompt": "Edit one prompt from prompts_capabilities through prompts_check with task_id.",
  "read-only": "Answer a question about a prompt without editing it.",
  "work-requests": "Work through the open requests on a prompt, then close each one.",
  "choose-profile": "Write or restructure a prompt for its agent, single-output or generic profile.",
  "build-ops": "Build an operation batch that inserts, moves and removes nodes.",
  "editor-mapping": "Map an in-app prompt editor request or tool to the MCP tools.",
  "setup-gap": "Report a missing Prompt Kit connection.",
} as const;
export type ScenarioId = keyof typeof SCENARIOS;

/** metadata: skill frontmatter. rule, step, link: hand-written prose. generated: a generated reference file's body. */
export type UnitKind = "metadata" | "rule" | "step" | "link" | "generated";
/**
 * Where the unit is served now. A drop to instruments is allowed only for a unit that routes output to another
 * system, and its anchors are phrases of the instruments skill. A drop to skill-folder is allowed only for a unit that
 * maintains the skill folder itself, which goes away with the folder, and it has no anchors.
 */
export type Destination = { topic: GuidanceTopicId } | { drop: "instruments" | "skill-folder"; reason: string };
/** Recorded behavior gets a structured assertion: each tool is in tools/list and named in the served topic, and a write is refused with this exact text before the read. */
export type Behavior = { tools?: readonly string[]; refusal?: string };
export type ManifestUnit = {
  id: string;
  kind: UnitKind;
  /** Path relative to SKILL_ROOT. */
  file: string;
  /** First and last line, 1-based and inclusive. */
  lines: readonly [number, number];
  /** sha256 of the whole file the unit comes from. */
  sha256: string;
  /** The unit's lines as the file holds them. */
  text: string;
  /** Exact phrases of the served topic that carry the unit's rule, each held by one sentence only. A generated unit and a skill-folder drop have none. */
  anchors: readonly string[];
  scenario: ScenarioId;
  destination: Destination;
  /** The profile of the task whose topic the contract reads. Default generic. */
  profile?: GuidanceProfile;
  behavior?: Behavior;
};
type UnitSpec = Omit<ManifestUnit, "sha256" | "text"> & { text?: string };

/** The sha256 of each file the manifest covers. A changed file fails the line-span test until its units are re-cut and re-pinned. */
export const PINNED_SHA256: Readonly<Record<string, string>> = {
  "SKILL.md": "a047f50614ca0bb6329b6e34c239cbe39d330d0ac3d70d1737b47ccc7766ffa7",
  "references/catalog.md": "fea68803fd0a9893bb19803cbf555142afbc9cccd2dce2201819ba97433369bd",
  "references/standards.md": "20825b624717fb7b1d9bacd122d9b9c8a53a074c4705db46f3ccdf4ebaed4916",
  "references/details/agent-structure.md": "798b085fe34a624fc70cae6c3c7e102c5d34f1932e635bd6da35675087334582",
  "references/details/authoring-model.md": "09c3d2dc416f9ffb9191572463098677f06188316c3e9072c6e98f201f27d1cc",
  "references/details/document-model.md": "3777e82b8444e4308bfc4220579539f2fb0b808dd3c32c209b688954123067cd",
  "references/details/edit-prompts.md": "6027a1cfa6688e583a6825c99a47bff7ebaacb48dadbca36049064d32531c21b",
  "references/details/editing-model.md": "4437d2e2d2d6a471f4218cf6ca2708f1a59e209bd9504b084c65488af6174f2e",
  "references/details/editor-state-reference.md": "037f72c7259f1c2cb1c052b6b5eac16e56cc85f8c157fa76eb5a60e0aabb13a3",
  "references/details/editor-tool-guide.md": "3da8547364d930aecab6f887cb5337438d1283248ff2e1107907b1e040ce5e88",
  "references/details/placement.md": "8121ae14abe65c3615f8adf2256f60eaeb26dba30fca7aafada03cdf176a6843",
  "references/details/quality.md": "f7c0b4550fd659029438cf312f4bbc81db00d3dfd0a19b2c7e74fef026933b4c",
  "references/details/single-output-structure.md": "dffc363b964b7fd7f03ea993a7411e240a357711a6fcb40b0595c8606d5d65a3",
  "references/details/techniques.md": "6a4f3a32484f5062f5950f591e71c7618bec0e928a23f22809b598473b91b099",
  "references/details/transactions.md": "29a90eb1d8dbdda0ecc7b394fc903649dc54426c94463a39fc32b1fbb00ff72d",
  "references/details/validation.md": "deee94181b9e4846b45bb7c90092a83e1ba28ccca10f763fa0e3b1e0bcbc4522",
  "references/details/work-requests.md": "261d185c40d0d8e28b60607b1096f71a2fa8c30d478de9235f6f4caa39e92cff",
  "references/details/workflow.md": "8d3f47b52e9dca2d2d54210abf3b4426dcb4f77e3e996732753148783ac93a51",
};

const workflow = { topic: "workflow" } as const;
const requests = { topic: "work-requests" } as const;
const STAMP_REASON = "The generator's stamp records the snapshot that wrote the file and how to regenerate it. It maintains the skill folder, which cp18 deletes. Each topic carries its own snapshot_id.";
/** A generated reference file: line 1 is the generator's stamp, a skill-folder drop, and lines 2 to last are one unit its topic serves line for line. */
const generated = (file: string, last: number, scenario: ScenarioId, topic: GuidanceTopicId, profile?: GuidanceProfile): UnitSpec[] => {
  const id = `reference.${file.replace(/^references\//, "").replace(/\.md$/, "").replace(/\//g, ".")}`;
  return [
    { id: `${id}.stamp`, kind: "link", file, lines: [1, 1], anchors: [], scenario, destination: { drop: "skill-folder", reason: STAMP_REASON } },
    { id, kind: "generated", file, lines: [2, last], anchors: [], scenario, destination: { topic }, ...(profile ? { profile } : {}) },
  ];
};

const UNITS: readonly UnitSpec[] = [
  {
    id: "skill.frontmatter", kind: "metadata", file: "SKILL.md", lines: [1, 8], scenario: "edit-prompt", destination: workflow,
    text: "---\nname: prompt-kit\ndescription: Read and update Prompt Kit documents through connected prompt tools. Use when a project has a Prompt Kit catalog or the user asks to inspect, author, or revise model-facing prompts.\nmetadata:\n  version: \"0.1.0\"\n  product: prompt-kit\ncompatibility: Requires the Prompt Kit connection. Codex and Claude Code use MCP; pi Agent uses the installed bridge extension.\n---",
    anchors: ["Agents read and edit Prompt Kit documents through the Prompt Kit tools", "Use them when a project has a Prompt Kit catalog", "Use them when the user asks you to inspect, author, or revise model-facing prompts", "Codex and Claude Code reach the tools through MCP, and pi reaches them through the installed bridge extension"],
  },
  {
    id: "skill.intro", kind: "rule", file: "SKILL.md", lines: [10, 12], scenario: "edit-prompt", destination: workflow,
    text: "# Prompt Kit\n\nUse the connected Prompt Kit tools for reads and edits. They preserve typed structure, stable IDs, revision checks, canonical JSON, production renders, and recovery history. Do not rewrite prompt JSON or rendered Markdown directly.",
    anchors: ["An agent uses the Prompt Kit tools for each read and each edit of a prompt", "The tools keep typed structure, stable IDs, revision checks, canonical JSON, production renders, and recovery history", "Never rewrite prompt JSON or rendered Markdown directly"],
  },
  {
    id: "skill.read.discover", kind: "step", file: "SKILL.md", lines: [14, 16], scenario: "edit-prompt", destination: workflow,
    text: "## Read or Edit\n\n1. Call `prompts_discover` in the active workspace and select a project explicitly.",
    anchors: ["Call `prompts_discover` for the active workspace, and use a project ID that it returns", "Select the requested project explicitly"],
    behavior: { tools: ["prompts_discover"] },
  },
  {
    id: "skill.read.begin", kind: "step", file: "SKILL.md", lines: [17, 17], scenario: "edit-prompt", destination: workflow,
    text: "2. For edits, call `prompts_begin` with the applicable `agent`, `single-output`, or `generic` profile, and retain the returned task ID. Read `prompts_guidance` with that `task_id` and topic `standards`. The topic can come in several parts: follow each result's `next` and read every part, because `prompts_apply_ops` is refused until you do.",
    anchors: ["Call `prompts_begin` with the `agent`, `single-output`, or `generic` profile that fits the prompt", "and keep its `task_id`", "Read `prompts_guidance` with that `task_id` and topic `standards`", "Topic `standards` can come in several parts", "Follow the `next` text of each result, and read every part before `prompts_apply_ops`", "The service refuses `prompts_apply_ops` until the task reads every part of topic `standards`"],
    behavior: { tools: ["prompts_begin", "prompts_guidance", "prompts_apply_ops"], refusal: "STANDARDS_GATE" },
  },
  {
    id: "skill.read.read", kind: "step", file: "SKILL.md", lines: [18, 18], scenario: "edit-prompt", destination: workflow,
    text: "3. Call `prompts_read` for the target. Review the production render and use its current hash as `expected_hash`.",
    anchors: ["Call `prompts_read` for the target", "Review the production render, and pass its `hash` as `expected_hash`"],
    behavior: { tools: ["prompts_read"] },
  },
  {
    id: "skill.read.apply", kind: "step", file: "SKILL.md", lines: [19, 19], scenario: "edit-prompt", destination: workflow,
    text: "4. Apply typed operations. Valid batches save immediately. On a revision conflict, read and reconcile the current document before retrying.",
    anchors: ["Apply typed operations with `prompts_apply_ops`", "A valid batch saves at once", "On a revision conflict, read the current document and reconcile the requested change before you retry"],
    behavior: { tools: ["prompts_apply_ops"] },
  },
  {
    id: "skill.read.check", kind: "step", file: "SKILL.md", lines: [20, 20], scenario: "edit-prompt", destination: workflow,
    text: "5. Call `prompts_check` with `task_id` and repair required findings. Its task report shows whether each changed prompt passed at its current revision. Report changed prompts and unresolved findings.",
    anchors: ["Call `prompts_check` with `task_id`, and repair each required finding", "the check also reports each prompt the task changed and whether its current revision passed", "Report the changed prompts and each finding you could not repair"],
    behavior: { tools: ["prompts_check"] },
  },
  {
    id: "skill.read.guidance", kind: "rule", file: "SKILL.md", lines: [22, 22], scenario: "edit-prompt", destination: workflow,
    text: "Use `prompts_guidance` with `task_id` and a topic for detailed guidance from the task's pinned guidance snapshot. Treat structural and undeclared-variable errors as blockers. Treat prose findings as review criteria. A passing check does not replace an evaluation run.",
    anchors: ["Read `prompts_guidance` with `task_id` and a topic for the detailed guidance of the task's pinned snapshot", "Treat structural and undeclared-variable errors as blockers", "Treat prose findings as review criteria", "A passing check does not replace an evaluation run"],
    behavior: { tools: ["prompts_guidance"] },
  },
  {
    id: "skill.read.scope", kind: "rule", file: "SKILL.md", lines: [24, 24], scenario: "setup-gap", destination: workflow,
    text: "Read-only work does not require a task. A task pins guidance and scope; it does not reserve a prompt. If the connection or a required operation is missing, report the setup gap instead of bypassing the prompt tools.",
    anchors: ["Read-only work needs no task", "A task pins the guidance and the scope, and it does not reserve a prompt", "If the connection or a tool you need is missing, report that setup gap", "Do not bypass the prompt tools"],
  },
  {
    id: "skill.requests.intro", kind: "rule", file: "SKILL.md", lines: [26, 28], scenario: "work-requests", destination: requests,
    text: "## Request Tools\n\nHumans file requests on a prompt in the Prompt UI. Each request is an annotation pinned to a node, a text range, or the whole prompt.",
    anchors: ["Humans file requests on a prompt in the Prompt UI", "Each request is an annotation pinned to a node, a text range, or the whole prompt"],
  },
  {
    id: "skill.requests.list", kind: "rule", file: "SKILL.md", lines: [30, 30], scenario: "work-requests", destination: requests,
    text: "- `prompts_requests`: call first when you are asked to work a prompt's requests. It lists the open requests and the hash to pass as `expected_hash`.",
    anchors: ["- **`prompts_requests`**", "Call it first when you are asked to work a prompt's requests", "It lists the open requests and the hash to pass as `expected_hash`"],
    behavior: { tools: ["prompts_requests"] },
  },
  {
    id: "skill.requests.reply", kind: "rule", file: "SKILL.md", lines: [31, 31], scenario: "work-requests", destination: requests,
    text: "- `prompts_request_reply`: call when a request is ambiguous, to ask one question on its thread. The request stays open.",
    anchors: ["- **`prompts_request_reply`**", "Call it when a request is ambiguous, to ask one question on its thread", "The request stays open"],
    behavior: { tools: ["prompts_request_reply"] },
  },
  {
    id: "skill.requests.close", kind: "rule", file: "SKILL.md", lines: [32, 32], scenario: "work-requests", destination: requests,
    text: "- `prompts_request_reply` with `close: true`: call after the request's edit is saved, or to decline it. `body` is then the one-sentence resolution.",
    anchors: ["Call it with `close: true` after the request's edit is saved, or to decline it", "`body` is then the one-sentence resolution"],
    behavior: { tools: ["prompts_request_reply"] },
  },
  {
    id: "skill.requests.hash", kind: "rule", file: "SKILL.md", lines: [34, 34], scenario: "work-requests", destination: requests,
    text: "Both writes need a task from `prompts_begin` and the latest annotations hash. Each write returns the next `expected_hash`.",
    anchors: ["Both answers need a task from `prompts_begin` and the latest annotations hash", "each call returns the next `expected_hash`"],
    behavior: { tools: ["prompts_begin"] },
  },
  {
    id: "skill.work.intro", kind: "rule", file: "SKILL.md", lines: [36, 38], scenario: "work-requests", destination: requests,
    text: "## Work Requests\n\nYou change a prompt on behalf of the human who owns it. The prompt is a tree of identified nodes, and its rendered Markdown is a projection you never touch. Valid edits save at once, so the human reviews them in the prompt's history.",
    anchors: ["You change the prompt on behalf of the human who owns it", "The prompt is a tree of identified nodes, and its rendered Markdown is a projection you never touch", "Valid edits save at once, so the human reviews them in the prompt's history"],
  },
  {
    id: "skill.work.survey", kind: "step", file: "SKILL.md", lines: [40, 43], scenario: "work-requests", destination: requests,
    text: "1. Survey the queue.\n   - Call `prompts_requests` and read every request: its target, body, and replies.\n   - Call `prompts_read` for the current tree, the stamped node IDs, and the hash.\n   - Note requests that touch the same nodes, and work them in the order they were filed.",
    anchors: ["Survey the queue.", "Call `prompts_requests` and read every request: its target, body, and replies", "Call `prompts_read` for the current tree, the stamped node IDs, and the hash", "Note requests that touch the same nodes, and work them in the order they were filed"],
    behavior: { tools: ["prompts_requests", "prompts_read"] },
  },
  {
    id: "skill.work.targets", kind: "step", file: "SKILL.md", lines: [44, 45], scenario: "work-requests", destination: requests,
    text: "2. Work each request against the current tree.\n   - A `prompt-node` target names one node. A `prompt-range` target names a quoted span inside one node. A target whose node ID equals the document ID is about the whole prompt.",
    anchors: ["Work each request against the current tree", "A `prompt-node` target names one node", "A `prompt-range` target names a quoted span inside one node", "A target whose node ID equals the document ID is about the whole prompt"],
  },
  {
    id: "skill.work.ambiguous", kind: "step", file: "SKILL.md", lines: [46, 46], scenario: "work-requests", destination: requests,
    text: "   - If a request is ambiguous, ask with `prompts_request_reply`, leave it open, and keep working the others.",
    anchors: ["If a request is ambiguous, ask with `prompts_request_reply`, leave it open, and keep working the others"],
    behavior: { tools: ["prompts_request_reply"] },
  },
  {
    id: "skill.work.change", kind: "step", file: "SKILL.md", lines: [47, 47], scenario: "work-requests", destination: requests,
    text: "   - If a change is needed, apply one minimal batch with `prompts_apply_ops` for that request, after the task has read every part of topic `standards`. Then run `prompts_check` with `task_id` and repair required findings. If no change is needed, apply none.",
    anchors: ["If a change is needed, apply one minimal batch with `prompts_apply_ops` for that request", "Call `prompts_begin`, and read every part of topic `standards` with its `task_id` before you apply an edit", "then run `prompts_check` with `task_id` and repair each required finding", "If no change is needed, apply none"],
    behavior: { tools: ["prompts_apply_ops", "prompts_begin", "prompts_check"] },
  },
  {
    id: "skill.work.close", kind: "step", file: "SKILL.md", lines: [48, 49], scenario: "work-requests", destination: requests,
    text: "   - Close each request on its own with `prompts_request_reply` and `close: true`, after its check passes. Say what changed or why nothing changed.\n   - Repeat until no request remains that you can close.",
    anchors: ["Close each request on its own with `prompts_request_reply` and `close: true`", "after its check passes", "Say what changed or why nothing changed", "Repeat until no request remains that you can close"],
    behavior: { tools: ["prompts_request_reply"] },
  },
  {
    id: "skill.work.close-out", kind: "step", file: "SKILL.md", lines: [50, 53], scenario: "work-requests", destination: requests,
    text: "3. Close out.\n   - Call `prompts_requests` again. Every request you could close must be resolved one by one, never as a lump.\n   - Every request left open must carry an unanswered question whose answer changes the edit.\n   - Run `prompts_check` with `task_id`.",
    anchors: ["Close out the queue.", "Call `prompts_requests` again", "Close every request you could close one by one, never as a lump", "Every request left open must carry an unanswered question whose answer changes the edit", "Run `prompts_check` with `task_id`"],
    behavior: { tools: ["prompts_requests", "prompts_check"] },
  },
  {
    id: "skill.work.narrow", kind: "rule", file: "SKILL.md", lines: [55, 55], scenario: "work-requests", destination: requests,
    text: "When a batch fails validation, narrow it to repair the failure and apply it again. Never widen the edit.",
    anchors: ["When a batch fails validation, narrow it to repair the failure and apply it again", "Never widen the edit"],
  },
  {
    id: "skill.rules.structure", kind: "rule", file: "SKILL.md", lines: [57, 59], scenario: "work-requests", destination: requests,
    text: "Rules for every edit:\n\n- Propose structure, never prose. An edit is a batch of ID-relative operations, never rewritten Markdown.",
    anchors: ["## Rules for Every Edit", "Propose structure, never prose", "An edit is a batch of ID-relative operations, never rewritten Markdown"],
  },
  {
    id: "skill.rules.fewest", kind: "rule", file: "SKILL.md", lines: [60, 60], scenario: "work-requests", destination: requests,
    text: "- Use the fewest operations that satisfy the request. Touch nothing the request did not name. Prefer `update_node` over remove and insert, because removal destroys IDs.",
    anchors: ["Use the fewest operations that satisfy the request", "Touch nothing the request did not name", "Prefer `update_node` over remove and insert, because removal destroys IDs"],
  },
  {
    id: "skill.rules.in-place", kind: "rule", file: "SKILL.md", lines: [61, 62], scenario: "work-requests", destination: requests,
    text: "- Change nodes in place, because IDs anchor requests and undo.\n- Keep every variable placeholder declared.",
    anchors: ["Change nodes in place, because IDs anchor requests and undo", "Keep every variable placeholder declared"],
  },
  {
    id: "skill.rules.voice", kind: "rule", file: "SKILL.md", lines: [63, 63], scenario: "work-requests", destination: requests,
    text: "- Match the prompt's voice and names. Change style only when a request asks for style.",
    anchors: ["Match the prompt's voice and names", "Change style only when a request asks for style"],
  },
  {
    id: "skill.rules.conflict", kind: "rule", file: "SKILL.md", lines: [64, 64], scenario: "work-requests", destination: requests,
    text: "- Never silently follow a conflicting request. Name the conflict, then narrow or decline it. State any assumption in the resolution.",
    anchors: ["Never silently follow a conflicting request", "Name the conflict, then narrow or decline it", "State any assumption in the resolution"],
  },
  {
    id: "skill.rules.terse", kind: "rule", file: "SKILL.md", lines: [65, 65], scenario: "work-requests", destination: requests,
    text: "- Write tersely. Replies and resolutions are a sentence or two, never a restatement of the diff.",
    anchors: ["Write tersely.", "Replies and resolutions are a sentence or two, never a restatement of the diff"],
  },
  {
    id: "skill.references.generated", kind: "link", file: "SKILL.md", lines: [67, 69], scenario: "edit-prompt",
    destination: { drop: "skill-folder", reason: "The rule says how the skill folder's references are generated and hashed, and forbids hand edits to them. It maintains the folder itself, which cp18 deletes with its generator. A served topic has no copy to regenerate." },
    text: "## References\n\nGenerated beside this file by `bun packages/prompt-kit-mcp/src/cli.ts guidance --write`. Do not edit them by hand. `snapshot.json` hashes every source.",
    anchors: [],
  },
  {
    id: "skill.references.standards", kind: "link", file: "SKILL.md", lines: [71, 71], scenario: "choose-profile", destination: workflow,
    text: "- `references/standards.md` and `references/catalog.md`: the prompt authoring standards and the catalog of every guidance source, with one page per source under `references/details/`.",
    anchors: ["Topic `standards` holds the prompt authoring standards for the task's profile", "Topic `catalog` lists every guidance source with the topic that serves it"],
  },
  {
    id: "skill.references.editor-state", kind: "link", file: "SKILL.md", lines: [72, 72], scenario: "editor-mapping", destination: requests,
    text: "- `references/details/editor-state-reference.md`: how the in-app prompt editor agent reads its request queue and diffs. The `R` aliases and compact target strings exist only in the editor. With MCP tools, pass a request's `id` from `prompts_requests` as `request_id`.",
    anchors: ["Topic `editor` holds its state reference and its tool guide", "The `R` aliases and compact target strings exist only in the editor", "With MCP tools, pass a request's `id` from `prompts_requests` as `request_id`"],
    behavior: { tools: ["prompts_requests"] },
  },
  {
    id: "skill.references.editor-tools", kind: "link", file: "SKILL.md", lines: [73, 73], scenario: "editor-mapping", destination: requests,
    text: "- `references/details/editor-tool-guide.md`: the in-app editor's tools. `read_prompt` maps to `prompts_read`, `propose_transaction` to `prompts_apply_ops`, `reply_request` to `prompts_request_reply`, and `resolve_request` to `prompts_request_reply` with `close: true`. `add_note` has no MCP tool. Two differences apply to MCP tools. `prompts_apply_ops` saves at once, with no staged review. A close takes one `body` sentence, not an outcome and a note.",
    anchors: ["`read_prompt` maps to `prompts_read`, `propose_transaction` to `prompts_apply_ops`, `reply_request` to `prompts_request_reply`, and `resolve_request` to `prompts_request_reply` with `close: true`", "`add_note` has no MCP tool", "Two differences apply to MCP tools", "`prompts_apply_ops` saves at once, with no staged review", "A close takes one `body` sentence, not an outcome and a note"],
    behavior: { tools: ["prompts_read", "prompts_apply_ops", "prompts_request_reply"] },
  },
  ...generated("references/standards.md", 352, "choose-profile", "standards"),
  ...generated("references/catalog.md", 48, "choose-profile", "catalog"),
  ...generated("references/details/placement.md", 84, "choose-profile", "standards"),
  ...generated("references/details/agent-structure.md", 179, "choose-profile", "standards", "agent"),
  ...generated("references/details/workflow.md", 133, "choose-profile", "standards", "agent"),
  ...generated("references/details/single-output-structure.md", 121, "choose-profile", "standards", "single-output"),
  ...generated("references/details/quality.md", 260, "choose-profile", "standards"),
  ...generated("references/details/techniques.md", 205, "choose-profile", "catalog"),
  ...generated("references/details/document-model.md", 82, "build-ops", "operations"),
  ...generated("references/details/authoring-model.md", 170, "build-ops", "catalog"),
  ...generated("references/details/validation.md", 76, "build-ops", "catalog"),
  ...generated("references/details/editing-model.md", 119, "editor-mapping", "editor"),
  ...generated("references/details/transactions.md", 55, "build-ops", "operations"),
  ...generated("references/details/edit-prompts.md", 88, "edit-prompt", "workflow"),
  ...generated("references/details/work-requests.md", 106, "work-requests", "work-requests"),
  ...generated("references/details/editor-state-reference.md", 51, "editor-mapping", "editor"),
  ...generated("references/details/editor-tool-guide.md", 39, "editor-mapping", "editor"),
];

/** The full manifest. Each unit carries its file's pinned sha256, and a generated or stamp unit reads its lines from root. */
export async function guidanceManifest(root = SKILL_ROOT): Promise<ManifestUnit[]> {
  return Promise.all(UNITS.map(async ({ behavior, ...unit }) => ({
    ...unit,
    sha256: PINNED_SHA256[unit.file]!,
    text: unit.text ?? (await readFile(join(root, unit.file), "utf8")).split("\n").slice(unit.lines[0] - 1, unit.lines[1]).join("\n"),
    ...(behavior ? { behavior: behavior.refusal === "STANDARDS_GATE" ? { ...behavior, refusal: STANDARDS_GATE } : behavior } : {}),
  })));
}

/** The text prompts_apply_ops returns until the task has read every part of topic standards. */
export const STANDARDS_GATE =
  "Read the prompt standards before your first edit: call prompts_guidance(task_id, topic='standards'), that is prompts_guidance with your task_id and topic \"standards\", and read every part it names. Required once per task.";

/** The writes that need a topic read in the same task. Every other tool stays open. */
const REQUIRED_TOPICS: Readonly<Record<string, readonly string[]>> = { prompts_apply_ops: ["standards"] };
/** The topics a tool needs, read in the same task. The index lists the result as each topic's required_for. */
export const requiredTopics = (tool: string): readonly string[] => REQUIRED_TOPICS[tool] ?? [];

/** The fixed fields of the prompts_capabilities index. Each other field is live. */
export const CAPABILITIES = {
  protocol_version: "1",
  guidance_tool: "prompts_guidance",
  entry_tool: "prompts_begin",
  completion_tools: ["prompts_check"],
  operations: ["prompts_capabilities", "prompts_discover", "prompts_begin", "prompts_guidance", "prompts_read", "prompts_apply_ops", "prompts_check"],
} as const;

import { createHash, randomUUID } from "node:crypto";
import { GUIDANCE_PROFILES, GUIDANCE_TOPICS, loadGuidance, type GuidanceProfile, type GuidanceSnapshot } from "@codecaine-ai/prompt-kit-server";
import { version } from "../package.json";
import { discoverPromptProjects, type PromptDiscovery, type PromptProject } from "./discovery";
import { servedText, topicParts } from "./guidance";
import { CAPABILITIES, STANDARDS_GATE, requiredTopics } from "./guidance-manifest";
import { implementationFingerprint } from "./lifecycle";
import { createPromptTools, nullable, type PromptToolResult } from "./tools";

interface TaskState {
  workspace: string;
  project: string;
  profile: GuidanceProfile;
  snapshot: GuidanceSnapshot;
  configurationFingerprint: string;
  implementationFingerprint: string;
  toolContractHash: string;
  /** ms from the service clock: prompts_begin, and the end of the last call that named the task. */
  createdAt: number;
  lastUsedAt: number;
  /** Calls running with this task. A task inside a call never expires. */
  inFlight: number;
  /** Each topic part the task read, as "topic#part". */
  topicsRead: Set<string>;
  changed: Map<string, { project: string; prompt_id: string; hash: string }>;
  checked: Map<string, { hash: string; ok: boolean }>;
}

/**
 * A task expires after taskIdleMs without a call that names it (CODECAINE_PROMPTS_TASK_IDLE_MS, default 30 minutes), or
 * taskMaxAgeMs after prompts_begin (CODECAINE_PROMPTS_TASK_MAX_AGE_MS, default 12 hours). now and maxTasks are for tests.
 */
export interface InteractionServiceOptions {
  runtimeFingerprint?: () => string | Promise<string>;
  discover?: typeof discoverPromptProjects;
  guidance?: typeof loadGuidance;
  now?: () => number;
  taskIdleMs?: number;
  taskMaxAgeMs?: number;
  maxTasks?: number;
}

const MINUTE = 60_000, HOUR = 60 * MINUTE;
export const DEFAULT_TASK_IDLE_MS = 30 * MINUTE;
export const DEFAULT_TASK_MAX_AGE_MS = 12 * HOUR;
const SWEEP_EVERY_MS = MINUTE, RETIRED_KEEP_MS = 24 * HOUR, MAX_RETIRED = 5000;
/** One prompts_capabilities page stays within 4,096 bytes. */
const CAPABILITIES_PAGE_BYTES = 4096;

/**
 * An index item cut to fit a page alone: every text field longer than the largest length that fits is cut to that
 * length and ends with an ellipsis. An object item gains truncated: true, and a text item ends with "[truncated]".
 */
function fitAlone(value: unknown, fits: (value: unknown) => boolean): unknown {
  const cut = (text: string, length: number) => text.length > length ? `${text.slice(0, length)}…` : text;
  const capped = (length: number): unknown => typeof value === "string" ? `${cut(value, length)} [truncated]`
    : { ...Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, field]) => [key, typeof field === "string" ? cut(field, length) : field])), truncated: true };
  const texts = typeof value === "string" ? [value] : Object.values(value as Record<string, unknown>).filter((field): field is string => typeof field === "string");
  let low = 0, high = Math.max(0, ...texts.map((text) => text.length));
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (fits(capped(mid))) low = mid; else high = mid - 1; }
  return capped(low);
}
type RetireReason = "idle" | "max-age";
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
/** A finite positive millisecond count from the environment, else the default with one warning. */
function durationSetting(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  console.error(`${name}=${JSON.stringify(raw)} is not a positive number of milliseconds. Using ${fallback}.`);
  return fallback;
}
/** A duration in its largest whole unit: 30 minutes, 12 hours. */
const span = (ms: number) => ms % HOUR === 0 ? plural(ms / HOUR, "hour") : ms % MINUTE === 0 ? plural(ms / MINUTE, "minute") : plural(Math.ceil(ms / 1000), "second");

const nonempty = { type: "string", minLength: 1 };
const profileSchema = { type: "string", enum: ["agent", "single-output", "generic"] };
const GUIDANCE_TOPIC_IDS = GUIDANCE_TOPICS.map((topic) => topic.id);
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

function reply(data: Record<string, unknown>, error = data.ok === false): PromptToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, ...(error ? { isError: true } : {}) };
}

function input(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
  const args = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  const extra = Object.keys(args).filter((key) => !allowed.has(key));
  if (extra.length) throw new Error(`Unknown argument${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}.`);
  for (const key of required) if (typeof args[key] !== "string" || !(args[key] as string).trim()) throw new Error(`${key} must be a non-empty string.`);
  return args;
}

function selectedProfile(value: unknown): GuidanceProfile {
  if (value == null) return "generic";
  if (value === "agent" || value === "single-output" || value === "generic") return value;
  throw new Error("profile must be agent, single-output, or generic.");
}

/** Workspace-bound interaction service used by stdio and the authenticated local daemon. */
export function createInteractionService(options: InteractionServiceOptions = {}) {
  const discoverer = options.discover ?? discoverPromptProjects;
  const guidanceLoader = options.guidance ?? loadGuidance;
  const fingerprint = options.runtimeFingerprint ?? implementationFingerprint;
  const startupFingerprint = Promise.resolve(fingerprint());
  const projects = new Map<string, PromptProject>();
  const workspaces = new Map<string, Set<string>>();
  const tasks = new Map<string, TaskState>();
  const now = options.now ?? Date.now;
  const idleMs = options.taskIdleMs ?? durationSetting("CODECAINE_PROMPTS_TASK_IDLE_MS", DEFAULT_TASK_IDLE_MS);
  const maxAgeMs = options.taskMaxAgeMs ?? durationSetting("CODECAINE_PROMPTS_TASK_MAX_AGE_MS", DEFAULT_TASK_MAX_AGE_MS);
  const maxTasks = options.maxTasks ?? 1000;
  // Retired task ids, so a call with one gets the reason instead of "Unknown task". Answered only in the task's own workspace.
  const retired = new Map<string, { workspace: string; reason: RetireReason; at: number }>();
  const retiredMessage = (id: string, reason: RetireReason) => reason === "idle"
    ? `Task ${id} expired after ${span(idleMs)} without a prompt call that named it. Saved edits are kept. Call prompts_begin again.`
    : `Task ${id} reached its ${span(maxAgeMs)} limit and was closed. Saved edits are kept. Call prompts_begin again.`;
  /** Retire each idle or over-age task outside a call, and keep at most MAX_RETIRED tombstones of the last 24 hours. */
  function sweep() {
    const t0 = now();
    for (const [id, task] of tasks) {
      if (task.inFlight > 0) continue;
      const reason: RetireReason | undefined = t0 - task.lastUsedAt > idleMs ? "idle" : t0 - task.createdAt > maxAgeMs ? "max-age" : undefined;
      if (!reason) continue;
      tasks.delete(id);
      retired.delete(id);
      retired.set(id, { workspace: task.workspace, reason, at: t0 });
    }
    for (const [id, entry] of retired) { if (retired.size <= MAX_RETIRED && entry.at >= t0 - RETIRED_KEEP_MS) break; retired.delete(id); }
  }
  const sweeper = setInterval(sweep, SWEEP_EVERY_MS);
  sweeper.unref?.();

  async function discover(workspace: string): Promise<PromptDiscovery> {
    const found = await discoverer(workspace);
    const previous = workspaces.get(found.workspace);
    if (previous) for (const id of previous) projects.delete(id);
    for (const project of found.projects) projects.set(project.id, project);
    workspaces.set(found.workspace, new Set(found.projects.map((project) => project.id)));
    return found;
  }

  /**
   * The task a call names, taken at admission before the call's first await. expired is the limit the task was past
   * when the call arrived. admitted is set once taskFor accepts the task for this workspace.
   */
  type Admission = { task?: TaskState; expired?: RetireReason; admitted: boolean };
  /**
   * The call's admitted task, if it lives in this workspace. A call already running keeps its task, but a new call on a
   * task past its 12 hours is refused, even while another call on the task runs.
   */
  function taskFor(id: unknown, workspace: string, admission: Admission): TaskState {
    const task = admission.task;
    if (!task || task.workspace !== workspace) {
      const gone = typeof id === "string" ? retired.get(id) : undefined;
      if (gone && gone.workspace === workspace) throw new Error(retiredMessage(id as string, gone.reason));
      throw new Error("Unknown task for this workspace. Call prompts_begin and use its task_id.");
    }
    if (admission.expired) throw new Error(retiredMessage(id as string, admission.expired));
    admission.admitted = true;
    return task;
  }

  const tools = createPromptTools({
    resolvePrompt: async (projectId, promptId) => {
      const project = projects.get(projectId);
      if (!project) throw new Error("Unknown project. Call prompts_discover first.");
      const prompt = project.prompts.find((entry) => entry.id === promptId);
      if (!prompt) throw new Error(`Unknown prompt ${promptId} in project ${projectId}. Call prompts_discover with project ${projectId} for its prompts.`);
      return { project, prompt };
    },
    onMutation: ({ taskId, projectId, promptId, hash }) => {
      if (!taskId) return;
      const task = tasks.get(taskId);
      if (!task) return;
      const key = `${projectId}\0${promptId}`;
      task.changed.set(key, { project: projectId, prompt_id: promptId, hash });
      task.checked.delete(key);
    },
    onCheck: ({ taskId, projectId, promptId, hash, ok }) => {
      if (!taskId) return;
      tasks.get(taskId)?.checked.set(`${projectId}\0${promptId}`, { hash, ok });
    },
    profileForTask: (taskId, fallback) => taskId ? tasks.get(taskId)?.profile ?? fallback : fallback,
  });

  const metadataTools = [
    { name: "prompts_discover", description: "Discover prompt projects in the active workspace, explicit manifests, and bounded workspace members, with each project's prompts and per-entry discovery errors. Pass project to return only that project's prompts and errors. Use the returned IDs.", inputSchema: objectSchema({ workspace: { ...nullable(nonempty), description: "Absolute workspace path. Switches the bridge to it. Defaults to the connected workspace." }, project: { ...nullable(nonempty), description: "A project ID from this workspace. Limits the result to that project's prompts and errors." } }) },
    { name: "prompts_begin", description: "Begin direct prompt authoring for one discovered project. Pins the profile (the project default when omitted) and the guidance snapshot, and returns task_id, profile, snapshot_id and project. Pass task_id to every mutation tool, and read prompts_guidance with task_id and topic \"standards\" before your first prompts_apply_ops: it is refused until then.", inputSchema: objectSchema({ project: nonempty, profile: { ...nullable(profileSchema), description: "The writing profile. Omit it, or pass null, for the project's own default profile." }, thread_id: { type: "string", minLength: 1, description: "Your T3 thread id, when the harness does not pass T3CODE_THREAD_ID. Binds this server run to that thread in the action log." } }, ["project"]) },
    { name: "prompts_guidance", description: "Read one guidance topic, or list the topics when you omit topic. With task_id it serves the task's pinned snapshot and records the read. Without task_id, profile selects a current read-only snapshot. A topic over 24,576 bytes comes in parts: pass part for each further part the result names. prompts_apply_ops is refused until the task reads every part of topic standards.",
      inputSchema: objectSchema({ task_id: nonempty, profile: { ...nullable(profileSchema), description: "Without task_id, the snapshot's profile. Omit it, or pass null, for generic. With task_id it must be the task's profile." }, topic: { ...nullable({ type: "string", enum: GUIDANCE_TOPIC_IDS }), description: "A topic id from prompts_capabilities. Omit it, or pass null, for the topic list." }, part: { ...nullable({ type: "integer", minimum: 1 }), description: "The part to read, from 1. Defaults to 1." } }) },
  ];
  const capabilitiesTool = { name: "prompts_capabilities", description: "The capabilities index: versions, the guidance snapshot, the tool order, each guidance topic with its size, its part count and the writes it unlocks, the discovery tool with the prompt count, and the project ids of the workspace. Call it first. A page holds at most 4,096 bytes. Pass next_cursor as cursor for the next page. Topic sizes are for the largest profile. An item too long for a page alone is cut to fit and marked truncated: prompts_discover returns it whole.",
    inputSchema: objectSchema({ workspace: { ...nullable(nonempty), description: "Absolute workspace path. Switches the bridge to it. Defaults to the connected workspace." }, cursor: { ...nullable(nonempty), description: "next_cursor from the previous page." } }) };
  const mutationNames = new Set(["prompts_apply_ops", "prompts_undo", "prompts_request_reply"]);

  function listTools() {
    return [capabilitiesTool, ...metadataTools, ...tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))];
  }
  function toolContractHash() {
    return createHash("sha256").update(JSON.stringify(listTools())).digest("hex");
  }

  async function assertTaskCanMutate(task: TaskState, found: PromptDiscovery): Promise<void> {
    if (await startupFingerprint !== await fingerprint()) throw new Error("Prompt implementation changed during this task. Restart the Prompt service and begin a new task before further edits.");
    if (task.toolContractHash !== toolContractHash()) throw new Error("Prompt tool contracts changed during this task. Restart the Prompt service and begin a new task.");
    if (task.configurationFingerprint !== found.configurationFingerprint) throw new Error("Prompt sources or declarations changed during this task. Read the current discovery result and begin a new task before editing.");
  }

  const partCount = (snapshot: GuidanceSnapshot, id: string) => topicParts(snapshot.topics.find((topic) => topic.id === id)!).length;
  /** The parts of a topic that the task has not read, from 1. */
  const unreadParts = (task: TaskState, id: string) =>
    Array.from({ length: partCount(task.snapshot, id) }, (_, index) => index + 1).filter((part) => !task.topicsRead.has(`${id}#${part}`));
  /** Each topic with its served size and part count, the largest over the given snapshots, and the writes it unlocks. */
  function topicIndex(snapshots: readonly GuidanceSnapshot[]) {
    const writes = listTools().map((tool) => tool.name);
    return snapshots[0]!.topics.map((topic) => {
      const served = snapshots.map((snapshot) => topicParts(snapshot.topics.find((entry) => entry.id === topic.id)!));
      return { id: topic.id, title: topic.title, bytes: Math.max(...served.map((parts) => parts.reduce((sum, part) => sum + Buffer.byteLength(part), 0))),
        parts: Math.max(...served.map((parts) => parts.length)), required_for: writes.filter((write) => requiredTopics(write).includes(topic.id)) };
    });
  }

  /** Each workspace's last listing and its generation. A capabilities cursor names the generation, so one page set never mixes two listings. */
  const listings = new Map<string, { listing: string; generation: number }>();
  let generation = 0;
  /**
   * One page of the capabilities index. Every call rescans the workspace. Scalar fields repeat on every page, and the
   * lists topics, projects and warnings continue across pages in that order. next_cursor is "<generation>:<offset>",
   * or null on the last page. A rescan that finds the same projects and warnings keeps the generation, so its cursor
   * stays valid. A page holds at least one item, so paging always ends.
   */
  async function capabilities(found: PromptDiscovery, cursor: unknown) {
    const snapshots = await Promise.all(GUIDANCE_PROFILES.map((profile) => guidanceLoader({ profile })));
    const generic = snapshots.find((snapshot) => snapshot.profile === "generic") ?? snapshots[0]!;
    const projectList = found.projects.map((project) => ({ id: project.id, name: project.name, prompts: project.prompts.length }));
    const listing = JSON.stringify([projectList, found.warnings]);
    const last = listings.get(found.workspace);
    const current = last?.listing === listing ? last.generation : ++generation;
    listings.set(found.workspace, { listing, generation: current });
    const items: (readonly ["topics" | "projects" | "warnings", unknown])[] = [
      ...topicIndex(snapshots).map((topic) => ["topics", topic] as const),
      ...projectList.map((project) => ["projects", project] as const),
      ...found.warnings.map((warning) => ["warnings", warning] as const),
    ];
    const parsed = typeof cursor === "string" ? /^(\d+):(\d+)$/.exec(cursor) : null;
    if (parsed && Number(parsed[1]) !== current) throw new Error("The project list changed. Call prompts_capabilities without a cursor for the first page.");
    const offset = cursor === undefined ? 0 : parsed ? Number(parsed[2]) : -1;
    if (offset < 0 || offset >= items.length) throw new Error("Unknown cursor. Call prompts_capabilities without a cursor for the first page.");
    const prompts = projectList.reduce((sum, project) => sum + project.prompts, 0);
    const page = (end: number, next_cursor: string | null) => {
      const pick = (list: string) => items.slice(offset, end).filter(([name]) => name === list).map(([, value]) => value);
      return { ok: true, protocol_version: CAPABILITIES.protocol_version, server_version: version, tool_contract_hash: `sha256:${toolContractHash()}`,
        guidance_snapshot: generic.snapshotId, scope: { workspace: found.workspace }, guidance_tool: CAPABILITIES.guidance_tool, entry_tool: CAPABILITIES.entry_tool,
        completion_tools: CAPABILITIES.completion_tools, operations: CAPABILITIES.operations, topics: pick("topics"),
        discovery_tools: [{ name: "prompts_discover", purpose: `List the ${prompts} prompt${prompts === 1 ? "" : "s"} of the ${projectList.length} project${projectList.length === 1 ? "" : "s"} in this workspace, with discovery errors. Pass project for one project.` }],
        projects: pick("projects"), warnings: pick("warnings"), next_cursor };
    };
    // Measure with the widest cursor, so the page still fits once next_cursor is set.
    const fits = (end: number) => Buffer.byteLength(JSON.stringify(page(end, `${current}:${items.length}`))) <= CAPABILITIES_PAGE_BYTES;
    // A page holds at least one item. One that overflows the page alone is cut to fit, and prompts_discover returns it whole.
    if (!fits(offset + 1)) {
      const [list, value] = items[offset]!;
      items[offset] = [list, fitAlone(value, (candidate) => { items[offset] = [list, candidate]; const fitted = fits(offset + 1); items[offset] = [list, value]; return fitted; })];
    }
    let end = offset + 1;
    while (end < items.length && fits(end + 1)) end++;
    return page(end, end < items.length ? `${current}:${end}` : null);
  }

  /** Each prompt the task changed, its disk-current hash, and whether prompts_check passed at that hash. */
  async function taskReport(task: TaskState) {
    const readTool = tools.find((candidate) => candidate.name === "prompts_read")!;
    const changed = await Promise.all([...task.changed.entries()].map(async ([key, entry]) => {
      const check = task.checked.get(key);
      const current = await readTool.execute({ project: entry.project, prompt_id: entry.prompt_id });
      const currentHash = current.structuredContent.ok === true ? current.structuredContent.hash as string : undefined;
      return { ...entry, current_hash: currentHash, checked: !!currentHash && check?.hash === currentHash,
        check_ok: !!currentHash && check?.hash === currentHash ? check.ok : false,
        ...(currentHash === undefined ? { read_error: current.structuredContent.detail } : {}) };
    }));
    return { snapshot_id: task.snapshot.snapshotId, changed,
      all_current_revisions_checked: changed.every((entry) => entry.checked && entry.check_ok) && [...task.checked.values()].every((check) => check.ok) };
  }

  /**
   * Admission runs before the call's first await. The sweep retires each expired task outside a call, and the task the
   * call names is pinned, so neither the sweeper nor a slow discovery retires it mid-call. Only an admitted call
   * refreshes the task, at its end, so the idle limit counts from the end of the last call that used it.
   */
  async function call(workspace: string, name: string, rawArgs: Record<string, unknown> = {}): Promise<PromptToolResult> {
    sweep();
    const task = typeof rawArgs.task_id === "string" ? tasks.get(rawArgs.task_id) : undefined;
    const admission: Admission = { task, expired: task && now() - task.createdAt > maxAgeMs ? "max-age" : undefined, admitted: false };
    if (task) task.inFlight++;
    try {
      return await dispatch(workspace, name, rawArgs, admission);
    } finally {
      if (task) { task.inFlight--; if (admission.admitted) task.lastUsedAt = now(); }
    }
  }

  async function dispatch(workspace: string, name: string, rawArgs: Record<string, unknown>, admission: Admission): Promise<PromptToolResult> {
    try {
      if (name === "prompts_capabilities") {
        const args = input(rawArgs, [], ["workspace", "cursor"]);
        for (const key of ["workspace", "cursor"]) if (args[key] != null && (typeof args[key] !== "string" || !args[key])) throw new Error(`${key} must be a non-empty string.`);
        return reply(await capabilities(await discover(typeof args.workspace === "string" ? args.workspace : workspace), args.cursor ?? undefined));
      }
      if (name === "prompts_discover") {
        const args = input(rawArgs, [], ["workspace", "project"]);
        for (const key of ["workspace", "project"]) if (args[key] != null && (typeof args[key] !== "string" || !args[key])) throw new Error(`${key} must be a non-empty string.`);
        const found = await discover(typeof args.workspace === "string" ? args.workspace : workspace);
        if (args.project == null) return reply({ ok: true, ...found, next: "Call prompts_begin with a returned project ID before editing. Pass project to list one project's prompts." });
        const project = projects.get(args.project as string);
        if (!project || !workspaces.get(found.workspace)?.has(project.id)) throw new Error("Project is not in this workspace. Call prompts_discover and use a returned project ID.");
        return reply({ ok: true, workspace: found.workspace, project: { id: project.id, name: project.name }, prompts: project.prompts, errors: project.errors,
          next: "Call prompts_begin with this project before editing, then prompts_read for a prompt." });
      }
      const found = await discover(workspace);
      if (name === "prompts_begin") {
        const args = input(rawArgs, ["project"], ["profile", "thread_id"]);
        if (args.thread_id !== undefined && (typeof args.thread_id !== "string" || !args.thread_id)) throw new Error("thread_id must be a non-empty string.");
        const selectedProject = projects.get(args.project as string);
        if (!workspaces.get(found.workspace)?.has(args.project as string)) throw new Error("Project is not in this workspace. Call prompts_discover and use a returned project ID.");
        if (!selectedProject) throw new Error("Unknown project. Call prompts_discover first.");
        // Only an omitted profile or null selects the project's own profile.
        const profile = args.profile == null ? selectedProject.defaultProfile : selectedProfile(args.profile);
        const assertCapacity = () => { if (tasks.size >= maxTasks) throw new Error(`Too many open prompt tasks (${tasks.size}). A task expires after ${span(idleMs)} without a prompt call that names it.`); };
        assertCapacity();
        if (await startupFingerprint !== await fingerprint()) throw new Error("Prompt implementation changed. Restart the Prompt service before beginning a task.");
        const snapshot = await guidanceLoader({ profile });
        // Parallel begins all pass the first check before their awaits, so the insert checks again.
        assertCapacity();
        const id = randomUUID();
        const task: TaskState = { workspace: found.workspace, project: args.project as string, profile, snapshot, configurationFingerprint: found.configurationFingerprint,
          implementationFingerprint: await startupFingerprint, toolContractHash: toolContractHash(), createdAt: now(), lastUsedAt: now(), inFlight: 0, topicsRead: new Set(), changed: new Map(), checked: new Map() };
        tasks.set(id, task);
        return reply({ ok: true, task_id: id, profile, snapshot_id: snapshot.snapshotId, project: { id: selectedProject.id, name: selectedProject.name } });
      }
      if (name === "prompts_guidance") {
        const args = input(rawArgs, [], ["task_id", "profile", "topic", "part"]);
        let snapshot: GuidanceSnapshot;
        let task: TaskState | undefined;
        if (args.task_id != null) {
          task = taskFor(args.task_id, found.workspace, admission);
          if (args.profile != null && args.profile !== task.profile) throw new Error("profile cannot override a task's pinned profile.");
          snapshot = task.snapshot;
        } else snapshot = await guidanceLoader({ profile: selectedProfile(args.profile) });
        if (args.topic == null) {
          if (args.part != null) throw new Error("part needs a topic.");
          return reply({ ok: true, profile: snapshot.profile, snapshot_id: snapshot.snapshotId, topics: topicIndex([snapshot]),
            next: "Read topic standards with your task_id before your first prompts_apply_ops." });
        }
        const topic = snapshot.topics.find((entry) => entry.id === args.topic);
        if (!topic) throw new Error(`Unknown topic ${JSON.stringify(args.topic)}. Topics: ${snapshot.topics.map((entry) => entry.id).join(", ")}.`);
        const parts = topicParts(topic);
        const part = args.part ?? 1;
        if (!Number.isInteger(part) || (part as number) < 1 || (part as number) > parts.length) throw new Error(`part must be an integer from 1 to ${parts.length} for topic ${topic.id}.`);
        task?.topicsRead.add(`${topic.id}#${part}`);
        return reply({ ok: true, profile: snapshot.profile, snapshot_id: snapshot.snapshotId, topic: topic.id, title: topic.title, part, parts: parts.length,
          guidance: servedText(parts[(part as number) - 1]!),
          ...((part as number) < parts.length ? { next: `Read part ${(part as number) + 1} of topic ${topic.id}: pass part ${(part as number) + 1}.` } : {}) });
      }
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) throw new Error(`Unknown tool ${name}.`);
      const project = typeof rawArgs.project === "string" ? rawArgs.project : undefined;
      if (!project || !workspaces.get(found.workspace)?.has(project)) throw new Error("Project is not in this workspace. Call prompts_discover and use a returned project ID.");
      if (mutationNames.has(name)) {
        const task = taskFor(rawArgs.task_id, found.workspace, admission);
        if (task.project !== project) throw new Error("This task belongs to a different project. Begin a task for the selected project before editing.");
        for (const required of requiredTopics(name)) {
          const unread = unreadParts(task, required);
          if (unread.length) throw new Error(unread.length === partCount(task.snapshot, required) ? STANDARDS_GATE : `${STANDARDS_GATE} Unread: part ${unread.join(", ")} of ${partCount(task.snapshot, required)}.`);
        }
        await assertTaskCanMutate(task, found);
        return await tool.execute(rawArgs);
      }
      // A read with task_id null runs as a read without one.
      const { task_id: taskId, ...readArgs } = rawArgs;
      if (taskId == null) return await tool.execute(readArgs);
      const task = taskFor(taskId, found.workspace, admission);
      if (task.project !== project) throw new Error("This task belongs to a different project.");
      const result = await tool.execute(rawArgs);
      if (name !== "prompts_check") return result;
      // A check that fails, even before it reads the prompt, still carries the task report.
      return reply({ ...result.structuredContent, ...await taskReport(task) }, result.isError === true);
    } catch (error) { return reply({ ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  }

  return { discover, listTools, call, project: (id: string) => projects.get(id),
    stats: () => { sweep(); return { projects: projects.size, workspaces: workspaces.size, tasks: tasks.size }; },
    close: () => clearInterval(sweeper) };
}

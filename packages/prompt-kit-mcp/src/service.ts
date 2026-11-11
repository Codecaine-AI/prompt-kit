import { createHash, randomUUID } from "node:crypto";
import { loadGuidance, type GuidanceProfile, type GuidanceSnapshot } from "@codecaine-ai/prompt-kit-server";
import { discoverPromptProjects, type PromptDiscovery, type PromptProject } from "./discovery";
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
  changed: Map<string, { project: string; prompt_id: string; hash: string }>;
  checked: Map<string, { hash: string; ok: boolean }>;
}

/**
 * A task expires after taskIdleMs without a call that names it, or taskMaxAgeMs after prompts_begin. now and maxTasks
 * are for tests.
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
type RetireReason = "idle" | "max-age";
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
/** A duration in its largest whole unit: 30 minutes, 12 hours. */
const span = (ms: number) => ms % HOUR === 0 ? plural(ms / HOUR, "hour") : ms % MINUTE === 0 ? plural(ms / MINUTE, "minute") : plural(Math.ceil(ms / 1000), "second");

const nonempty = { type: "string", minLength: 1 };
const profileSchema = { type: "string", enum: ["agent", "single-output", "generic"] };
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
  if (value === undefined) return "generic";
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
  const idleMs = options.taskIdleMs ?? DEFAULT_TASK_IDLE_MS;
  const maxAgeMs = options.taskMaxAgeMs ?? DEFAULT_TASK_MAX_AGE_MS;
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

  /** The live task with this id in this workspace, pinned against expiry in held until its call returns. */
  function taskFor(id: unknown, workspace: string, held: TaskState[]): TaskState {
    const task = typeof id === "string" ? tasks.get(id) : undefined;
    if (!task || task.workspace !== workspace) {
      const gone = typeof id === "string" ? retired.get(id) : undefined;
      if (gone && gone.workspace === workspace) throw new Error(retiredMessage(id as string, gone.reason));
      throw new Error("Unknown task for this workspace. Call prompts_begin and use its task_id.");
    }
    task.inFlight++;
    held.push(task);
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
    { name: "prompts_begin", description: "Begin direct prompt authoring for one discovered project. Pins the profile (the project default when omitted) and the guidance snapshot, and returns task_id, profile, snapshot_id and project. Pass task_id to every mutation tool.", inputSchema: objectSchema({ project: nonempty, profile: profileSchema, thread_id: { type: "string", minLength: 1, description: "Your T3 thread id, when the harness does not pass T3CODE_THREAD_ID. Binds this server run to that thread in the action log." } }, ["project"]) },
    { name: "prompts_guidance", description: "Read the task's pinned guidance or one detailed catalog reference. Without task_id, profile selects a current read-only snapshot.", inputSchema: objectSchema({ task_id: nonempty, profile: profileSchema, reference: nonempty }) },
  ];
  const mutationNames = new Set(["prompts_apply_ops", "prompts_undo", "prompts_request_reply"]);

  function listTools() {
    return [...metadataTools, ...tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))];
  }
  function toolContractHash() {
    return createHash("sha256").update(JSON.stringify(listTools())).digest("hex");
  }

  async function assertTaskCanMutate(task: TaskState, found: PromptDiscovery): Promise<void> {
    if (await startupFingerprint !== await fingerprint()) throw new Error("Prompt implementation changed during this task. Restart the Prompt service and begin a new task before further edits.");
    if (task.toolContractHash !== toolContractHash()) throw new Error("Prompt tool contracts changed during this task. Restart the Prompt service and begin a new task.");
    if (task.configurationFingerprint !== found.configurationFingerprint) throw new Error("Prompt sources or declarations changed during this task. Read the current discovery result and begin a new task before editing.");
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

  async function call(workspace: string, name: string, rawArgs: Record<string, unknown> = {}): Promise<PromptToolResult> {
    sweep();
    const held: TaskState[] = [];
    try {
      return await dispatch(workspace, name, rawArgs, held);
    } finally {
      for (const task of held) { task.inFlight--; task.lastUsedAt = now(); }
    }
  }

  async function dispatch(workspace: string, name: string, rawArgs: Record<string, unknown>, held: TaskState[]): Promise<PromptToolResult> {
    try {
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
        const profile = args.profile === undefined ? selectedProject.defaultProfile : selectedProfile(args.profile);
        if (tasks.size >= maxTasks) throw new Error(`Too many open prompt tasks (${tasks.size}). A task expires after ${span(idleMs)} without a prompt call that names it.`);
        if (await startupFingerprint !== await fingerprint()) throw new Error("Prompt implementation changed. Restart the Prompt service before beginning a task.");
        const snapshot = await guidanceLoader({ profile });
        const id = randomUUID();
        const task: TaskState = { workspace: found.workspace, project: args.project as string, profile, snapshot, configurationFingerprint: found.configurationFingerprint,
          implementationFingerprint: await startupFingerprint, toolContractHash: toolContractHash(), createdAt: now(), lastUsedAt: now(), inFlight: 0, changed: new Map(), checked: new Map() };
        tasks.set(id, task);
        return reply({ ok: true, task_id: id, profile, snapshot_id: snapshot.snapshotId, project: { id: selectedProject.id, name: selectedProject.name } });
      }
      if (name === "prompts_guidance") {
        const args = input(rawArgs, [], ["task_id", "profile", "reference"]);
        let snapshot: GuidanceSnapshot;
        if (args.task_id !== undefined) {
          const task = taskFor(args.task_id, found.workspace, held);
          if (args.profile !== undefined && args.profile !== task.profile) throw new Error("profile cannot override a task's pinned profile.");
          snapshot = task.snapshot;
        } else snapshot = await guidanceLoader({ profile: selectedProfile(args.profile) });
        if (args.reference !== undefined) {
          if (typeof args.reference !== "string" || !args.reference) throw new Error("reference must be a non-empty string.");
          const reference = snapshot.references[args.reference];
          if (reference === undefined) throw new Error(`Unknown guidance reference ${args.reference}. Use an id from catalog.`);
          return reply({ ok: true, profile: snapshot.profile, snapshot_id: snapshot.snapshotId, reference_id: args.reference, reference });
        }
        return reply({ ok: true, profile: snapshot.profile, snapshot_id: snapshot.snapshotId, guidance: snapshot.text, catalog: snapshot.catalog, sources: snapshot.sources });
      }
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) throw new Error(`Unknown tool ${name}.`);
      const project = typeof rawArgs.project === "string" ? rawArgs.project : undefined;
      if (!project || !workspaces.get(found.workspace)?.has(project)) throw new Error("Project is not in this workspace. Call prompts_discover and use a returned project ID.");
      if (mutationNames.has(name)) {
        const task = taskFor(rawArgs.task_id, found.workspace, held);
        if (task.project !== project) throw new Error("This task belongs to a different project. Begin a task for the selected project before editing.");
        await assertTaskCanMutate(task, found);
        return await tool.execute(rawArgs);
      }
      // A read with task_id null runs as a read without one.
      const { task_id: taskId, ...readArgs } = rawArgs;
      if (taskId == null) return await tool.execute(readArgs);
      const task = taskFor(taskId, found.workspace, held);
      if (task.project !== project) throw new Error("This task belongs to a different project.");
      const result = await tool.execute(rawArgs);
      if (name !== "prompts_check" || result.structuredContent.hash === undefined) return result;
      return reply({ ...result.structuredContent, ...await taskReport(task) }, result.isError === true);
    } catch (error) { return reply({ ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  }

  return { discover, listTools, call, project: (id: string) => projects.get(id),
    stats: () => { sweep(); return { projects: projects.size, workspaces: workspaces.size, tasks: tasks.size }; },
    close: () => clearInterval(sweeper) };
}

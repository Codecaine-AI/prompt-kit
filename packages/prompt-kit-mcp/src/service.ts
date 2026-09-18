import { createHash, randomUUID } from "node:crypto";
import { loadGuidance, type GuidanceProfile, type GuidanceSnapshot } from "@codecaine-ai/prompt-kit-server";
import { discoverPromptProjects, type PromptDiscovery, type PromptProject } from "./discovery";
import { implementationFingerprint } from "./lifecycle";
import { createPromptTools, type PromptToolResult } from "./tools";

interface TaskState {
  workspace: string;
  project: string;
  profile: GuidanceProfile;
  snapshot: GuidanceSnapshot;
  configurationFingerprint: string;
  implementationFingerprint: string;
  toolContractHash: string;
  createdAt: string;
  changed: Map<string, { project: string; prompt_id: string; hash: string }>;
  checked: Map<string, { hash: string; ok: boolean }>;
}

export interface InteractionServiceOptions {
  runtimeFingerprint?: () => string | Promise<string>;
  discover?: typeof discoverPromptProjects;
  guidance?: typeof loadGuidance;
}

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

  async function discover(workspace: string): Promise<PromptDiscovery> {
    const found = await discoverer(workspace);
    const previous = workspaces.get(found.workspace);
    if (previous) for (const id of previous) projects.delete(id);
    for (const project of found.projects) projects.set(project.id, project);
    workspaces.set(found.workspace, new Set(found.projects.map((project) => project.id)));
    return found;
  }

  function taskFor(id: unknown, workspace: string): TaskState {
    const task = typeof id === "string" ? tasks.get(id) : undefined;
    if (!task || task.workspace !== workspace) throw new Error("Unknown task for this workspace. Call prompts_begin and use its task_id.");
    return task;
  }

  const tools = createPromptTools({
    resolveProject: async (id) => {
      const project = projects.get(id);
      if (!project) throw new Error("Unknown project. Call prompts_discover for the active workspace and use a returned project ID.");
      return project;
    },
    resolvePrompt: async (projectId, promptId) => {
      const project = projects.get(projectId);
      if (!project) throw new Error("Unknown project. Call prompts_discover first.");
      const prompt = project.prompts.find((entry) => entry.id === promptId);
      if (!prompt) throw new Error(`Unknown prompt ${promptId} in project ${projectId}. Call prompts_list first.`);
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
    { name: "prompts_discover", description: "Discover prompt projects in the active workspace, explicit manifests, and bounded workspace members. Call first and use returned IDs.", inputSchema: objectSchema({ workspace: nonempty }) },
    { name: "prompts_begin", description: "Begin direct prompt authoring for one discovered project with a pinned profile and guidance snapshot. Returns the task_id required for mutation tools.", inputSchema: objectSchema({ project: nonempty, profile: profileSchema }, ["project"]) },
    { name: "prompts_guidance", description: "Read the task's pinned guidance or one detailed catalog reference. Without task_id, profile selects a current read-only snapshot.", inputSchema: objectSchema({ task_id: nonempty, profile: profileSchema, reference: nonempty }) },
    { name: "prompts_end", description: "End a task and report each changed prompt plus whether its current revision passed prompts_check. Saved changes remain saved.", inputSchema: objectSchema({ task_id: nonempty }, ["task_id"]) },
  ];
  const mutationNames = new Set(["prompts_apply_ops", "prompts_undo"]);

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

  async function call(workspace: string, name: string, rawArgs: Record<string, unknown> = {}): Promise<PromptToolResult> {
    try {
      const discoveryInput = name === "prompts_discover" && typeof rawArgs.workspace === "string" ? rawArgs.workspace : workspace;
      const found = await discover(discoveryInput);
      if (name === "prompts_discover") {
        input(rawArgs, [], ["workspace"]);
        if (rawArgs.workspace !== undefined && (typeof rawArgs.workspace !== "string" || !rawArgs.workspace)) throw new Error("workspace must be a non-empty string.");
        return reply({ ok: true, ...found, next: "Call prompts_list with a returned project ID, then prompts_begin before editing." });
      }
      if (name === "prompts_begin") {
        const args = input(rawArgs, ["project"], ["profile"]);
        const selectedProject = projects.get(args.project as string);
        if (!workspaces.get(found.workspace)?.has(args.project as string)) throw new Error("Project is not in this workspace. Call prompts_discover and use a returned project ID.");
        if (!selectedProject) throw new Error("Unknown project. Call prompts_discover first.");
        const profile = args.profile === undefined ? selectedProject.defaultProfile : selectedProfile(args.profile);
        if (tasks.size >= 1000) throw new Error("Too many open prompt tasks. End existing tasks or restart the service.");
        if (await startupFingerprint !== await fingerprint()) throw new Error("Prompt implementation changed. Restart the Prompt service before beginning a task.");
        const snapshot = await guidanceLoader({ profile });
        const id = randomUUID();
        const task: TaskState = { workspace: found.workspace, project: args.project as string, profile, snapshot, configurationFingerprint: found.configurationFingerprint,
          implementationFingerprint: await startupFingerprint, toolContractHash: toolContractHash(), createdAt: new Date().toISOString(), changed: new Map(), checked: new Map() };
        tasks.set(id, task);
        return reply({ ok: true, task_id: id, profile, snapshot_id: snapshot.snapshotId,
          implementation_hash: task.implementationFingerprint, tool_contract_hash: task.toolContractHash,
          project: found.projects.find((entry) => entry.id === args.project) && { id: args.project, name: found.projects.find((entry) => entry.id === args.project)!.name },
          guidance: snapshot.text, catalog: snapshot.catalog, sources: snapshot.sources,
          operation_guide: { root_id: "$root", operations: ["update_node", "insert_after", "insert_into", "remove_node", "move_after"] } });
      }
      if (name === "prompts_guidance") {
        const args = input(rawArgs, [], ["task_id", "profile", "reference"]);
        let snapshot: GuidanceSnapshot;
        if (args.task_id !== undefined) {
          const task = taskFor(args.task_id, found.workspace);
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
      if (name === "prompts_end") {
        const args = input(rawArgs, ["task_id"]);
        const task = taskFor(args.task_id, found.workspace);
        const changed = await Promise.all([...task.changed.entries()].map(async ([key, entry]) => {
          const check = task.checked.get(key);
          const readTool = tools.find((candidate) => candidate.name === "prompts_read")!;
          const current = await readTool.execute({ project: entry.project, prompt_id: entry.prompt_id });
          const currentHash = current.structuredContent.ok === true ? current.structuredContent.hash as string : undefined;
          return { ...entry, current_hash: currentHash, checked: !!currentHash && check?.hash === currentHash,
            check_ok: !!currentHash && check?.hash === currentHash ? check.ok : false,
            ...(currentHash === undefined ? { read_error: current.structuredContent.detail } : {}) };
        }));
        tasks.delete(args.task_id as string);
        return reply({ ok: true, ended: true, snapshot_id: task.snapshot.snapshotId, changed,
          all_current_revisions_checked: changed.every((entry) => entry.checked && entry.check_ok) && [...task.checked.values()].every((check) => check.ok) });
      }
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) throw new Error(`Unknown tool ${name}.`);
      const project = typeof rawArgs.project === "string" ? rawArgs.project : undefined;
      if (!project || !workspaces.get(found.workspace)?.has(project)) throw new Error("Project is not in this workspace. Call prompts_discover and use a returned project ID.");
      if (mutationNames.has(name)) {
        const task = taskFor(rawArgs.task_id, found.workspace);
        if (task.project !== project) throw new Error("This task belongs to a different project. Begin a task for the selected project before editing.");
        await assertTaskCanMutate(task, found);
      } else if (rawArgs.task_id !== undefined) {
        const task = taskFor(rawArgs.task_id, found.workspace);
        if (task.project !== project) throw new Error("This task belongs to a different project.");
      }
      return await tool.execute(rawArgs);
    } catch (error) { return reply({ ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  }

  return { discover, listTools, call, project: (id: string) => projects.get(id), stats: () => ({ projects: projects.size, workspaces: workspaces.size, tasks: tasks.size }) };
}

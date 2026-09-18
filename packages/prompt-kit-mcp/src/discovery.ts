import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { validatePromptDocumentShape, type PromptDocument } from "@codecaine-ai/prompt-kit";

export type PromptProfile = "agent" | "single-output" | "generic";

export interface PromptTarget {
  promptPath: string;
  renderedPath?: string;
  declaredVariables?: string[];
}

export interface DiscoveredPrompt {
  id: string;
  title: string;
  profile: PromptProfile;
  target: PromptTarget;
  source: "catalog" | "standalone";
  /** Root-relative manifest supplying declarations; reloaded while mutations hold the store lock. */
  declarationSource?: string;
  declarationKind?: "agent" | "standalone";
  declarationIdentity?: string;
  declarationFingerprint?: string;
}

export interface PromptDiscoveryIssue {
  path: string;
  detail: string;
}

export interface PromptProject {
  id: string;
  name: string;
  root: string;
  defaultProfile: PromptProfile;
  prompts: DiscoveredPrompt[];
  errors: PromptDiscoveryIssue[];
}

export interface PromptDiscovery {
  workspace: string;
  projects: PromptProject[];
  warnings: string[];
  configurationFingerprint: string;
}

type Manifest = {
  name?: unknown;
  projects?: unknown;
  catalogRoots?: unknown;
  standalone?: unknown;
  standalonePrompts?: unknown;
  profile?: unknown;
};

const inside = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

async function readJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function profile(value: unknown, fallback: PromptProfile = "generic"): PromptProfile {
  if (value === undefined) return fallback;
  if (value === "agent" || value === "single-output" || value === "generic") return value;
  throw new Error(`Invalid prompt profile ${JSON.stringify(value)}`);
}

async function confinedExisting(root: string, input: string, kind: "file" | "directory"): Promise<string> {
  if (typeof input !== "string" || !input || isAbsolute(input)) throw new Error(`${kind} path must be a non-empty relative path`);
  const lexical = resolve(root, input);
  if (!inside(root, lexical)) throw new Error(`${kind} path escapes project: ${input}`);
  const canonical = await realpath(lexical);
  if (!inside(root, canonical)) throw new Error(`${kind} symlink escapes project: ${input}`);
  const info = await stat(canonical);
  if (kind === "file" ? !info.isFile() : !info.isDirectory()) throw new Error(`${input} is not a ${kind}`);
  return canonical;
}

function variables(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)) return [...new Set(value)].sort();
  if (object(value)) return Object.keys(value).sort();
  throw new Error("Variable declarations must be an object or an array of names");
}

function relativeTarget(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

async function loadPrompt(
  projectRoot: string,
  file: string,
  options: { id?: unknown; title?: unknown; profile?: unknown; renderedPath?: unknown; variables?: unknown; source: DiscoveredPrompt["source"];
    declarationSource?: string; declarationKind?: DiscoveredPrompt["declarationKind"]; declarationIdentity?: string; declarationFingerprint?: string },
): Promise<DiscoveredPrompt> {
  const canonical = await realpath(file);
  if (!inside(projectRoot, canonical)) throw new Error("Prompt symlink escapes project");
  const raw = await readJson(canonical);
  const checked = validatePromptDocumentShape(raw);
  if (!checked.valid) throw new Error(`Invalid PromptDocument: ${checked.errors.join("; ")}`);
  const document = raw as PromptDocument;
  let renderedPath: string | undefined;
  if (options.renderedPath !== undefined) {
    if (typeof options.renderedPath !== "string" || isAbsolute(options.renderedPath)) throw new Error("renderedPath must be relative");
    const lexical = resolve(projectRoot, options.renderedPath);
    if (!inside(projectRoot, lexical)) throw new Error("renderedPath escapes project");
    // Existing parents are canonicalized by the store again before mutation.
    let cursor = dirname(lexical);
    while (!await isDirectory(cursor)) {
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error("renderedPath has no confined existing parent");
      cursor = parent;
    }
    if (!inside(projectRoot, await realpath(cursor))) throw new Error("renderedPath parent symlink escapes project");
    renderedPath = relativeTarget(projectRoot, lexical);
  }
  return {
    id: typeof options.id === "string" && options.id ? options.id : document.id,
    title: typeof options.title === "string" && options.title ? options.title : document.title ?? document.id,
    profile: profile(options.profile),
    target: {
      promptPath: relativeTarget(projectRoot, canonical),
      ...(renderedPath ? { renderedPath } : {}),
      ...(options.variables !== undefined ? { declaredVariables: variables(options.variables) } : {}),
    },
    source: options.source,
    ...(options.declarationSource ? { declarationSource: options.declarationSource } : {}),
    ...(options.declarationKind ? { declarationKind: options.declarationKind } : {}),
    ...(options.declarationIdentity ? { declarationIdentity: options.declarationIdentity } : {}),
    ...(options.declarationFingerprint ? { declarationFingerprint: options.declarationFingerprint } : {}),
  };
}

async function scanCatalog(projectRoot: string, catalogRoot: string, defaultProfile: PromptProfile): Promise<{ prompts: DiscoveredPrompt[]; errors: PromptDiscoveryIssue[] }> {
  const prompts: DiscoveredPrompt[] = [];
  const errors: PromptDiscoveryIssue[] = [];
  const files = new Set<string>();
  for (const pattern of ["*/prompt/prompt.json", "*/prompt.json", "*.prompt.json"]) {
    for await (const match of new Bun.Glob(pattern).scan({ cwd: catalogRoot, onlyFiles: true, followSymlinks: false })) files.add(match);
  }
  for (const match of [...files].sort()) {
    const file = join(catalogRoot, match);
    try {
      const parts = match.split("/");
      const agentDir = parts.length >= 3 && parts.at(-2) === "prompt" ? resolve(catalogRoot, ...parts.slice(0, -2)) : dirname(file);
      const agent = await readJson(join(agentDir, "agent.json"));
      if (agent !== undefined && !object(agent)) throw new Error("agent.json must contain an object");
      // Kernel agent manifests normalize omitted variables to an authoritative empty object.
      const declarations = object(agent) ? agent.variables ?? {} : undefined;
      const rel = relativeTarget(projectRoot, file);
      const conventionalRender = parts.at(-2) === "prompt" ? join(dirname(file), "system.md") : join(dirname(file), "prompt.rendered.md");
      prompts.push(await loadPrompt(projectRoot, file, {
        profile: object(agent) ? agent.profile ?? defaultProfile : defaultProfile,
        variables: declarations,
        declarationSource: object(agent) ? relativeTarget(projectRoot, join(agentDir, "agent.json")) : undefined,
        declarationKind: object(agent) ? "agent" : undefined,
        declarationFingerprint: object(agent) ? createHash("sha256").update(JSON.stringify(agent)).digest("hex") : undefined,
        renderedPath: relativeTarget(projectRoot, conventionalRender),
        source: "catalog",
      }));
      if (!rel) throw new Error("Invalid empty prompt path");
    } catch (error) {
      errors.push({ path: relativeTarget(projectRoot, file), detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return { prompts, errors };
}

function entries(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

async function buildProject(root: string, manifest: Manifest | undefined, conventionalCatalogs: string[]): Promise<PromptProject | undefined> {
  const prompts: DiscoveredPrompt[] = [];
  const errors: PromptDiscoveryIssue[] = [];
  const defaultProfile = profile(manifest?.profile);
  const configuredCatalogs = entries(manifest?.catalogRoots, "catalogRoots");
  const catalogSpecs = configuredCatalogs.length ? configuredCatalogs : conventionalCatalogs;
  for (const spec of catalogSpecs) {
    try {
      const path = typeof spec === "string" ? spec : object(spec) && typeof spec.path === "string" ? spec.path : undefined;
      if (!path) throw new Error("Catalog entry must be a path string or object with path");
      const catalog = await confinedExisting(root, path, "directory");
      const result = await scanCatalog(root, catalog, profile(object(spec) ? spec.profile : undefined, defaultProfile));
      prompts.push(...result.prompts); errors.push(...result.errors);
    } catch (error) { errors.push({ path: object(spec) && typeof spec.path === "string" ? spec.path : String(spec), detail: error instanceof Error ? error.message : String(error) }); }
  }
  const standalone = entries(manifest?.standalonePrompts ?? manifest?.standalone, "standalonePrompts");
  for (const spec of standalone) {
    try {
      const entry = typeof spec === "string" ? { path: spec } : spec;
      if (!object(entry) || typeof entry.path !== "string") throw new Error("Standalone entry must be a path string or object with path");
      const file = await confinedExisting(root, entry.path, "file");
      prompts.push(await loadPrompt(root, file, { id: entry.id, title: entry.title, profile: entry.profile ?? defaultProfile, renderedPath: entry.renderedPath,
        variables: entry.variables ?? entry.declaredVariables, source: "standalone", declarationSource: "codecaine.prompts.json",
        declarationKind: "standalone", declarationIdentity: entry.path,
        declarationFingerprint: createHash("sha256").update(JSON.stringify(spec)).digest("hex") }));
    } catch (error) { errors.push({ path: object(spec) && typeof spec.path === "string" ? spec.path : String(spec), detail: error instanceof Error ? error.message : String(error) }); }
  }
  if (!prompts.length && !errors.length) return undefined;
  const seen = new Set<string>();
  const unique = prompts.filter((prompt) => {
    const key = prompt.id;
    if (!seen.has(key)) { seen.add(key); return true; }
    errors.push({ path: prompt.target.promptPath, detail: `Duplicate prompt id ${key}` }); return false;
  });
  const name = typeof manifest?.name === "string" && manifest.name ? manifest.name : basename(root);
  const id = `${name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")}-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`;
  return { id, name, root, defaultProfile, prompts: unique, errors };
}

/** Discover only explicit manifests, declared workspace members, and package catalog directories. */
export async function discoverPromptProjects(input: string): Promise<PromptDiscovery> {
  const workspace = await realpath(resolve(input));
  if (!await isDirectory(workspace)) throw new Error("Workspace must be a directory");
  const warnings: string[] = [];
  const roots = new Set<string>([workspace]);
  const workspaceManifest = await readJson(join(workspace, "codecaine.prompts.json")) as Manifest | undefined;
  if (workspaceManifest !== undefined && !object(workspaceManifest)) throw new Error("codecaine.prompts.json must contain an object");
  const pkg = await readJson(join(workspace, "package.json"));
  const members = await readJson(join(workspace, "members.json"));
  if (members !== undefined && !Array.isArray(members)) throw new Error("members.json must contain an array");
  const declared = [
    ...entries(workspaceManifest?.projects, "projects"),
    ...(Array.isArray(members) ? members.map((entry) => object(entry) ? entry.dir : undefined) : []),
  ];
  for (const member of declared) {
    if (typeof member !== "string") throw new Error("projects entries must be relative paths");
    try { roots.add(await confinedExisting(workspace, member, "directory")); }
    catch (error) { warnings.push(error instanceof Error ? error.message : String(error)); }
  }
  const patterns = object(pkg) ? (Array.isArray(pkg.workspaces) ? pkg.workspaces : object(pkg.workspaces) ? pkg.workspaces.packages : undefined) : undefined;
  if (Array.isArray(patterns)) for (const pattern of patterns) {
    if (typeof pattern !== "string" || isAbsolute(pattern) || pattern.includes("**") || pattern.split("/").includes("..")) continue;
    for await (const match of new Bun.Glob(pattern).scan({ cwd: workspace, onlyFiles: false, followSymlinks: false })) {
      try { roots.add(await confinedExisting(workspace, match, "directory")); } catch { /* ignore unavailable or escaping workspace members */ }
    }
  }
  const projects: PromptProject[] = [];
  const claimedPromptFiles = new Set<string>();
  for (const root of [...roots].sort()) {
    let manifest: Manifest | undefined;
    try {
      const raw = root === workspace ? workspaceManifest : await readJson(join(root, "codecaine.prompts.json"));
      if (raw !== undefined && !object(raw)) throw new Error("manifest must contain an object");
      manifest = raw as Manifest | undefined;
      const conventions: string[] = [];
      if (await isDirectory(join(root, "catalog"))) conventions.push("catalog");
      // At the workspace root, recognize only the established package catalog directories convention.
      // Workspace members already own their catalog. Use this convention only
      // when no member roots were declared, avoiding duplicate project entries.
      if (root === workspace && roots.size === 1) for await (const match of new Bun.Glob("packages/*/catalog").scan({ cwd: root, onlyFiles: false, followSymlinks: false })) conventions.push(match);
      const project = await buildProject(root, manifest, conventions);
      if (project) {
        project.prompts = project.prompts.filter((prompt) => {
          const canonical = resolve(project.root, prompt.target.promptPath);
          if (claimedPromptFiles.has(canonical)) return false;
          claimedPromptFiles.add(canonical); return true;
        });
        if (project.prompts.length || project.errors.length) projects.push(project);
      }
    } catch (error) { warnings.push(`${root}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const configurationFingerprint = createHash("sha256").update(JSON.stringify(projects.map((project) => ({
    root: project.root,
    prompts: project.prompts.map(({ id, profile, target, source, declarationSource, declarationKind, declarationIdentity, declarationFingerprint }) =>
      ({ id, profile, target, source, declarationSource, declarationKind, declarationIdentity, declarationFingerprint })),
    errors: project.errors,
  })))).digest("hex");
  return { workspace, projects, warnings, configurationFingerprint };
}

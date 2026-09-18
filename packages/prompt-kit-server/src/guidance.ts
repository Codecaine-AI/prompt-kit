import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDocDocument } from "@codecaine-ai/docs-model/doc-schema";
import { projectToMarkdown } from "@codecaine-ai/docs-model/project-markdown";

export const GUIDANCE_SCHEMA_VERSION = 1;
export const GUIDANCE_PROFILES = ["agent", "single-output", "generic"] as const;
export type GuidanceProfile = (typeof GUIDANCE_PROFILES)[number];

export type GuidanceSourceKind = "standard" | "model" | "transaction";

export interface GuidanceSourceDefinition {
	readonly id: string;
	readonly title: string;
	readonly summary: string;
	readonly path: string;
	readonly kind: GuidanceSourceKind;
	readonly profiles: readonly GuidanceProfile[];
	readonly essentialFor: readonly GuidanceProfile[];
}

export interface GuidanceSource {
	readonly path: string;
	/** Combined identity of the canonical source bytes and rendered guidance. */
	readonly sha256: string;
	readonly sourceSha256: string;
	readonly renderedSha256: string;
	readonly kind: GuidanceSourceKind;
}

export interface GuidanceCatalogEntry {
	readonly id: string;
	readonly title: string;
	readonly summary: string;
	readonly profiles: readonly GuidanceProfile[];
}

export interface GuidanceSnapshot {
	readonly profile: GuidanceProfile;
	readonly text: string;
	readonly snapshotId: string;
	readonly sources: readonly GuidanceSource[];
	readonly references: Readonly<Record<string, string>>;
	readonly catalog: readonly GuidanceCatalogEntry[];
}

export interface LoadGuidanceOptions {
	profile?: GuidanceProfile;
	/** Repository root containing docs/. Intended for tests and embedded hosts. */
	repoRoot?: string;
	/** Generated guidance directory. Intended for tests and packaged hosts. */
	bundledRoot?: string;
	/** Force one source mode. `auto` falls back only when the canonical docs root is absent. */
	sourceMode?: "auto" | "canonical" | "bundled";
}

const ALL_PROFILES = GUIDANCE_PROFILES;

/**
 * One maintained source manifest drives external task guidance, generated
 * references, and the prompt-editor's standing context.
 */
export const GUIDANCE_SOURCE_MANIFEST: readonly GuidanceSourceDefinition[] = [
	{
		id: "placement",
		title: "Prompt placement and structure",
		summary: "Separates behavior, reference context, live state, and tools.",
		path: "docs/10-system-design/70-prompt-structure/doc.json",
		kind: "standard",
		profiles: ALL_PROFILES,
		essentialFor: ALL_PROFILES,
	},
	{
		id: "agent-structure",
		title: "Agent prompt structure",
		summary: "Canonical order and boundaries for state-navigating agent prompts.",
		path: "docs/10-system-design/70-prompt-structure/10-agent-prompt/doc.json",
		kind: "standard",
		profiles: ["agent"],
		essentialFor: ["agent"],
	},
	{
		id: "workflow",
		title: "Workflow grammar",
		summary: "Detailed phase shape, state navigation, loops, and optional fields.",
		path: "docs/10-system-design/70-prompt-structure/20-workflow/doc.json",
		kind: "standard",
		profiles: ["agent", "single-output"],
		essentialFor: ["agent"],
	},
	{
		id: "single-output-structure",
		title: "Single-output prompt structure",
		summary: "Canonical order and output contract for bounded one-call prompts.",
		path: "docs/10-system-design/70-prompt-structure/30-single-output/doc.json",
		kind: "standard",
		profiles: ["single-output"],
		essentialFor: ["single-output"],
	},
	{
		id: "quality",
		title: "Prompt quality",
		summary: "Quality dimensions, anti-patterns, and the required review pass.",
		path: "docs/10-system-design/70-prompt-structure/40-quality/doc.json",
		kind: "standard",
		profiles: ALL_PROFILES,
		essentialFor: ALL_PROFILES,
	},
	{
		id: "techniques",
		title: "Optional prompting techniques",
		summary: "Techniques selected only in response to a named failure risk.",
		path: "docs/10-system-design/70-prompt-structure/50-techniques/doc.json",
		kind: "standard",
		profiles: ALL_PROFILES,
		essentialFor: [],
	},
	{
		id: "document-model",
		title: "Canonical PromptDocument model",
		summary: "PromptDocument envelope, node vocabulary, variables, ids, and validation boundary.",
		path: "docs/10-system-design/10-canonical-prompt-object/doc.json",
		kind: "model",
		profiles: ALL_PROFILES,
		essentialFor: ALL_PROFILES,
	},
	{
		id: "authoring-model",
		title: "Prompt authoring model",
		summary: "Authoring boundaries, structured source, and model-facing output.",
		path: "docs/10-system-design/20-authoring-model/doc.json",
		kind: "model",
		profiles: ALL_PROFILES,
		essentialFor: [],
	},
	{
		id: "validation",
		title: "Validation contract",
		summary: "Structural validation guarantees and the limits of automated checks.",
		path: "docs/10-system-design/50-validation-contract/doc.json",
		kind: "model",
		profiles: ALL_PROFILES,
		essentialFor: [],
	},
	{
		id: "editing-model",
		title: "Prompt editor model",
		summary: "Structured editor projection, commits, caret behavior, and transaction history.",
		path: "docs/10-system-design/60-editor/10-editing-model/doc.json",
		kind: "transaction",
		profiles: ALL_PROFILES,
		essentialFor: [],
	},
	{
		id: "transactions",
		title: "Prompt edit operation guide",
		summary: "Shared id-relative operation vocabulary, examples, ordering, and repair rules.",
		path: "docs/10-system-design/90-external-authoring/20-operations/doc.json",
		kind: "transaction",
		profiles: ALL_PROFILES,
		essentialFor: ALL_PROFILES,
	},
] as const;

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const DEFAULT_BUNDLED_ROOT = join(PACKAGE_ROOT, "guidance");
const GENERATED_PREFIX = "<!-- Generated by @codecaine-ai/prompt-kit-server guidance; ";

export const hashGuidanceContent = (content: string): string =>
	createHash("sha256").update(content).digest("hex");

/** Validate one native Docs document and project it to model-readable Markdown. */
export function renderGuidanceSource(path: string, content: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(`Prompt guidance is not valid JSON: ${path}`);
	}
	const validated = validateDocDocument(parsed);
	if (!validated.ok) {
		throw new Error(
			`Prompt guidance is structurally invalid: ${path}: ${JSON.stringify(validated.issues)}`,
		);
	}
	return projectToMarkdown(validated.document);
}

function sourceProvenance(
	path: string,
	kind: GuidanceSourceKind,
	sourceContent: string,
	renderedContent: string,
): GuidanceSource {
	const sourceSha256 = hashGuidanceContent(sourceContent);
	const renderedSha256 = hashGuidanceContent(renderedContent);
	return {
		path,
		kind,
		sourceSha256,
		renderedSha256,
		sha256: hashGuidanceContent(JSON.stringify({ sourceSha256, renderedSha256 })),
	};
}

function assertProfile(profile: string): asserts profile is GuidanceProfile {
	if (!(GUIDANCE_PROFILES as readonly string[]).includes(profile)) {
		throw new Error(
			`Unknown guidance profile: ${profile}. Expected ${GUIDANCE_PROFILES.join(", ")}.`,
		);
	}
}

function stripFrontmatter(content: string): string {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, "").trim();
}

function generatedBody(content: string, file: string): string {
	if (!content.startsWith(GENERATED_PREFIX)) {
		throw new Error(`Bundled guidance lacks generated provenance: ${file}`);
	}
	const end = content.indexOf("-->\n");
	if (end < 0) throw new Error(`Bundled guidance has invalid provenance: ${file}`);
	return content.slice(end + 4);
}

export function assembleGuidanceText(
	profile: GuidanceProfile,
	contents: Readonly<Record<string, string>>,
): string {
	assertProfile(profile);
	const selected = GUIDANCE_SOURCE_MANIFEST.filter((source) =>
		source.essentialFor.includes(profile),
	);
	return selected
		.map((source) => {
			const content = contents[source.id];
			if (content === undefined) {
				throw new Error(`Missing required guidance source: ${source.path}`);
			}
			return `## ${source.title}\n\n${stripFrontmatter(content)}`;
		})
		.join("\n\n---\n\n");
}

function buildSnapshot(
	profile: GuidanceProfile,
	contents: Readonly<Record<string, string>>,
	sources: readonly GuidanceSource[],
): GuidanceSnapshot {
	const references = Object.freeze({ ...contents });
	const catalog = Object.freeze(
		GUIDANCE_SOURCE_MANIFEST.filter((source) => source.profiles.includes(profile)).map(
			(source) =>
				Object.freeze({
					id: source.id,
					title: source.title,
					summary: source.summary,
					profiles: Object.freeze([...source.profiles]),
				}),
		),
	);
	const text = assembleGuidanceText(profile, contents);
	const frozenSources = Object.freeze(sources.map((source) => Object.freeze({ ...source })));
	const snapshotId = `sha256:${hashGuidanceContent(
		JSON.stringify({
			version: GUIDANCE_SCHEMA_VERSION,
			profile,
			sources: frozenSources,
			text,
			references,
			catalog,
		}),
	)}`;
	return Object.freeze({
		profile,
		text,
		snapshotId,
		sources: frozenSources,
		references,
		catalog,
	});
}

async function canonicalAvailable(repoRoot: string): Promise<boolean> {
	const checks = await Promise.all(
		GUIDANCE_SOURCE_MANIFEST.map(async (source) => {
			try {
				await access(join(repoRoot, source.path));
				return true;
			} catch {
				return false;
			}
		}),
	);
	// One canonical file means this is a checkout and the full corpus is
	// required. Zero means this is a packaged install and the bundle is used.
	return checks.some(Boolean);
}

async function loadCanonical(
	repoRoot: string,
	profile: GuidanceProfile,
): Promise<GuidanceSnapshot> {
	const entries = await Promise.all(
		GUIDANCE_SOURCE_MANIFEST.map(async (source) => {
			const file = join(repoRoot, source.path);
			let sourceContent: string;
			try {
				sourceContent = await readFile(file, "utf8");
			} catch (error) {
				throw new Error(`Canonical guidance source is unavailable: ${source.path}`, {
					cause: error,
				});
			}
			const content = renderGuidanceSource(source.path, sourceContent);
			return {
				source,
				content,
				provenance: sourceProvenance(
					source.path,
					source.kind,
					sourceContent,
					content,
				),
			};
		}),
	);
	return buildSnapshot(
		profile,
		Object.fromEntries(entries.map(({ source, content }) => [source.id, content])),
		entries.map(({ provenance }) => provenance),
	);
}

async function loadBundled(
	bundledRoot: string,
	profile: GuidanceProfile,
): Promise<GuidanceSnapshot> {
	let manifest: { schemaVersion?: number; sources?: GuidanceSource[] };
	try {
		manifest = JSON.parse(await readFile(join(bundledRoot, "snapshot.json"), "utf8"));
	} catch (error) {
		throw new Error(`Bundled guidance snapshot is unavailable: ${bundledRoot}`, {
			cause: error,
		});
	}
	if (manifest.schemaVersion !== GUIDANCE_SCHEMA_VERSION || !Array.isArray(manifest.sources)) {
		throw new Error(`Bundled guidance snapshot is incompatible: ${bundledRoot}`);
	}
	const expected = new Map(manifest.sources.map((source) => [source.path, source]));
	const entries = await Promise.all(
		GUIDANCE_SOURCE_MANIFEST.map(async (source) => {
			const file = join(bundledRoot, "references", "details", `${source.id}.md`);
			let content: string;
			try {
				content = generatedBody(await readFile(file, "utf8"), file);
			} catch (error) {
				throw new Error(`Bundled guidance reference is unavailable: ${source.id}`, {
					cause: error,
				});
			}
			const provenance = expected.get(source.path);
			if (
				!provenance ||
				hashGuidanceContent(content) !== provenance.renderedSha256 ||
				provenance.sha256 !==
					hashGuidanceContent(
						JSON.stringify({
							sourceSha256: provenance.sourceSha256,
							renderedSha256: provenance.renderedSha256,
						}),
					)
			) {
				throw new Error(`Bundled guidance reference failed provenance check: ${source.id}`);
			}
			return { source, content, provenance };
		}),
	);
	return buildSnapshot(
		profile,
		Object.fromEntries(entries.map(({ source, content }) => [source.id, content])),
		entries.map(({ provenance }) => provenance),
	);
}

/** Read maintained native Docs sources on every call, or use a generated package bundle. */
export async function loadGuidance(
	options: LoadGuidanceOptions = {},
): Promise<GuidanceSnapshot> {
	const profile = options.profile ?? "generic";
	assertProfile(profile);
	const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
	const bundledRoot = resolve(options.bundledRoot ?? DEFAULT_BUNDLED_ROOT);
	const mode = options.sourceMode ?? "auto";
	if (mode === "canonical") return loadCanonical(repoRoot, profile);
	if (mode === "bundled") return loadBundled(bundledRoot, profile);
	return (await canonicalAvailable(repoRoot))
		? loadCanonical(repoRoot, profile)
		: loadBundled(bundledRoot, profile);
}

function renderCatalog(snapshot: GuidanceSnapshot): string {
	return GUIDANCE_SOURCE_MANIFEST
		.map(
			(entry) =>
				`- [${entry.title}](details/${entry.id}.md)\n  - ${entry.summary}\n  - Profiles: ${entry.profiles.join(", ")}`,
		)
		.join("\n");
}

/** Render the same maintained sources into a portable skill/package directory. */
export async function generateSkillReferences(
	outputDir: string,
	guidance?: GuidanceSnapshot,
): Promise<void> {
	const snapshot = guidance ?? (await loadGuidance());
	const referencesDir = join(outputDir, "references");
	const detailsDir = join(referencesDir, "details");
	await mkdir(detailsDir, { recursive: true });
	const stamp = `${GENERATED_PREFIX}snapshot ${snapshot.snapshotId}. Refresh the installation to regenerate. -->\n`;
	await Promise.all([
		writeFile(
			join(referencesDir, "standards.md"),
			`${stamp}# Prompt Authoring Guidance\n\n${snapshot.text}\n`,
		),
		writeFile(
			join(referencesDir, "catalog.md"),
			`${stamp}# Prompt Guidance Catalog\n\n${renderCatalog(snapshot)}\n`,
		),
		...GUIDANCE_SOURCE_MANIFEST.map((source) =>
			writeFile(
				join(detailsDir, `${source.id}.md`),
				`${stamp}${snapshot.references[source.id] ?? ""}`,
			),
		),
		writeFile(
			join(outputDir, "snapshot.json"),
			`${JSON.stringify(
				{
					schemaVersion: GUIDANCE_SCHEMA_VERSION,
					snapshotId: snapshot.snapshotId,
					profile: snapshot.profile,
					sources: snapshot.sources,
				},
				null,
				2,
			)}\n`,
		),
	]);
}

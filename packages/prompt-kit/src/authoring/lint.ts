import type { PromptBlockNode, PromptDocument, SectionNode } from "../document/nodes/types";
import { validatePrompt } from "../document/validate";
import type { PromptLintFinding, PromptLintProfile } from "./types";

const AGENT_ORDER = ["purpose", "goal", "state_structure", "workflow", "error_handling", "success_criteria", "rules"] as const;
const SINGLE_OUTPUT_ORDER = ["purpose", "instructions", "workflow", "output_format", "constraints"] as const;
const AGENT_REQUIRED = ["purpose", "state_structure", "workflow", "rules"] as const;
const SINGLE_OUTPUT_REQUIRED = ["purpose", "instructions", "output_format", "constraints"] as const;
const AGENT_FORBIDDEN = new Set(["instructions", "output_format", "constraints", "tools", "examples", "reminders", "state", "inputs", "context"]);
const SINGLE_OUTPUT_FORBIDDEN = new Set(["goal", "state_structure", "error_handling", "success_criteria", "rules", "tools", "examples", "reminders", "state", "inputs", "context"]);

/** Deterministic integrity and writing-profile checks for an authored prompt. */
export function lintPrompt(doc: PromptDocument, profile: PromptLintProfile): PromptLintFinding[] {
	const findings: PromptLintFinding[] = validatePrompt(doc).diagnostics.map((diagnostic) => ({
		code: diagnostic.code,
		severity: diagnostic.severity,
		message: diagnostic.message,
		...(diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : {}),
	}));
	if (profile === "generic") return findings;

	const sections = doc.nodes.filter((node): node is SectionNode => node.type === "section");
	const byTag = new Map<string, SectionNode[]>();
	for (const section of sections) {
		const entries = byTag.get(section.tag) ?? [];
		entries.push(section);
		byTag.set(section.tag, entries);
	}
	const required = profile === "agent" ? AGENT_REQUIRED : SINGLE_OUTPUT_REQUIRED;
	const order = profile === "agent" ? AGENT_ORDER : SINGLE_OUTPUT_ORDER;
	const forbidden = profile === "agent" ? AGENT_FORBIDDEN : SINGLE_OUTPUT_FORBIDDEN;

	for (const tag of required) {
		if (!byTag.has(tag)) findings.push({ code: "profile_missing_section", severity: "error", message: `${profile} prompts require a top-level <${tag}> section.` });
	}
	for (const [tag, matches] of byTag) {
		if (matches.length > 1) findings.push({ code: "profile_duplicate_section", severity: "error", message: `${profile} prompts must not repeat the top-level <${tag}> section.`, nodeId: matches[1]?.id });
		if (forbidden.has(tag)) findings.push({ code: "profile_forbidden_section", severity: "error", message: `<${tag}> is not a valid top-level section for the ${profile} profile.`, nodeId: matches[0]?.id });
	}

	let previous = -1;
	for (const section of sections) {
		const position = order.indexOf(section.tag as never);
		if (position < 0) continue;
		if (position < previous) {
			findings.push({ code: "profile_section_order", severity: "error", message: `<${section.tag}> is out of order for the ${profile} profile. Expected order: ${order.map((tag) => `<${tag}>`).join(", ")}.`, nodeId: section.id });
		} else previous = position;
	}
	const finalTag = profile === "agent" ? "rules" : "constraints";
	const lastSection = sections.at(-1);
	if (lastSection && lastSection.tag !== finalTag) {
		findings.push({ code: "profile_final_section", severity: "error", message: `<${finalTag}> must be the final top-level section for the ${profile} profile.`, nodeId: lastSection.id });
	}

	if (profile === "agent") {
		const workflow = byTag.get("workflow")?.[0];
		if (workflow) lintAgentWorkflow(workflow, findings);
	}
	return findings;
}

function lintAgentWorkflow(workflow: SectionNode, findings: PromptLintFinding[]): void {
	const phases = workflow.children.filter((node): node is SectionNode => node.type === "section" && node.tag === "phase");
	if (phases.length === 0) {
		findings.push({ code: "workflow_missing_phase", severity: "error", message: "Agent <workflow> must contain at least one <phase> section.", nodeId: workflow.id });
		return;
	}
	for (const phase of phases) {
		const fields = phase.children.filter((node): node is SectionNode => node.type === "section");
		if (!fields.some((node) => node.tag === "objective")) findings.push({ code: "workflow_phase_missing_objective", severity: "error", message: "Each workflow <phase> requires an <objective> section.", nodeId: phase.id });
		const steps = fields.find((node) => node.tag === "steps");
		if (!steps) findings.push({ code: "workflow_phase_missing_steps", severity: "error", message: "Each workflow <phase> requires a <steps> section.", nodeId: phase.id });
		else if (!containsOrderedList(steps.children)) findings.push({ code: "workflow_steps_not_numbered", severity: "error", message: "Workflow <steps> must contain a numbered list.", nodeId: steps.id });
	}
}

function containsOrderedList(nodes: readonly PromptBlockNode[]): boolean {
	return nodes.some((node) => node.type === "orderedList");
}

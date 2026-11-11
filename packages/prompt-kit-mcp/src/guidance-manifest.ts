/**
 * The Prompt Kit guidance contract: the fixed fields of the prompts_capabilities index, the topic each write needs,
 * and the refusal a write gets before that read.
 */

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

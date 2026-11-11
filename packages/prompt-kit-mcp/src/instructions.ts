/**
 * The Prompt Kit prompt block. MCP clients get it as the server instructions, the Pi bridge appends it to the system
 * prompt, and agent-config copies it from `cli.ts instructions`. It says when to use the Prompt Kit tools and which
 * tool to call first. The rules live in prompts_guidance topics. At most 12 lines and 800 bytes (mcp.test.ts).
 * Pi loads this file under Node, so it imports nothing.
 */
export const MCP_INSTRUCTIONS = [
  "Use the Prompt Kit tools to read and edit model-facing prompts. Never rewrite prompt JSON or rendered Markdown directly.",
  "Call prompts_capabilities first for the project ids, the guidance topics and the writes each topic unlocks.",
  "Find prompts with prompts_discover. Pass project to list one project's prompts.",
  'To edit, call prompts_begin, then read prompts_guidance with task_id and topic "standards". prompts_apply_ops is refused until then.',
  'Topic "workflow" holds the edit steps, and topic "work-requests" holds the request rules.',
  "Edit with prompts_apply_ops, passing task_id and the prompts_read hash as expected_hash.",
  "Run prompts_check with task_id on each changed prompt before you report.",
  "After context compaction, call prompts_capabilities again and re-read the topics your next writes need.",
].join("\n");

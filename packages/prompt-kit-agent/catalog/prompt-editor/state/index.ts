/**
 * Section ③ — the prompt-editor's state sidecar (state/index.ts, discovered
 * by the registry's filename convention).
 *
 * The live session picture — WHICH prompt is being edited, its node-id-stamped
 * render, the base hash proposals build on, the transactions applied so far,
 * and the open request queue — is STATE, not context: it changes per session
 * and per turn, so it renders as the kernel-authored `kernel:state` message at
 * the head of section ③, not as standing knowledge in section ②. The context
 * sidecar (../context/index.ts) carries the authoring reference only.
 *
 * Seed contract — the same payload the session service delivers at spawn:
 *
 *   sessionData.targetAgent         string — the target agent's catalog name
 *   sessionData.targetPromptRender  string — node-id-stamped render of the
 *                                   target prompt
 *   sessionData.targetPromptHash    string — canonical hash (pk1-…) of that
 *                                   document
 *   sessionData.appliedDiffs        string — ordered applied-transaction log
 *                                   for this session
 *   sessionData.requestQueue        string — the rendered queue body, one
 *                                   R-alias entry per open request
 *
 * Any missing key degrades to a labelled placeholder instead of failing the
 * spawn, so the bundle boots (and previews) without a live session.
 */
import { defineState } from "@agent-kernel/kernel/agent-definition";
import type { SpawnContext } from "@agent-kernel/kernel/context";
import {
	kernelStateMessage,
	renderRollingWindow,
	type RenderContext,
	type RenderResult,
	type SessionEvent,
} from "@agent-kernel/kernel/state";
import { block } from "../../shared/xml";

/** The prompt-editor's state `S`. Plain strings — snapshots to state.json. */
export interface PromptEditorState {
	targetAgent: string;
	targetPromptRender: string;
	targetPromptHash: string;
	appliedDiffs: string;
	requestQueue: string;
}

const RENDER_PLACEHOLDER =
	"(target prompt not loaded — the session service sets sessionData.targetPromptRender to the node-id-stamped render)";
const QUEUE_PLACEHOLDER =
	"(no open requests — the session service sets sessionData.requestQueue to the rendered queue)";
const DIFFS_PLACEHOLDER =
	"(no diffs applied yet — the session service sets sessionData.appliedDiffs to the applied-transaction log)";

function sessionString(ctx: SpawnContext, key: string): string | null {
	const value = ctx.sessionData?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function seed(
	ctx: SpawnContext,
	prior?: PromptEditorState,
): PromptEditorState {
	if (prior) return { ...prior };
	return {
		targetAgent: sessionString(ctx, "targetAgent") ?? "(unset)",
		targetPromptRender:
			sessionString(ctx, "targetPromptRender") ?? RENDER_PLACEHOLDER,
		targetPromptHash: sessionString(ctx, "targetPromptHash") ?? "(unset)",
		appliedDiffs: sessionString(ctx, "appliedDiffs") ?? DIFFS_PLACEHOLDER,
		requestQueue: sessionString(ctx, "requestQueue") ?? QUEUE_PLACEHOLDER,
	};
}

/**
 * v1 pass-through: the session service and the edit tools own every state
 * change (re-rendering the queue, staging proposals), so no kernel session
 * event moves this state. `update` exists to satisfy the contract and to be
 * the seam a later version folds events into.
 */
function update(
	state: PromptEditorState,
	_event: SessionEvent,
): PromptEditorState {
	return state;
}

/**
 * One kernel:state message — <target_prompt>, <diffs>, then <requests> —
 * followed by the default rolling window over the live conversation (section
 * ③'s tail; dropping it would erase the transcript from the request). The
 * state block counts as 1; the base renderer's elision marker, when history
 * was cut, adds its own count on top.
 */
function render(state: PromptEditorState, ctx: RenderContext): RenderResult {
	const body = [
		block(
			"target_prompt",
			`agent="${state.targetAgent}" hash="${state.targetPromptHash}"`,
			state.targetPromptRender,
		),
		block("diffs", "", state.appliedDiffs),
		block("requests", "", state.requestQueue),
	].join("\n\n");
	const tail = renderRollingWindow(ctx);
	return {
		messages: [kernelStateMessage(body), ...tail.messages],
		stateMessageCount: 1 + (tail.stateMessageCount ?? 0),
	};
}

export const state = defineState<PromptEditorState>({ seed, update, render });
export default state;

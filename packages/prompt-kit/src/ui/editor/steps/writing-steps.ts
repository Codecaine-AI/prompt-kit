import type { PromptBlockNode, PromptDocument } from "../../../index";
import { editableTextToInline, getPromptBlockNodeById } from "../model";
import { insertPromptBlockNodeWithStep, type PromptStep } from "../transactions";
import { matchAutoformatMarker } from "../buffer/autoformat";
import { collectPromptIds } from "../../../document/nodes/ids";
import { appendPastedListItem, pastedListMarker, type PastedListStack } from "./list-item-steps";
import { splitParagraphSteps } from "./node-mutations";
import { convertParagraphToStep, replaceBlockWithStep, type StructureStepResult } from "./structure-steps";

/** Convert just the logical line at the caret, retaining surrounding prose. */
export function autoformatParagraphLine(
	prompt: PromptDocument, nodeId: string, next: string, start: number, end: number,
): StructureStepResult | null {
	const marker = matchAutoformatMarker(next.slice(start, end));
	if (!marker || marker.target === "codeBlock" || marker.target === "section") return null;
	let doc = prompt;
	let id = nodeId;
	const steps: PromptStep[] = [];
	if (start > 0) {
		const split = splitParagraphSteps(doc, id, next.slice(0, start - 1), next.slice(start));
		if (!split.focusNodeId) return null;
		doc = split.prompt;
		id = split.focusNodeId;
		steps.push(...split.steps);
	}
	if (end < next.length) {
		const split = splitParagraphSteps(doc, id, next.slice(start, end), next.slice(end + 1));
		doc = split.prompt;
		steps.push(...split.steps);
	}
	const converted = convertParagraphToStep(doc, id, marker.target, {content: editableTextToInline(marker.rest)});
	if (!converted) return null;
	return {...converted, steps: [...steps, ...converted.steps], caretOffset: 0};
}

/** Paste ordinary lines as paragraphs and Markdown list runs as real lists. */
export function pasteParagraphLines(
	prompt: PromptDocument, nodeId: string, value: string, caret: number,
): StructureStepResult | null {
	if (getPromptBlockNodeById(prompt, nodeId)?.node.type !== "paragraph") return null;
	const blocks: PromptBlockNode[] = [];
	let offset = 0;
	let focusBlock = 0;
	let focusItemIndex: number | undefined;
	let caretOffset = 0;
	let nestedFocusId: string | undefined;
	const used = collectPromptIds(prompt);
	const stack: PastedListStack = [];
	for (const text of value.split("\n")) {
		const marker = pastedListMarker(text);
		const content = editableTextToInline(text.slice(marker?.length ?? 0));
		let itemIndex: number | undefined;
		let listId: string | undefined;
		if (marker) {
			const target = appendPastedListItem(blocks, stack, marker, content, used);
			itemIndex = target.itemIndex;
			if (target.list !== blocks.at(-1)) listId = target.list.id;
		} else {
			stack.length = 0;
			blocks.push({type: "paragraph", content});
		}
		if (caret >= offset && caret <= offset + text.length) {
			focusBlock = blocks.length - 1;
			focusItemIndex = itemIndex;
			nestedFocusId = listId;
			caretOffset = Math.max(0, caret - offset - (marker?.length ?? 0));
		}
		offset += text.length + 1;
	}
	const first = replaceBlockWithStep(prompt, nodeId, {...blocks[0]!, id: nodeId});
	if (!first.step && blocks.length === 1) return null;
	const steps: PromptStep[] = first.step ? [first.step] : [];
	let doc = first.prompt;
	let previousId = nodeId;
	let focusNodeId = nodeId;
	for (let index = 1; index < blocks.length; index++) {
		const inserted = insertPromptBlockNodeWithStep(doc, previousId, blocks[index]!, "after");
		if (inserted.step?.op !== "insert" || !inserted.step.node.id) return null;
		doc = inserted.prompt;
		steps.push(inserted.step);
		previousId = inserted.step.node.id;
		if (index === focusBlock) focusNodeId = previousId;
	}
	return {prompt: doc, steps, focusNodeId: nestedFocusId ?? focusNodeId, focusItemIndex, caretOffset};
}

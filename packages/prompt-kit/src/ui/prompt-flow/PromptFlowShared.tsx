"use client";

import cn from "classnames";
import {
	Braces,
	List,
	ListOrdered,
	SquareCode,
	Type,
	type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import type {
	PromptBlockNode,
	PromptDocument,
} from "../../index";
import {
	createPromptBlockTemplate,
	duplicatePromptBlockNodeByIdWithStep,
	insertPromptBlockNodeWithStep,
	movePromptBlockNodeByIdWithStep,
	removePromptBlockNodeByIdWithStep,
	updatePromptBlockNodeByIdWithStep,
	type PromptBlockNodeType,
	type PromptEditorTreeEntry,
	type PromptStep,
} from "../editors";

import type { PromptFlowViewProps } from "./types";

export type DropSide = "before" | "after";

export type InsertOption = {
	type: PromptBlockNodeType;
	label: string;
	icon: LucideIcon;
};

/**
 * The insertable vocabulary: everything a prompt is authored from, and nothing
 * else. Prompt-kit still models `field`, `contextUsage`, `example`, and `raw` —
 * documents containing them keep rendering and editing — but they are not
 * offered as new blocks.
 *
 * Icons are chosen for an XML surface, not a Markdown one: no heading ranks, no
 * chat bubbles. `Braces` gives Section an open/close wrapper glyph (a section is
 * a `<tag>…</tag>` around children), `Type` says "plain text" without implying a
 * message, and `SquareCode` reads "a block of code" — the bare `</>` it replaces
 * reads as a tag on this surface, which is the Section idea, not the Code one.
 */
export const INSERT_OPTIONS: readonly InsertOption[] = [
	{ type: "paragraph", label: "Text", icon: Type },
	{ type: "section", label: "Section", icon: Braces },
	{ type: "bulletList", label: "Bullets", icon: List },
	{ type: "orderedList", label: "Steps", icon: ListOrdered },
	{ type: "codeBlock", label: "Code", icon: SquareCode },
];

/** Icon for an insertable block type, for surfaces that render their own rows. */
export function insertOptionIcon(type: PromptBlockNodeType): LucideIcon | undefined {
	return INSERT_OPTIONS.find((option) => option.type === type)?.icon;
}

export function usePromptFlowInteractions({
	prompt,
	model,
	selectedNodeId,
	onPromptChange,
}: PromptFlowViewProps) {
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<{ id: string; side: DropSide } | null>(null);
	const activeId = selectedNodeId;

	function insertBlock(type: PromptBlockNodeType, targetId: string | null, position: "after" | "child" = "after") {
		const node = createPromptBlockTemplate(type, prompt);
		const result = insertPromptBlockNodeWithStep(prompt, targetId, node, position);
		if (result.step) {
			// The inserted id may differ from the template's when ids collide.
			const insertedId =
				result.step.op === "insert" ? result.step.node.id : node.id;
			onPromptChange(result.prompt, insertedId, [result.step]);
		}
	}

	function removeBlock(entry: PromptEditorTreeEntry) {
		const result = removePromptBlockNodeByIdWithStep(prompt, entry.id);
		if (result.step) {
			onPromptChange(
				result.prompt,
				getNextSelectionAfterRemove(model.tree, entry),
				[result.step],
			);
		}
		setDraggingId(null);
		setDropTarget(null);
	}

	function duplicateBlock(id: string) {
		const result = duplicatePromptBlockNodeByIdWithStep(prompt, id);
		if (result.step) {
			const insertedId =
				result.step.op === "insert" ? result.step.node.id : id;
			onPromptChange(result.prompt, insertedId, [result.step]);
		}
	}

	function moveNear(sourceId: string, targetId: string, side: DropSide) {
		const source = model.tree.find((entry) => entry.id === sourceId);
		const target = model.tree.find((entry) => entry.id === targetId);
		if (!source || !target || source.id === target.id) return;
		if (!samePath(source.parentPath, target.parentPath)) return;

		const desiredIndex = target.index + (side === "after" ? 1 : 0);
		let nextPrompt = prompt;
		let currentIndex = source.index;
		let targetIndex = desiredIndex;
		const steps: PromptStep[] = [];

		if (source.index < desiredIndex) targetIndex -= 1;

		while (currentIndex < targetIndex) {
			const result = movePromptBlockNodeByIdWithStep(nextPrompt, source.id, "down");
			nextPrompt = result.prompt;
			if (result.step) steps.push(result.step);
			currentIndex += 1;
		}
		while (currentIndex > targetIndex) {
			const result = movePromptBlockNodeByIdWithStep(nextPrompt, source.id, "up");
			nextPrompt = result.prompt;
			if (result.step) steps.push(result.step);
			currentIndex -= 1;
		}

		if (steps.length > 0) onPromptChange(nextPrompt, source.id, steps);
	}

	function canDropOn(entry: PromptEditorTreeEntry) {
		if (!draggingId || draggingId === entry.id) return false;
		const source = model.tree.find((candidate) => candidate.id === draggingId);
		return Boolean(source && samePath(source.parentPath, entry.parentPath));
	}

	function handleDragOver(event: React.DragEvent<HTMLElement>, entry: PromptEditorTreeEntry) {
		if (!canDropOn(entry)) return;
		event.preventDefault();
		setDropTarget({ id: entry.id, side: getDropSide(event) });
	}

	function handleDrop(event: React.DragEvent<HTMLElement>, entry: PromptEditorTreeEntry) {
		event.preventDefault();
		if (draggingId && canDropOn(entry)) moveNear(draggingId, entry.id, getDropSide(event));
		setDraggingId(null);
		setDropTarget(null);
	}

	function handleDragEnd() {
		setDraggingId(null);
		setDropTarget(null);
	}

	return {
		activeId,
		draggingId,
		dropTarget,
		insertBlock,
		removeBlock,
		duplicateBlock,
		canDropOn,
		moveNear,
		setDropTarget,
		handleDragOver,
		handleDrop,
		handleDragEnd,
		setDraggingId,
		isDropBefore: (entry: PromptEditorTreeEntry) =>
			canDropOn(entry) && dropTarget?.id === entry.id && dropTarget.side === "before",
		isDropAfter: (entry: PromptEditorTreeEntry) =>
			canDropOn(entry) && dropTarget?.id === entry.id && dropTarget.side === "after",
	};
}

export function DropLines({
	dropBefore,
	dropAfter,
	leftClassName = "left-[4.5rem]",
}: {
	dropBefore: boolean;
	dropAfter: boolean;
	leftClassName?: string;
}) {
	return (
		<>
			<div
				className={cn(
					"pointer-events-none absolute right-0 top-0 h-px bg-status-success opacity-0",
					leftClassName,
					dropBefore && "opacity-100",
				)}
			/>
			<div
				className={cn(
					"pointer-events-none absolute bottom-0 right-0 h-px bg-status-success opacity-0",
					leftClassName,
					dropAfter && "opacity-100",
				)}
			/>
		</>
	);
}

export function InsertPalette({
	canInsertChild,
	onInsert,
	onInsertChild,
}: {
	canInsertChild: boolean;
	onInsert: (type: PromptBlockNodeType) => void;
	onInsertChild: (type: PromptBlockNodeType) => void;
}) {
	return (
		<div className="w-fit max-w-full rounded-[4px] border border-border bg-card p-2 shadow-lg">
			<div className="flex flex-wrap items-center gap-1">
				<span className="mr-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
					Add
				</span>
				{INSERT_OPTIONS.map((option) => (
					<PaletteButton
						key={option.type}
						label={option.label}
						icon={option.icon}
						onClick={() => onInsert(option.type)}
					/>
				))}
			</div>
			{canInsertChild && (
				<div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-border/70 pt-1.5">
					<span className="mr-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
						Inside
					</span>
					{INSERT_OPTIONS.map((option) => (
						<PaletteButton
							key={option.type}
							label={option.label}
							icon={option.icon}
							onClick={() => onInsertChild(option.type)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export function EmptyFlow({ onInsert }: { onInsert: (type: PromptBlockNodeType) => void }) {
	return (
		<div className="rounded-[4px] border border-dashed border-border bg-card/70 p-5">
			<p className="mb-3 text-[13px] text-muted-foreground">Start with a block.</p>
			<InsertPalette canInsertChild={false} onInsert={onInsert} onInsertChild={onInsert} />
		</div>
	);
}

export function PlainTextArea({
	value,
	onChange,
	placeholder,
	className,
	spellCheck,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	className?: string;
	spellCheck?: boolean;
}) {
	return (
		<textarea
			value={value}
			onChange={(event) => onChange(event.target.value)}
			placeholder={placeholder}
			rows={estimateWrappedRows(value)}
			className={cn(
				"min-h-8 w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/35",
				className,
			)}
			spellCheck={spellCheck}
		/>
	);
}

export function updateNode(
	prompt: PromptDocument,
	entry: PromptEditorTreeEntry,
	onPromptChange: PromptFlowViewProps["onPromptChange"],
	updater: (node: PromptBlockNode) => PromptBlockNode,
) {
	const result = updatePromptBlockNodeByIdWithStep(prompt, entry.id, updater);
	if (!result.step) return;
	onPromptChange(result.prompt, entry.id, [result.step]);
}

export function canHaveChildren(node: PromptBlockNode): boolean {
	return (
		node.type === "section" ||
		node.type === "example" ||
		node.type === "contextUsage" ||
		node.type === "field"
	);
}

export function samePath(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
	return a.length === b.length && a.every((part, index) => part === b[index]);
}

export function humanizeTag(tag: string): string {
	return tag.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeTag(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return normalized || "section";
}

export function inputWidth(value: string, minimum = 5, maximum = 32): string {
	return `${Math.min(maximum, Math.max(minimum, value.length + 1))}ch`;
}

function PaletteButton({
	label,
	icon: Icon,
	onClick,
}: {
	label: string;
	icon: LucideIcon;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex h-7 items-center gap-1.5 rounded-[2px] px-2 text-[12px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
		>
			<Icon size={13} />
			{label}
		</button>
	);
}

function estimateWrappedRows(value: string): number {
	if (value.length === 0) return 1;
	return Math.max(
		1,
		value
			.split("\n")
			.reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 88)), 0),
	);
}

function getDropSide(event: React.DragEvent<HTMLElement>): DropSide {
	const bounds = event.currentTarget.getBoundingClientRect();
	return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function getNextSelectionAfterRemove(
	tree: readonly PromptEditorTreeEntry[],
	entry: PromptEditorTreeEntry,
): string | undefined {
	const nextSibling = tree.find(
		(candidate) =>
			samePath(candidate.parentPath, entry.parentPath) &&
			candidate.index === entry.index + 1,
	);
	if (nextSibling) return nextSibling.id;

	const previousSibling = tree.find(
		(candidate) =>
			samePath(candidate.parentPath, entry.parentPath) &&
			candidate.index === entry.index - 1,
	);
	if (previousSibling) return previousSibling.id;

	const parentEntry = tree.find((candidate) =>
		samePath(candidate.path, entry.parentPath.slice(0, -1)),
	);
	return parentEntry?.id;
}

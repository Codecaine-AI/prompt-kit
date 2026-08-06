// Slice: composition root for the Agent XML editing surface — layout + wiring
// only; row rendering, affordances, drag, and mutations live in siblings.
"use client";

import cn from "classnames";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PromptBlockNode } from "../../../index";
import {
	editableTextToInline,
	type PromptEditorTreeEntry,
} from "../model";

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
	LINE_HEIGHT_PX,
	PROMPT_EDITOR_ROOT_CLASS,
	editorTypeStyle,
	PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH,
	promptEditorGutterWidth,
} from "../../surface/editor-surface";
import {
	EmptyFlow,
	canHaveChildren,
	usePromptFlowInteractions,
} from "../shared";
import type {
	PromptFlowChangeHandler,
	PromptFlowViewProps,
} from "../types";
import { buildXmlLineModel, type XmlLine } from "../../../document/render/line-model";
import { resolveAutoformat } from "./autoformat";
import { caretAnchor } from "./caret-rect";
import { DragGhost, DropIndicator, useXmlDrag } from "./drag-controller";
import type { ItemDropCommand } from "./drop-targeting";
import type { PromptStep } from "../transactions";
import {
	blockHandleUnit,
	itemHandleUnit,
	resolveDragHandleUnit,
} from "./drag-handle";
import {
	handleEditorKey,
	type EditTarget,
	type EditorKeyContext,
} from "./editor-keymap";
import { moveBlocksStep, removeBlocksStep } from "../steps/block-run-steps";
import {
	duplicateListItemStep,
	getListById,
	moveListItemsAcrossStep,
	nestListItemStep,
	removeListItemStep,
	removeListItemsStep,
	removeListWithStep,
	unnestListItemStep,
} from "../steps/list-item-steps";
import {
	resolveMarqueeSelection,
	structuralSelectionRun,
	type StructuralSelection,
} from "../structural-selection";
import {
	computeGuides,
	computeItemRanges,
	computeLandmarks,
	computeNodeRanges,
	promptFlowIndentForDepth,
	trimPaintedNodeRange,
	useRowMetrics,
} from "./node-geometry";
import {
	commitEdit,
	editorValueForLine,
	findUnnestLocation,
	registerNestedLists,
	retagSection,
} from "../steps/node-mutations";
import {
	SectionOutline,
	outlineSectionLabel,
	type OutlineSection,
} from "./SectionOutline";
import type { SlashCommand } from "./slash-commands";
import {
	SlashMenu,
	slashMenuOptionId,
	SLASH_MENU_LISTBOX_ID,
	type SlashMenuAnchor,
} from "./SlashMenu";
import {
	advanceSlashSession,
	moveSlashSelection,
	selectedSlashCommand,
	shouldOpenSlash,
	type SlashSession,
} from "./slash-session";
import {
	convertBlockToParagraphStep,
	convertParagraphToStep,
	type ConvertParagraphTarget,
} from "../steps/structure-steps";
import {
	InlineInsertSlot,
	StagedRegionView,
	type PromptFlowInlineInsert,
	type PromptFlowStagedRegion,
} from "./StagedRows";
import { XmlRow } from "./XmlRow";

export type { PromptFlowInlineInsert, PromptFlowStagedRegion } from "./StagedRows";

/**
 * Agent XML editing surface. At rest it renders continuous, dense,
 * syntax-colored XML on a STRICT single-line grid that visually matches the
 * read-only Raw view (same mono metrics, shared highlighter). The editorial
 * layer speaks the code editor's structural vocabulary — bracket-style indent
 * guides, faint section landmarks, git-diff change-bars on hover — and never
 * card/box chrome. Drag handles, insert affordances, and inline editing only
 * appear on hover / interaction, so toggling Raw ↔ editor feels like toggling
 * editability rather than opening a different document.
 *
 * Line numbers are OFF by default: the flow renders a structured document,
 * not source code — node ids, targeting rings, and quoted ranges are its
 * address system, and a number column is a competing affordance that eats
 * the left edge and crowds the drag grip. The gutter therefore collapses to
 * the width the block affordances need. When a host enables numbers (style
 * rail toggle) they track Raw line-for-line because the row model comes from
 * buildXmlLineModel, whose concatenation is guaranteed (by test) to equal
 * renderXmlMarkdown — the exact string Raw shows.
 */

// Line-height / font metrics + palette live in the shared editor-surface
// module so this flow and the Raw view render on one grid with one palette.
const ROW_TEXT = "font-mono";

// Pointer travel (px) past which a press stops being a click: a Cmd press
// that travels selects nothing (drags fall through to native text
// selection), and a press on the active structural selection becomes a
// body-move drag. Below it the gesture stays a plain click — caret
// placement / click-to-edit as today.
const CLICK_DRAG_THRESHOLD_PX = 4;

// Presses on interactive chrome never start a surface gesture (Cmd
// unit-select OR selection body-move): an OPEN inline editor's textarea
// keeps native text selection, handles and menus keep their own drags and
// clicks.
const SURFACE_GESTURE_EXCLUDE =
	'textarea, input, select, button, [contenteditable="true"], [data-prompt-affordance], [role="menu"], [role="listbox"], [data-prompt-inline-insert], [data-prompt-staged-region]';

interface InlineEditTarget extends EditTarget {
	/**
	 * Monotonic id for this placement of the caret. The editor is keyed on it,
	 * so every move (split, merge, arrow, click) remounts the textarea and
	 * re-seats `caret` exactly once — no stale caret, no fight with React's
	 * controlled-value reset. It also lets a late blur from a replaced editor
	 * be ignored instead of cancelling the edit that replaced it.
	 */
	seq: number;
}

export function PromptFlowXml({
	prompt,
	model,
	selectedNodeId,
	onSelectNode,
	onPromptChange: hostPromptChange,
	onEditTargetChange,
	showOutline = false,
	centerContent = false,
	stagedRegions,
	inlineInserts,
	leadContent,
}: PromptFlowViewProps & {
	/**
	 * Render the top-level section outline column beside the buffer. Hosts
	 * pass false only when the pane is too narrow to carry it.
	 */
	showOutline?: boolean;
	/**
	 * Center the content column inside the scroller instead of left-aligning
	 * it. Hosts whose scroller spans wider than the content width (the lab's
	 * full-region document area, where the scrollbar belongs at the region's
	 * far right) pass true; the default keeps existing consumers byte-
	 * identical. Overlays are unaffected: everything absolute renders inside
	 * the rows container (which the auto margins move as one unit), and the
	 * drag ghost / drop indicator position from live viewport rects.
	 */
	centerContent?: boolean;
	/**
	 * Rendered INSIDE the scroller, above the rows, on the same content
	 * column (Notion-page header): it scrolls away with the document instead
	 * of sitting as fixed chrome above it.
	 */
	leadContent?: React.ReactNode;
	/**
	 * Fires when the inline caret session changes enclosing blocks: the node's
	 * id while an editor is open (an item edit reports its LIST's id — item
	 * rows carry it), undefined when no editor is. Hosts use it to let quiet
	 * panels (the lab's DETAILS zone) follow the caret SILENTLY; it is a
	 * derivation feed, never selection state, and must not paint selection
	 * chrome.
	 */
	onEditTargetChange?: (nodeId: string | undefined) => void;
	/**
	 * Staged-proposal regions: each replaces its row range with red del rows +
	 * green add rows (plus an optional in-flow action bar). Replaced rows are
	 * not rendered at all, which doubles as the pending-proposal editing
	 * guard. Row indices address THIS surface's line model (buildXmlLineModel
	 * on the same prompt is deterministic, so hosts compute them safely).
	 */
	stagedRegions?: PromptFlowStagedRegion[];
	/**
	 * Widgets inserted into the document flow immediately above a row —
	 * inline composer, waiting-on-human thread bars. Content pushes down.
	 */
	inlineInserts?: PromptFlowInlineInsert[];
}) {
	// CARET-FIRST (2026-08-06): the caret is the entire treatment for editing —
	// clicking or typing in text never selects a block. Two guards keep block
	// selection chrome out of caret flows:
	//
	//   1. `focusEdit` no longer selects the node it lands in; it CLEARS an
	//      existing selection instead (a caret and a block selection never
	//      coexist — and retargeting the selection would stripe list rows,
	//      whose lines all carry the LIST's node id).
	//   2. Commits made while an edit session is live suppress the change
	//      callback's selection echo (the second argument): hosts write that
	//      echo back into selection state, which would re-select the edited
	//      block on every keystroke. Commits OUTSIDE a live session — block
	//      menu inserts, item menu operations, drops — keep their echo: those
	//      flows still land a selection deliberately.
	//
	// Both guards read refs (synced per render, seated synchronously inside
	// `focusEdit`) so their callbacks stay identity-stable.
	const selectedNodeIdRef = useRef(selectedNodeId);
	selectedNodeIdRef.current = selectedNodeId;
	const editSessionLiveRef = useRef(false);
	const onPromptChange = useCallback<PromptFlowChangeHandler>(
		(nextPrompt, nextSelectedNodeId, steps) =>
			hostPromptChange(
				nextPrompt,
				editSessionLiveRef.current ? undefined : nextSelectedNodeId,
				steps,
			),
		[hostPromptChange],
	);

	const flow = usePromptFlowInteractions({
		prompt,
		model,
		selectedNodeId,
		onSelectNode,
		onPromptChange,
	});

	const lineModel = useMemo(
		() => buildXmlLineModel(prompt, { variables: undefined }),
		[prompt],
	);
	const lines = lineModel.lines;

	const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
	// The hovered LIST ITEM, when the hovered row is an item row (item rows
	// carry the LIST's id as nodeId, so hoverNodeId alone cannot name one
	// bullet). Set and cleared exactly alongside hoverNodeId — including the
	// scroll clear — so the item-scoped wash can never outlive the node hover.
	const [hoverItemId, setHoverItemId] = useState<string | null>(null);
	// The row currently under the pointer — the input to the canonical
	// drag-handle resolution (deepest draggable unit under the pointer, see
	// drag-handle.ts). Distinct from hoverNodeId, which drives the hover wash.
	const [hoverRow, setHoverRow] = useState<number | null>(null);
	const [editTarget, setEditTarget] = useState<InlineEditTarget | null>(null);
	// Per-render sync for the selection-echo guard above; `focusEdit` also
	// seats it synchronously so a commit later in the SAME tick (typing on a
	// selected block, autoformat) already counts as in-session.
	editSessionLiveRef.current = editTarget !== null;
	// The block menu ([⋮⋮] click) opens for one block at a time, anchored to its
	// first row so every block affordance stays in the one left cluster.
	const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
	// The ITEM menu (item-grip click) — the item-kind twin of menuNodeId, keyed
	// by the item so exactly one bullet's menu can be open. `listId`/`itemIndex`
	// ride along for reporting; the render gate and the handle pin resolve by
	// `itemId` against the CURRENT lines, so a stale index can never mis-route.
	const [itemMenu, setItemMenu] = useState<{
		listId: string;
		itemId: string;
		itemIndex: number;
	} | null>(null);
	// The slash menu, when `/` opened one. The caret rect is a snapshot taken on
	// each keystroke, so the menu tracks the query as it grows.
	const [slash, setSlash] = useState<
		(SlashSession & { anchor: SlashMenuAnchor }) | null
	>(null);
	const editSeqRef = useRef(0);
	/**
	 * Structural selection: ONE contiguous sibling run — items of one list
	 * (shift-click on item rows) or blocks under one parent (Cmd+click on a
	 * unit; null parent = the top-level run). See structural-selection.ts for
	 * the canonical resolution model.
	 * Grabbing the drag handle on any unit of the run then carries the whole
	 * run as one object, and Backspace/Delete removes it as one transaction.
	 */
	const [structuralSelection, setStructuralSelection] =
		useState<StructuralSelection | null>(null);
	/** The item a future shift-click extends from (last item interacted with). */
	const itemAnchorRef = useRef<{ listId: string; index: number } | null>(null);
	// Document changes can invalidate run indices — but `prompt` churns
	// IDENTITY on every host render (hosts rebuild the editor model per
	// render), so clearing on [prompt] would wipe the selection the moment
	// any host state moves (the gesture itself triggers one). Instead,
	// VALIDATE: keep the selection while the document still materializes its
	// run (parent exists, endpoints in range — structuralSelectionRun is the
	// validity check); retire it only when the document genuinely no longer
	// supports it.
	useEffect(() => {
		setStructuralSelection((current) => {
			if (!current) return current;
			return structuralSelectionRun(prompt, current) ? current : null;
		});
	}, [prompt]);
	/**
	 * The markdown marker a conversion just swallowed, and the caret placement it
	 * produced. Backspace on that caret gives the literal characters back; any
	 * other keystroke retires the offer.
	 */
	const undoMarkerRef = useRef<{
		nodeId: string;
		literal: string;
		seq: number;
	} | null>(null);

	/**
	 * Single entry point for putting the caret somewhere. CARET-FIRST: placing
	 * the caret never selects the block it lands in — the caret plus the
	 * unit-scoped edit wash is the whole treatment. An existing block
	 * selection is CLEARED, not retargeted (retargeting would repaint block
	 * chrome under every caret hop, and stripe list rows, which all carry the
	 * LIST's node id).
	 */
	const focusEdit = useCallback(
		(target: EditTarget) => {
			editSeqRef.current += 1;
			// Seated synchronously so a commit in this same tick already
			// suppresses the selection echo (see the caret-first guards above).
			editSessionLiveRef.current = true;
			setEditTarget({ ...target, seq: editSeqRef.current });
			setMenuNodeId(null);
			setItemMenu(null);
			// Any caret move retires the slash menu: it is anchored to one caret
			// on one line and has nothing to say about the row it moved to.
			setSlash(null);
			// A caret is a point gesture: it retires a range selection, and an
			// item caret becomes the anchor the next shift-click extends from.
			setStructuralSelection(null);
			if (target.itemIndex !== undefined) {
				itemAnchorRef.current = {
					listId: target.nodeId,
					index: target.itemIndex,
				};
			}
			if (selectedNodeIdRef.current !== undefined) onSelectNode(undefined);
		},
		[onSelectNode],
	);

	// The caret-follow feed for quiet host panels (see the prop doc): reports
	// the enclosing node of the live edit session, and undefined at rest.
	const editTargetNodeId = editTarget?.nodeId;
	useEffect(() => {
		onEditTargetChange?.(editTargetNodeId);
	}, [editTargetNodeId, onEditTargetChange]);

	// Only the editor that is still current may end the session: a blur fired by
	// an editor that a structural key already replaced must not cancel the edit.
	const endEdit = useCallback((seq: number) => {
		setEditTarget((current) =>
			current && current.seq === seq ? null : current,
		);
		setSlash(null);
	}, []);

	const entriesById = useMemo(() => {
		const map = new Map<string, PromptEditorTreeEntry>();
		for (const entry of model.tree) map.set(entry.id, entry);
		// Lists nested inside list items are NOT walked by the editor tree
		// (list items aren't block containers in the model), yet the line model
		// still renders their rows with real ids. Register lightweight entries
		// for those nested lists so their items stay inline-editable and item
		// ops (add/remove/nest) resolve by id. These synthetic entries carry no
		// meaningful tree path — item ops address the list by id, not path.
		for (const entry of model.tree) registerNestedLists(entry, map);
		return map;
	}, [model.tree]);

	// Ranges let hover/selection highlight the full block, not just one row.
	const nodeRanges = useMemo(() => computeNodeRanges(lines), [lines]);
	// Per-item extents (marker row + nested child rows) for item drags.
	const itemRanges = useMemo(() => computeItemRanges(lines), [lines]);
	// Innermost owning item per row, so hovering ANY of an item's rows (its
	// marker line or a nested child block's rows) reveals THAT item's handle.
	const rowItemIds = useMemo(() => {
		const owners: (string | undefined)[] = new Array(lines.length);
		const starts: number[] = new Array(lines.length).fill(-1);
		for (const [itemId, range] of itemRanges) {
			for (let index = range.start; index <= range.end; index += 1) {
				// Innermost wins: the latest-starting containing extent.
				if (range.start >= (starts[index] ?? -1)) {
					starts[index] = range.start;
					owners[index] = itemId;
				}
			}
		}
		return owners;
	}, [itemRanges, lines.length]);

	/**
	 * The selected item group, normalized for painting and dragging: the list,
	 * the contiguous [fromIndex, count) run, every carried item id in order,
	 * and the union of the items' row extents. Null when the selection cannot
	 * name a draggable run (no selection, ids missing, indices stale — though
	 * staleness is already prevented by clearing on prompt change).
	 */
	const itemGroup = useMemo(() => {
		if (!structuralSelection || structuralSelection.kind !== "items") {
			return null;
		}
		const listId = structuralSelection.parentId;
		if (listId === null) return null;
		const lo = structuralSelection.start;
		const hi = structuralSelection.end;
		const itemIds: string[] = [];
		let start = Number.POSITIVE_INFINITY;
		let end = Number.NEGATIVE_INFINITY;
		for (const line of lines) {
			if (line.role !== "item" || line.nodeId !== listId) continue;
			if (line.itemIndex === undefined || line.itemId === undefined) continue;
			if (line.itemIndex < lo || line.itemIndex > hi) continue;
			itemIds.push(line.itemId);
			const range = itemRanges.get(line.itemId);
			if (!range) return null;
			start = Math.min(start, range.start);
			end = Math.max(end, range.end);
		}
		// Every index of the run must resolve to a real item, or the group is
		// not a well-defined drag unit.
		if (itemIds.length !== hi - lo + 1 || end < start) return null;
		return {
			listId,
			fromIndex: lo,
			count: hi - lo + 1,
			itemIds,
			rowRange: { start, end },
		};
	}, [structuralSelection, lines, itemRanges]);

	/**
	 * The selected BLOCK run, normalized the same way: the parent (null = top
	 * level), the contiguous [fromIndex, count) run, every carried block id in
	 * sibling order, and the union of the blocks' row extents. Null when the
	 * selection is items-kind or cannot name a well-defined run.
	 */
	const blockGroup = useMemo(() => {
		if (!structuralSelection || structuralSelection.kind !== "blocks") {
			return null;
		}
		const run = structuralSelectionRun(prompt, structuralSelection);
		if (!run) return null;
		let start = Number.POSITIVE_INFINITY;
		let end = Number.NEGATIVE_INFINITY;
		for (const id of run.unitIds) {
			const range = nodeRanges.get(id);
			if (!range) return null;
			start = Math.min(start, range.start);
			end = Math.max(end, range.end);
		}
		if (end < start) return null;
		return {
			parentId: run.parentId,
			fromIndex: run.fromIndex,
			count: run.count,
			blockIds: run.unitIds,
			rowRange: { start, end },
		};
	}, [structuralSelection, prompt, nodeRanges]);

	// The structural selection's (item run OR block run) visual band: the raw
	// row extent drives POSITIONAL membership checks (handle grabs and the
	// body-move gesture), the trimmed range drives paint (row stamps + the
	// single ring overlay).
	const groupRowRange = itemGroup?.rowRange ?? blockGroup?.rowRange;
	const paintedGroupRange = groupRowRange
		? trimPaintedNodeRange(lines, groupRowRange)
		: undefined;

	/**
	 * Shift-click on an item row: extend the item-range selection from the
	 * anchor (the last item interacted with) to the clicked item. Anchors in a
	 * DIFFERENT list cannot extend across — the click starts a fresh
	 * single-item range there instead. The range replaces both the caret and
	 * the single-node selection, so exactly one selection treatment paints.
	 */
	const handleItemShiftClick = useCallback(
		(line: XmlLine) => {
			if (line.itemIndex === undefined) return;
			const anchor = itemAnchorRef.current;
			const anchorIndex =
				anchor && anchor.listId === line.nodeId
					? anchor.index
					: line.itemIndex;
			itemAnchorRef.current = { listId: line.nodeId, index: anchorIndex };
			setStructuralSelection({
				parentId: line.nodeId,
				kind: "items",
				start: Math.min(anchorIndex, line.itemIndex),
				end: Math.max(anchorIndex, line.itemIndex),
			});
			setEditTarget(null);
			setMenuNodeId(null);
			setItemMenu(null);
			onSelectNode(undefined);
		},
		[onSelectNode],
	);

	// Everything the one keyboard model needs. Rebuilt per render; it is only
	// ever read inside an event handler, so it always sees the current document.
	const keyContext: EditorKeyContext = {
		lines,
		entriesById,
		prompt,
		onPromptChange,
		moveEdit: focusEdit,
		endEdit: () => setEditTarget(null),
	};

	/**
	 * Commits a structural conversion (slash menu / markdown autoformat) and
	 * lands the caret inside whatever it produced.
	 *
	 * A section is the exception to "focus what the helper says": the helper
	 * points at the section's first body paragraph, but a section the user just
	 * asked for is unnamed, so the caret goes to its TAG with the placeholder
	 * name selected. Typing renames it; Enter drops into the body.
	 */
	function convertBlock(
		nodeId: string,
		target: ConvertParagraphTarget,
		text: string,
		language?: string,
	): boolean {
		const result = convertParagraphToStep(prompt, nodeId, target, {
			content: editableTextToInline(text),
			...(language ? { language } : {}),
		});
		if (!result) return false;
		onPromptChange(result.prompt, result.focusNodeId, result.steps);
		if (target === "section") {
			const tag = sectionTagOf(result.prompt, nodeId);
			focusEdit({ nodeId, caret: [0, tag.length] });
			return true;
		}
		focusEdit({
			nodeId: result.focusNodeId ?? nodeId,
			itemIndex: result.focusItemIndex,
			caret: result.caretOffset ?? 0,
		});
		return true;
	}

	/**
	 * Every keystroke's resulting text, before it becomes a text commit. Three
	 * things can happen to it, in this order: it feeds an open slash menu, it
	 * opens one, or it names a markdown marker that turns the block into
	 * something else. Anything else is ordinary typing.
	 */
	function handleEditorChange(
		line: XmlLine,
		next: string,
		element: HTMLTextAreaElement,
	): void {
		const entry = entriesById.get(line.nodeId);
		if (!entry) return;
		// Typing anything retires a pending "take my marker back" offer.
		undoMarkerRef.current = null;
		const previous = editorValueForLine(line.node, line);
		const commit = () =>
			commitEdit(prompt, entry, line, next, onPromptChange);

		if (slash && slash.nodeId === line.nodeId && slash.itemIndex === line.itemIndex) {
			const session = advanceSlashSession(slash, next);
			// A retired menu leaves the text exactly as typed — the slash and the
			// query stay on the line as literal prose.
			setSlash(
				session
					? { ...session, anchor: caretAnchor(element, next.length) }
					: null,
			);
			commit();
			return;
		}

		if (line.node.type === "paragraph" && shouldOpenSlash(previous, next)) {
			commit();
			setSlash({
				nodeId: line.nodeId,
				query: "",
				selectedIndex: 0,
				anchor: caretAnchor(element, next.length),
			});
			return;
		}

		if (line.node.type === "paragraph" && line.role === "content") {
			const marker = resolveAutoformat(previous, next);
			if (
				marker &&
				convertBlock(line.nodeId, marker.target, marker.rest, marker.language)
			) {
				undoMarkerRef.current = {
					nodeId: line.nodeId,
					literal: next,
					seq: editSeqRef.current,
				};
				return;
			}
		}

		commit();
	}

	/**
	 * Backspace on the caret a markdown conversion just placed puts the literal
	 * marker back. Without it the same keystroke would delete the block the
	 * marker created, which is a startling answer to "undo that".
	 */
	function handleMarkerUndo(
		event: React.KeyboardEvent<HTMLTextAreaElement>,
		line: XmlLine,
	): boolean {
		const pending = undoMarkerRef.current;
		if (!pending || event.key !== "Backspace") return false;
		if (event.metaKey || event.ctrlKey || event.altKey) return false;
		if (pending.nodeId !== line.nodeId || pending.seq !== editTarget?.seq) {
			return false;
		}
		const element = event.currentTarget;
		if (element.value.length > 0 || element.selectionStart !== 0) return false;

		const result = convertBlockToParagraphStep(
			prompt,
			pending.nodeId,
			pending.literal,
		);
		if (!result) return false;
		event.preventDefault();
		undoMarkerRef.current = null;
		onPromptChange(result.prompt, pending.nodeId, result.steps);
		focusEdit({ nodeId: pending.nodeId, caret: result.caretOffset ?? "end" });
		return true;
	}

	/**
	 * Keys the slash menu owns while it is open. Everything it claims is
	 * prevented before the editing keymap sees it, so Enter chooses a command
	 * rather than splitting the line and Tab picks rather than changing level.
	 * It never takes focus, so the caret keeps blinking behind the menu.
	 */
	function handleSlashKey(
		event: React.KeyboardEvent<HTMLTextAreaElement>,
		line: XmlLine,
	): boolean {
		if (!slash || slash.nodeId !== line.nodeId) return false;
		if (slash.itemIndex !== line.itemIndex) return false;
		if (event.metaKey || event.ctrlKey || event.altKey) return false;

		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				const delta = event.key === "ArrowDown" ? 1 : -1;
				setSlash({ ...slash, selectedIndex: moveSlashSelection(slash, delta) });
				return true;
			}
			case "Enter":
			case "Tab": {
				event.preventDefault();
				const command = selectedSlashCommand(slash);
				if (command) chooseSlashCommand(command);
				else setSlash(null);
				return true;
			}
			case "Escape": {
				event.preventDefault();
				setSlash(null);
				return true;
			}
			default:
				return false;
		}
	}

	/**
	 * Runs a chosen command on the block the `/` was typed in. The literal
	 * `/query` text is dropped — it was the command, not content — and the caret
	 * lands inside whatever the command made. "Text" is the identity choice: it
	 * only clears the query.
	 */
	function chooseSlashCommand(command: SlashCommand): void {
		const session = slash;
		if (!session) return;
		setSlash(null);
		const line = lines.find(
			(candidate) =>
				candidate.editable && candidate.nodeId === session.nodeId,
		);
		const entry = entriesById.get(session.nodeId);
		if (!line || !entry) return;

		if (command.type === "paragraph") {
			commitEdit(prompt, entry, line, "", onPromptChange);
			focusEdit({ nodeId: session.nodeId, caret: 0 });
			return;
		}
		convertBlock(session.nodeId, command.type as ConvertParagraphTarget, "");
	}

	// The option the textarea's aria-activedescendant points at.
	const slashActiveOptionId = slash
		? (() => {
				const command = selectedSlashCommand(slash);
				return command ? slashMenuOptionId(command.id) : undefined;
			})()
		: undefined;

	// Typing on a selected-but-not-editing block drops straight into the editor
	// with the keystroke applied, so selection is never a keyboard dead end.
	// The character is APPENDED rather than replacing the block: a stray key
	// must never silently destroy a block's text. CARET-FIRST: the transition
	// is selection → caret — `focusEdit` (called before the commit, so the
	// commit already counts as in-session) clears the selection rather than
	// keeping the block lit behind the caret.
	useEffect(() => {
		const activeId = flow.activeId;
		if (!activeId || editTarget) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key.length !== 1) return;
			const focused = document.activeElement;
			if (
				focused instanceof HTMLElement &&
				(focused.isContentEditable ||
					focused.tagName === "INPUT" ||
					focused.tagName === "TEXTAREA" ||
					focused.tagName === "SELECT")
			) {
				return;
			}
			const line = lines.find(
				(candidate) => candidate.editable && candidate.nodeId === activeId,
			);
			if (!line) return;
			const entry = entriesById.get(line.nodeId);
			if (!entry) return;
			event.preventDefault();
			const next = editorValueForLine(line.node, line) + event.key;
			focusEdit({
				nodeId: line.nodeId,
				itemIndex: line.itemIndex,
				caret: next.length,
			});
			commitEdit(prompt, entry, line, next, onPromptChange);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [
		flow.activeId,
		editTarget,
		lines,
		entriesById,
		prompt,
		onPromptChange,
		focusEdit,
	]);
	// Bracket-style indent guides: one hairline per top-level (and cheap
	// nested) container, spanning its open→close rows at the section indent.
	const guides = useMemo(() => computeGuides(lines, nodeRanges), [lines, nodeRanges]);
	// Rows that begin a top-level section — faint full-width landmark tint.
	const landmarkRows = useMemo(() => computeLandmarks(lines), [lines]);
	// The outline column: one entry per top-level open tag plus its depth-1
	// container children, labeled with the bare tag name. Names only — the
	// column is a map, not a chart, so entries carry no size chrome.
	const sections = useMemo<OutlineSection[]>(() => {
		const result: OutlineSection[] = [];
		const seen = new Set<string>();
		lines.forEach((line, index) => {
			if (line.role !== "open" || line.depth > 1) return;
			if (seen.has(line.nodeId)) return;
			seen.add(line.nodeId);
			result.push({
				row: index,
				nodeId: line.nodeId,
				label: outlineSectionLabel(line),
				depth: line.depth,
			});
		});
		return result;
	}, [lines]);
	// One flag for the whole column: a prompt with no top-level sections has
	// nothing to list, so the buffer keeps the full pane.
	const outlineShown = showOutline && sections.length > 0;

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const rowsRef = useRef<HTMLDivElement | null>(null);

	// Rows are one line-height at rest but grow when their content wraps, so
	// overlays (guides, landmark span, drop line) can't assume a fixed row
	// pitch — they read measured per-row offsets instead.
	const rowMetrics = useRowMetrics(rowsRef, lines.length);

	// Outline scroll tracking: the active section is the last one whose open
	// row sits at/above the top of the viewport (small offset), snapping to
	// the final section once the scroller reaches the bottom. State updates
	// only when the active row actually changes, so scrolling stays cheap.
	const [activeSectionRow, setActiveSectionRow] = useState<number | null>(
		null,
	);
	const updateActiveSection = useCallback(() => {
		const scroller = scrollRef.current;
		if (!scroller || sections.length === 0) {
			setActiveSectionRow(null);
			return;
		}
		const lineHeight = rowMetrics[0]?.lineHeight ?? LINE_HEIGHT_PX;
		const threshold = scroller.scrollTop + lineHeight * 2;
		let active = sections[0]!.row;
		for (const section of sections) {
			const metric = rowMetrics[section.row];
			if (metric && metric.top <= threshold) active = section.row;
		}
		if (
			scroller.scrollTop + scroller.clientHeight >=
			scroller.scrollHeight - 2
		) {
			active = sections[sections.length - 1]!.row;
		}
		setActiveSectionRow(active);
	}, [sections, rowMetrics]);

	useEffect(() => {
		if (outlineShown) updateActiveSection();
	}, [outlineShown, updateActiveSection]);

	const scrollToSection = useCallback(
		(section: OutlineSection) => {
			const scroller = scrollRef.current;
			const metric = rowMetrics[section.row];
			if (!scroller || !metric) return;
			// Land the section's open tag one line below the top edge — same
			// breathing the document's first line gets from the top padding.
			scroller.scrollTo({
				top: Math.max(0, metric.top - metric.lineHeight),
				behavior: "smooth",
			});
		},
		[rowMetrics],
	);

	// Item drop commit: same-list, cross-list, and nest-creating drops all
	// collect their steps and commit through ONE onPromptChange call — one
	// transaction, so any drag-drop is a single undoable action (the same
	// composition mechanism the keymap's structural gestures use).
	const moveItems = useCallback(
		(
			fromListId: string,
			fromIndex: number,
			count: number,
			target: ItemDropCommand,
		) => {
			const steps: PromptStep[] = [];
			// A nest drop first LANDS the run directly after its parent-to-be,
			// then indents it — the indent slot in the target list's original
			// indexing is right below the parent item.
			const toSlot =
				target.type === "slot" ? target.slot : target.parentItemIndex + 1;
			const moved = moveListItemsAcrossStep(
				prompt,
				fromListId,
				fromIndex,
				count,
				target.listId,
				toSlot,
			);
			let doc = moved.prompt;
			steps.push(...moved.steps);
			if (target.type === "nest") {
				// Indent the landed run one item at a time: the first nest creates
				// the parent's child list, the rest append to it — the run's next
				// item keeps shifting into the same index, so the address is fixed.
				const runStart = moved.focusItemIndex ?? toSlot;
				for (let offset = 0; offset < count; offset += 1) {
					const nested = nestListItemStep(doc, target.listId, runStart);
					if (!nested.step) break;
					doc = nested.prompt;
					steps.push(nested.step);
				}
			}
			// A source list drained by a cross-list move does not linger as an
			// empty shell — the same empty-list rule the keymap applies.
			if (steps.length > 0 && fromListId !== target.listId) {
				if (getListById(doc, fromListId)?.items.length === 0) {
					const removal = removeListWithStep(doc, fromListId);
					if (removal.step) {
						doc = removal.prompt;
						steps.push(removal.step);
					}
				}
			}
			if (steps.length > 0) onPromptChange(doc, target.listId, steps);
		},
		[prompt, onPromptChange],
	);

	// Block-run reorder commit: the run seam mirrors moveItems — one
	// transaction moving the contiguous siblings, so a structurally selected
	// span of blocks drag-drops as a single undoable action.
	const moveBlocks = useCallback(
		(
			parentId: string | null,
			fromIndex: number,
			count: number,
			toSlot: number,
		) => {
			const result = moveBlocksStep(prompt, parentId, fromIndex, count, toSlot);
			if (result.steps.length === 0) return;
			onPromptChange(result.prompt, result.runIds[0], result.steps);
		},
		[prompt, onPromptChange],
	);

	const drag = useXmlDrag({
		lines,
		nodeRanges,
		itemRanges,
		entriesById,
		rowsRef,
		scrollRef,
		moveNear: flow.moveNear,
		moveItems,
		moveBlocks,
	});

	/**
	 * Structural UNIT selection — EDIT mode only. Cmd+CLICK on the surface
	 * (not on a handle / menu / editor textarea / affordance) selects the
	 * unit under the cursor as ONE structural selection. The old Cmd+drag
	 * marquee rectangle is retired: a Cmd press that travels past the click
	 * threshold selects NOTHING, and a PLAIN drag falls through to native
	 * browser text selection (read-only for now). resolveMarqueeSelection
	 * stays on as the pure row-band → run resolver this click (and the
	 * shift-click ranges) reuse.
	 */
	const unitPressRef = useRef<{ startX: number; startY: number } | null>(null);
	const [unitPressPending, setUnitPressPending] = useState(false);
	// A unit-select release must not read as a click (the surface click would
	// clear the very selection the press just made): swallowed exactly once
	// by the section's onClickCapture below.
	const suppressClickRef = useRef(false);

	/**
	 * Selection BODY-move gesture bookkeeping: a plain press inside the active
	 * structural selection's row extent arms a move; crossing the threshold
	 * lifts the run through the exact group path a handle grab uses. Kept
	 * outside React state except the pending flag (which installs the
	 * window listeners, same pattern as the unit press).
	 */
	const moveGestureRef = useRef<{
		startX: number;
		startY: number;
		row: number;
	} | null>(null);
	const [movePending, setMovePending] = useState(false);

	const handleSurfacePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			// A fresh press disarms a stale release-click swallow.
			suppressClickRef.current = false;
			if (event.button !== 0) return;
			// Shift/alt presses stay with their own gestures (shift-click
			// extension, native modifiers).
			if (event.shiftKey || event.altKey) return;
			const target = event.target instanceof HTMLElement ? event.target : null;
			if (!target) return;
			// Annotate mode owns its own drag gestures — the unit select and
			// the selection body-move are edit-mode only.
			if (target.closest('[data-annotation-targeting="true"]')) return;
			// Presses on interactive chrome stay theirs (see the selector).
			if (target.closest(SURFACE_GESTURE_EXCLUDE)) return;
			// Command is THE structural modifier: Cmd+click selects the unit
			// under the cursor. A PLAIN press stays with its own gestures
			// (caret placement, click-to-edit, native text selection) —
			// EXCEPT on the active structural selection's own rows, where it
			// arms the body-move: the highlighted zone is one object, so
			// grabbing it anywhere moves it. Nothing is prevented here — a
			// sub-threshold release falls through to today's click behavior
			// untouched, and a plain drag over text keeps the browser's own
			// selection.
			if (!(event.metaKey || event.ctrlKey)) {
				if (!groupRowRange) return;
				const rowEl = target.closest<HTMLElement>("[data-row-index]");
				const row = Number(rowEl?.dataset.rowIndex);
				if (Number.isNaN(row)) return;
				if (row < groupRowRange.start || row > groupRowRange.end) return;
				moveGestureRef.current = {
					startX: event.clientX,
					startY: event.clientY,
					row,
				};
				setMovePending(true);
				return;
			}
			unitPressRef.current = {
				startX: event.clientX,
				startY: event.clientY,
			};
			setUnitPressPending(true);
		},
		[groupRowRange],
	);

	// Window-level release tracking while a Cmd press is live — registered
	// only then, so it never runs at rest (same pattern as the drag
	// controller).
	useEffect(() => {
		if (!unitPressPending) return;

		const onUp = (event: PointerEvent) => {
			const press = unitPressRef.current;
			unitPressRef.current = null;
			setUnitPressPending(false);
			if (!press || !rowsRef.current) return;
			// Past-threshold travel is a drag, not a click. The retired
			// marquee rectangle does NOT come back: a Cmd+drag selects
			// nothing (any native text selection it made stands).
			const dx = event.clientX - press.startX;
			const dy = event.clientY - press.startY;
			if (Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) return;
			// Cmd+CLICK: select the unit under the press as a one-object
			// structural selection (movable via its handle or body,
			// deletable with Backspace) instead of placing a caret.
			const rect = rowsRef.current.getBoundingClientRect();
			const y = press.startY - rect.top;
			let hitRow = -1;
			rowsRef.current
				.querySelectorAll<HTMLElement>("[data-row-index]")
				.forEach((row) => {
					const index = Number(row.dataset.rowIndex);
					if (Number.isNaN(index)) return;
					if (y >= row.offsetTop && y < row.offsetTop + row.offsetHeight) {
						hitRow = index;
					}
				});
			if (hitRow >= 0) {
				const selection = resolveMarqueeSelection(prompt, lines, hitRow, hitRow);
				if (selection) {
					setStructuralSelection(selection);
					setEditTarget(null);
					setMenuNodeId(null);
					setItemMenu(null);
					onSelectNode(undefined);
					suppressClickRef.current = true;
				}
			}
		};

		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			unitPressRef.current = null;
			setUnitPressPending(false);
		};

		window.addEventListener("pointerup", onUp);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("keydown", onKey);
		};
	}, [unitPressPending, prompt, lines, onSelectNode]);

	// Window-level tracking while a body-move press is armed. Crossing the
	// threshold lifts the selected run through the SAME entry points a handle
	// grab inside the zone uses — identical ghost ("+N more"), dimming, drop
	// slots, and one-transaction commit. A sub-threshold release disarms
	// silently, so the press remains exactly today's click.
	useEffect(() => {
		if (!movePending) return;

		const onMove = (event: PointerEvent) => {
			const gesture = moveGestureRef.current;
			if (!gesture) return;
			const dx = event.clientX - gesture.startX;
			const dy = event.clientY - gesture.startY;
			if (Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) return;
			moveGestureRef.current = null;
			setMovePending(false);
			// The release click after a body drag must not clear the selection
			// or land a caret — swallowed once, same as a unit-select release.
			suppressClickRef.current = true;
			// Lift-off goes through the drag controller's React entry points;
			// only the fields they read (button, coords, preventDefault) are
			// supplied.
			const lift = {
				button: 0,
				clientX: event.clientX,
				clientY: event.clientY,
				preventDefault: () => {},
			} as unknown as React.PointerEvent<HTMLElement>;
			if (blockGroup) {
				// The grabbed anchor seats the ghost; a press on a gap row (or
				// any row without its own range) anchors on the run's first
				// block instead.
				const line = lines[gesture.row];
				const grabbedId =
					line && nodeRanges.has(line.nodeId)
						? line.nodeId
						: blockGroup.blockIds[0]!;
				drag.startBlockRunDrag(
					lift,
					{
						parentId: blockGroup.parentId,
						fromIndex: blockGroup.fromIndex,
						count: blockGroup.count,
						blockIds: blockGroup.blockIds,
						grabbedId,
					},
					// This gesture already crossed the body-move threshold.
					{ immediate: true },
				);
				return;
			}
			if (itemGroup) {
				drag.startItemDrag(
					lift,
					{
						listId: itemGroup.listId,
						// The innermost item owning the pressed row anchors the
						// ghost — the carried run stays the whole group.
						itemId: rowItemIds[gesture.row] ?? itemGroup.itemIds[0]!,
						itemIndex: itemGroup.fromIndex,
						count: itemGroup.count,
						itemIds: itemGroup.itemIds,
					},
					// This gesture already crossed the body-move threshold.
					{ immediate: true },
				);
			}
		};

		const onUp = () => {
			// Sub-threshold release: stay a plain click — caret placement and
			// selection clearing proceed exactly as before.
			moveGestureRef.current = null;
			setMovePending(false);
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
	}, [movePending, blockGroup, itemGroup, lines, nodeRanges, rowItemIds, drag]);

	/**
	 * Deletes the selected run as ONE transaction: an item run removes those
	 * items (removing ALL items removes the list — the keymap's empty-list
	 * rule); a block run removes the blocks. Undo restores everything.
	 */
	const deleteStructuralSelection = useCallback(() => {
		if (!structuralSelection) return;
		const run = structuralSelectionRun(prompt, structuralSelection);
		if (!run) return;
		if (run.kind === "items" && run.parentId !== null) {
			if (run.count >= run.unitTotal) {
				const removed = removeListWithStep(prompt, run.parentId);
				if (!removed.step) return;
				onPromptChange(removed.prompt, undefined, [removed.step]);
			} else {
				const result = removeListItemsStep(
					prompt,
					run.parentId,
					run.fromIndex,
					run.count,
				);
				if (!result.step) return;
				onPromptChange(result.prompt, run.parentId, [result.step]);
			}
		} else {
			const result = removeBlocksStep(
				prompt,
				run.parentId,
				run.fromIndex,
				run.count,
			);
			if (result.steps.length === 0) return;
			onPromptChange(result.prompt, undefined, result.steps);
		}
		setStructuralSelection(null);
		onSelectNode(undefined);
	}, [structuralSelection, prompt, onPromptChange, onSelectNode]);

	// Structural-selection keyboard: with a run selected and NO inline editor
	// open, Backspace/Delete removes the whole run and Escape clears the
	// selection. Focus inside any editable control keeps its native keys.
	useEffect(() => {
		if (!structuralSelection || editTarget) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key === "Escape") {
				setStructuralSelection(null);
				return;
			}
			if (event.key !== "Backspace" && event.key !== "Delete") return;
			const focused = document.activeElement;
			if (
				focused instanceof HTMLElement &&
				(focused.isContentEditable ||
					focused.tagName === "INPUT" ||
					focused.tagName === "TEXTAREA" ||
					focused.tagName === "SELECT")
			) {
				return;
			}
			event.preventDefault();
			deleteStructuralSelection();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [structuralSelection, editTarget, deleteStructuralSelection]);

	// Hosts that enable line numbers widen the gutter via the style variable;
	// without host vars the gutter keeps only its collapsed affordance width,
	// matching the numbers-off default.
	const gutterWidth = promptEditorGutterWidth(
		PROMPT_EDITOR_COLLAPSED_GUTTER_WIDTH,
	);

	// THE drag handle: at most one unit shows one at any moment (Notion model,
	// see drag-handle.ts). Pointer resolution — the deepest draggable unit
	// under the hovered row — is the primary state; an open block menu pins the
	// handle to its block so the menu survives pointer travel, and a selected
	// block keeps its handle as the no-pointer fallback. While a drag is live
	// no handle shows at all: the ghost and drop line are the feedback.
	const handleUnit = useMemo(() => {
		if (drag.draggingId) return null;
		const canDragBlock = (nodeId: string) => entriesById.has(nodeId);
		if (menuNodeId && canDragBlock(menuNodeId)) {
			const pinned = blockHandleUnit(lines, nodeRanges, menuNodeId);
			if (pinned) return pinned;
		}
		// An open ITEM menu pins the handle to its item the same way, so the
		// menu survives pointer travel instead of unmounting with the handle.
		if (itemMenu) {
			const pinned = itemHandleUnit(lines, itemRanges, itemMenu.itemId);
			if (pinned) return pinned;
		}
		const hovered = resolveDragHandleUnit({
			lines,
			hoverRow,
			rowItemIds,
			itemRanges,
			nodeRanges,
			canDragBlock,
		});
		if (hovered) return hovered;
		if (flow.activeId && canDragBlock(flow.activeId)) {
			return blockHandleUnit(lines, nodeRanges, flow.activeId);
		}
		return null;
	}, [
		drag.draggingId,
		menuNodeId,
		itemMenu,
		hoverRow,
		rowItemIds,
		lines,
		nodeRanges,
		itemRanges,
		entriesById,
		flow.activeId,
	]);

	// Inline-review geometry: regions render at their start row and swallow
	// every row in their range; inserts render above their row. First region
	// to claim a row wins — overlapping regions indicate a host bug and the
	// later one is dropped rather than double-rendering rows.
	const { regionsByStart, replacedRows } = useMemo(() => {
		const byStart = new Map<number, PromptFlowStagedRegion[]>();
		const replaced = new Set<number>();
		for (const region of stagedRegions ?? []) {
			if (region.rowStart > region.rowEnd) continue;
			let overlaps = false;
			for (let row = region.rowStart; row <= region.rowEnd; row += 1) {
				if (replaced.has(row)) {
					overlaps = true;
					break;
				}
			}
			if (overlaps) continue;
			const bucket = byStart.get(region.rowStart) ?? [];
			bucket.push(region);
			byStart.set(region.rowStart, bucket);
			for (let row = region.rowStart; row <= region.rowEnd; row += 1) {
				replaced.add(row);
			}
		}
		return { regionsByStart: byStart, replacedRows: replaced };
	}, [stagedRegions]);
	const insertsByRow = useMemo(() => {
		const byRow = new Map<number, PromptFlowInlineInsert[]>();
		for (const insert of inlineInserts ?? []) {
			const row = Math.max(0, Math.min(insert.row, lines.length - 1));
			const bucket = byRow.get(row) ?? [];
			bucket.push(insert);
			byRow.set(row, bucket);
		}
		return byRow;
	}, [inlineInserts, lines.length]);

	// The ONE highlighted unit — edit target ?? dragged ?? hovered, the same
	// precedence the wash always had, but each source resolves to its OWNING
	// unit KIND before painting:
	//
	//   item  the source names a LIST ITEM (an item edit target, an item drag
	//         — drag.draggingId IS the grabbed item's own id there — or a
	//         hovered item row). Wash = the item's full itemRanges extent
	//         (marker row + its nested child rows), and no sibling's rows —
	//         item rows carry the LIST's nodeId, so nodeId ownership alone
	//         would wash every bullet of the list.
	//   node  everything else. Wash = per-row `line.nodeId` ownership, never
	//         the start..end interval of the node's range, so a container's
	//         tag hover can never flood body rows that belong to its children.
	const highlightUnit = useMemo<{ kind: "item" | "node"; id: string } | null>(() => {
		if (editTarget) {
			if (editTarget.itemIndex !== undefined) {
				const marker = lines.find(
					(candidate) =>
						candidate.role === "item" &&
						candidate.nodeId === editTarget.nodeId &&
						candidate.itemIndex === editTarget.itemIndex,
				);
				if (marker?.itemId) return { kind: "item", id: marker.itemId };
			}
			return { kind: "node", id: editTarget.nodeId };
		}
		if (drag.draggingId) {
			return {
				kind: drag.drag?.kind === "item" ? "item" : "node",
				id: drag.draggingId,
			};
		}
		if (hoverItemId) return { kind: "item", id: hoverItemId };
		if (hoverNodeId) return { kind: "node", id: hoverNodeId };
		return null;
	}, [editTarget, drag.draggingId, drag.drag, hoverItemId, hoverNodeId, lines]);
	const highlightItemRange =
		highlightUnit?.kind === "item"
			? itemRanges.get(highlightUnit.id)
			: undefined;
	// Selection paints in TWO scopes ("flood never, rail for extent"):
	//
	//   rail   the full start..end interval keeps a thin LEFT ACCENT RAIL (the
	//          per-row accent bar XmlRow draws), so the selected node's whole
	//          extent stays legible;
	//   fill   the selectionBg wash is UNIT-scoped exactly like the hover wash —
	//          only rows the selected node itself owns (a section its open/close
	//          tag rows, a paragraph its rows, an item its itemRanges extent),
	//          never the body rows its children own.
	//
	// `activeId` is normally a node id; the item fallback mirrors flashRange, so
	// an item-addressed selection (if a host ever produces one) scopes to the
	// item's extent instead of vanishing.
	const selectedItemRange =
		flow.activeId && !nodeRanges.has(flow.activeId)
			? itemRanges.get(flow.activeId)
			: undefined;
	// CONTAINERS NEVER STRIPE (2026-08-06): item rows carry the LIST's nodeId,
	// so per-row ownership fill on a selected list would stripe every bullet's
	// marker row — N filled objects instead of one selected list. A selected
	// list therefore paints NO per-row fill (and no gutter tint, which follows
	// the fill): the full-extent rail alone marks it. Detected from the lines
	// (any row the node owns with role "item"), so nested lists — which are
	// not tree-addressable — gate identically. Sections keep filling exactly
	// their own open/close tag rows; leaves keep their unit fill; the
	// item-id fallback above is untouched (annotate mode uses it).
	const selectedNodeIsList =
		flow.activeId !== undefined &&
		lines.some(
			(candidate) =>
				candidate.nodeId === flow.activeId && candidate.role === "item",
		);
	const selectedRange = flow.activeId
		? (nodeRanges.get(flow.activeId) ?? selectedItemRange)
		: undefined;
	const paintedSelectionRange = trimPaintedNodeRange(lines, selectedRange);
	// The dragged / flashed unit dims / flashes across its ENTIRE visual line
	// range (including nested child rows — and every item of a group drag), so
	// the whole object reads as lifted out and the drop flash covers everything
	// the ghost carried. The drag stores its row band at lift-off; the flash
	// unions the landed ids' extents.
	const dragRange = drag.drag?.rowRange;
	const flashRange = useMemo(() => {
		if (!drag.flashIds) return undefined;
		let start = Number.POSITIVE_INFINITY;
		let end = Number.NEGATIVE_INFINITY;
		for (const id of drag.flashIds) {
			const range = nodeRanges.get(id) ?? itemRanges.get(id);
			if (!range) continue;
			start = Math.min(start, range.start);
			end = Math.max(end, range.end);
		}
		return end >= start ? { start, end } : undefined;
	}, [drag.flashIds, nodeRanges, itemRanges]);

	return (
		<section
			className={cn(
				PROMPT_EDITOR_ROOT_CLASS,
				"flex h-full min-h-0 flex-1 flex-col",
			)}
			style={{ background: EDITOR_COLORS.bg, color: EDITOR_COLORS.fg }}
			// The release click of a unit-select press or a body-move drag is
			// swallowed here — capture phase, so neither the row handlers nor
			// the surface-clearing click below can undo the selection the
			// gesture just made.
			onClickCapture={(event) => {
				if (!suppressClickRef.current) return;
				suppressClickRef.current = false;
				event.preventDefault();
				event.stopPropagation();
			}}
			onClick={() => {
				onSelectNode(undefined);
				setEditTarget(null);
				setMenuNodeId(null);
				setItemMenu(null);
				setStructuralSelection(null);
			}}
		>
			<div className="flex min-h-0 min-w-0 flex-1">
				<div
				ref={scrollRef}
				data-prompt-flow-scroll="xml"
				// A permanent scrollbar track pressed against the outline's
				// hairline reads as a second divider, so the buffer's scrollbar is
				// an overlay pill on a transparent track — visible on hover.
				className="min-h-0 min-w-0 flex-1 overflow-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-[3px] [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-clip-content [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2.5 hover:[&::-webkit-scrollbar-thumb]:bg-white/15"
				onScroll={() => {
					// Content sliding under a stationary pointer must not carry a
					// stale hover wash along: scrolling retires the hovered NODE
					// (the next real mouseenter re-establishes it). The hovered
					// ROW stays — it anchors the drag handle, and clearing it
					// would pop the handle on every scroll tick. No new
					// listeners: this is the scroller's one existing handler.
					setHoverNodeId(null);
					setHoverItemId(null);
					if (outlineShown) updateActiveSection();
				}}
				style={{
					background: EDITOR_COLORS.bg,
					// The lab's floating glass reserves space INSIDE the scroller —
					// padding on the scroll container keeps its scrollbar at the far
					// right edge, right of the glass, not mid-screen.
					paddingRight: "var(--prompt-editor-reserved-right, 0px)",
					transition: "padding-right 260ms cubic-bezier(0.32, 0.72, 0, 1)",
					// Rows carry their own type; the scroller repeats the font so the
					// `ch`-based max width below resolves in editor characters rather
					// than the shell's.
					fontFamily: EDITOR_METRICS.fontFamily,
					fontSize: EDITOR_METRICS.fontSize,
					// Alongside the outline the buffer stops at the content width,
					// so the column hugs the text instead of stranding a band of
					// empty canvas between them.
					...(outlineShown ? { maxWidth: EDITOR_METRICS.contentWidth } : null),
				}}
			>
				{/* THE NOTION PAGE HEADER (2026-08-04, third pass): inside the
				    scroller on the SAME content column as the rows — it scrolls
				    away with the document, part of the page rather than chrome
				    above it. */}
				{leadContent && (
					<div
						data-prompt-flow-lead=""
						style={{
							...editorTypeStyle,
							maxWidth: EDITOR_METRICS.contentWidth,
							marginInline: "var(--prompt-editor-margin-left, 0px) auto",
							paddingTop: "var(--prompt-editor-margin-top, 0px)",
							// Flush with the TEXT, not the rows container: rows lead
							// with the gutter cell + the text region's own padding,
							// so the title starts exactly where depth-0 content does.
							paddingLeft: `calc(${EDITOR_METRICS.gutterWidth} + 0.75rem)`,
						}}
					>
						{leadContent}
					</div>
				)}
				{model.tree.length === 0 ? (
					<div
						className="p-4"
						style={{
							maxWidth: EDITOR_METRICS.contentWidth,
							marginInline: "var(--prompt-editor-margin-left, 0px) auto",
						}}
					>
						<EmptyFlow onInsert={(type) => flow.insertBlock(type, null)} />
					</div>
				) : (
					<div
						ref={rowsRef}
						data-prompt-flow-rows=""
						className={cn("relative", ROW_TEXT)}
						style={{
							...editorTypeStyle,
							// Width leaves room for the left margin below — `w-full` plus
							// that margin overflowed the scroller by exactly the margin,
							// pinning a permanent horizontal scrollbar to the buffer.
							width: "calc(100% - var(--prompt-editor-margin-left, 0px))",
							maxWidth: EDITOR_METRICS.contentWidth,
							// LEFT-JUSTIFIED (2026-08-04 audit): the column starts at the
							// style rail's left margin instead of centering — in every
							// host (the old centerContent gate died with the in-margin
							// dock). Absolute overlays live inside this container and
							// ride along; hit-tests measure against its own rect, so
							// the offset never leaks into their math. Top margin adds
							// reading room above line 1.
							marginInline: "var(--prompt-editor-margin-left, 0px) auto",
							marginTop: "var(--prompt-editor-margin-top, 0px)",
							// Breathing room above line 1 / below the last line. One
							// line-height keeps the ruled-paper hairlines (drawn on
							// the scroller from y=0) aligned with row boundaries, and
							// row-metric offsets measure relative to this container's
							// border box, so absolute overlays stay aligned.
							paddingBlock: EDITOR_METRICS.lineHeight,
						}}
						onPointerDown={handleSurfacePointerDown}
						onMouseLeave={() => {
							setHoverNodeId(null);
							setHoverItemId(null);
							setHoverRow(null);
						}}
					>
						{/* THE structural-selection paint: ONE contiguous rounded
						    rect spanning the run's full row extent (top of its
						    first row → bottom of its last), so the zone reads as
						    a single object instead of stacked per-row washes
						    (which are suppressed inside the run — see XmlRow).
						    Geometry comes from rowMetrics — the same measured
						    offsets the guides read — so it tracks wrapped rows
						    and content changes with no extra listeners. Rendered
						    BEFORE the rows: the positioned rows paint above it,
						    keeping the wash beneath text. Hidden while a drag is
						    live — dimming and the ghost are the drag's feedback. */}
						{paintedGroupRange &&
							!drag.draggingId &&
							(() => {
								const first = rowMetrics[paintedGroupRange.start];
								const last = rowMetrics[paintedGroupRange.end];
								const top = first?.top ?? 0;
								const bottom = last ? last.top + last.height : top;
								return (
									<div
										data-prompt-selection-ring={`${paintedGroupRange.start}-${paintedGroupRange.end}`}
										className="pointer-events-none absolute inset-x-0 z-0 rounded-[4px]"
										style={{
											top,
											height: Math.max(bottom - top, 0),
											background: EDITOR_COLORS.selectionBg,
											border: `1px solid ${EDITOR_COLORS.selectionAccent}`,
										}}
									/>
								);
							})()}
						{lines.map((line, index) => {
							const rowInserts = insertsByRow.get(index);
							const rowRegions = regionsByStart.get(index);
							const rowReplaced = replacedRows.has(index);
							if (!rowInserts && !rowRegions && rowReplaced) {
								return null;
							}
							const entry = entriesById.get(line.nodeId);
							const nodeSelected =
								paintedSelectionRange !== undefined &&
								index >= paintedSelectionRange.start &&
								index <= paintedSelectionRange.end;
							const groupSelected =
								paintedGroupRange !== undefined &&
								index >= paintedGroupRange.start &&
								index <= paintedGroupRange.end;
							const selected = nodeSelected || groupSelected;
							// The selection FILL is unit-scoped like the hover wash
							// (ownership / item extent — see the rail-vs-fill note at
							// paintedSelectionRange); the rail spans `selected`.
							const selectionFill =
								flow.activeId !== undefined &&
								line.role !== "gap" &&
								(selectedItemRange !== undefined
									? index >= selectedItemRange.start &&
										index <= selectedItemRange.end
									: !selectedNodeIsList &&
										line.nodeId === flow.activeId);
							const inHighlight =
								highlightUnit !== null &&
								line.role !== "gap" &&
								(highlightUnit.kind === "item"
									? highlightItemRange !== undefined &&
										index >= highlightItemRange.start &&
										index <= highlightItemRange.end
									: line.nodeId === highlightUnit.id);
							const dragging =
								dragRange !== undefined &&
								index >= dragRange.start &&
								index <= dragRange.end;
							const flashing =
								flashRange !== undefined &&
								index >= flashRange.start &&
								index <= flashRange.end &&
								line.role !== "gap";
							// This row mounts THE handle only when it anchors the
							// resolved unit — one row in the whole surface, or none.
							const rowHandle =
								handleUnit && handleUnit.row === index
									? {
											kind: handleUnit.kind,
											indentCh: handleUnit.indentCh,
										}
									: undefined;
							// The item menu can only be open on the row mounting the
							// item-kind handle — itemMenu pins handleUnit to its item
							// while open, so rowHandle gates this correctly (the
							// block menu's exact pattern).
							const rowItemMenuOpen =
								rowHandle?.kind === "item" &&
								line.role === "item" &&
								line.itemIndex !== undefined &&
								itemMenu !== null &&
								itemMenu.itemId === line.itemId;

							return (
								<Fragment key={`${line.nodeId}:${index}:${line.role}`}>
									{rowInserts?.map((insert) => (
										<InlineInsertSlot
											key={insert.key}
											insert={insert}
											gutterWidth={gutterWidth}
										/>
									))}
									{rowRegions?.map((region) => (
										<StagedRegionView
											key={region.key}
											region={region}
											gutterWidth={gutterWidth}
										/>
									))}
									{!rowReplaced && (
								<XmlRow
									line={line}
									lineNumber={index + 1}
									gutterWidth={gutterWidth}
									entry={entry}
									selected={selected}
									selectionFill={selectionFill}
									inStructuralSelection={groupSelected}
									inHighlight={inHighlight}
									isSelectionStart={
										(nodeSelected &&
											paintedSelectionRange?.start === index) ||
										(groupSelected && paintedGroupRange?.start === index)
									}
									isSelectionEnd={
										(nodeSelected && paintedSelectionRange?.end === index) ||
										(groupSelected && paintedGroupRange?.end === index)
									}
									isLandmark={landmarkRows.has(index)}
									dragging={dragging}
									flashing={flashing}
									editing={
										editTarget?.nodeId === line.nodeId &&
										isEditingLine(editTarget, line)
									}
									editCaret={editTarget?.caret}
									editSeq={editTarget?.seq ?? 0}
									// The menu can only be open on the row that mounts the
									// block-kind handle — handleUnit pins to the menu's block
									// while it is open, so rowHandle gates this correctly.
									menuOpen={
										rowHandle?.kind === "block" && menuNodeId === line.nodeId
									}
									handle={rowHandle}
									canInsertChild={canHaveChildren(line.node)}
									prompt={prompt}
									onPromptChange={onPromptChange}
									onHoverNode={() => {
										if (drag.draggingId) return;
										setHoverNodeId(line.nodeId);
										// Item rows also name THE bullet under the pointer,
										// so the wash can scope to the one item instead of
										// every sibling sharing the list's nodeId.
										setHoverItemId(line.itemId ?? null);
										setHoverRow(index);
									}}
									onHoverGap={() => {
										if (drag.draggingId) return;
										// A gap belongs to no block: hovering one is hovering
										// nothing, so the handle retires.
										setHoverNodeId(null);
										setHoverItemId(null);
										setHoverRow(null);
									}}
									onSelect={() => {
										onSelectNode(line.nodeId);
										setEditTarget(null);
										setMenuNodeId(null);
										setItemMenu(null);
										setStructuralSelection(null);
									}}
									onStartEdit={(caret) => {
										if (!line.editable) return;
										focusEdit({
											nodeId: line.nodeId,
											itemIndex: line.itemIndex,
											caret,
										});
									}}
									onEndEdit={() => endEdit(editTarget?.seq ?? -1)}
									onEditorKeyDown={(event) => {
										if (handleSlashKey(event, line)) return;
										if (handleMarkerUndo(event, line)) return;
										handleEditorKey(event, line, keyContext);
									}}
									onEditorChange={(next, element) =>
										handleEditorChange(line, next, element)
									}
									editorAria={
										slash && slash.nodeId === line.nodeId
											? {
													role: "combobox",
													"aria-expanded": true,
													"aria-autocomplete": "list",
													"aria-controls": SLASH_MENU_LISTBOX_ID,
													...(slashActiveOptionId
														? {
																"aria-activedescendant":
																	slashActiveOptionId,
															}
														: {}),
												}
											: undefined
									}
									onToggleMenu={() =>
										setMenuNodeId((current) =>
											current === line.nodeId ? null : line.nodeId,
										)
									}
									onCloseMenu={() => setMenuNodeId(null)}
									onInsertChild={(type) =>
										flow.insertBlock(type, line.nodeId, "child")
									}
									onDuplicate={() => flow.duplicateBlock(line.nodeId)}
									onRetag={(tag) =>
										entry && retagSection(prompt, entry, tag, onPromptChange)
									}
									onRemove={() => entry && flow.removeBlock(entry)}
									onDragHandleDown={(event) => {
										if (!entry) return;
										// Grabbing the handle of ANY unit inside the
										// selected run drags the whole run as one
										// object; grabbing an outside block retires
										// the selection and drags just that block.
										// Membership is POSITIONAL (row inside the run's
										// extent) — an id check misses units nested
										// inside a promoted run (a paragraph in a
										// selected section is not a top-level id).
										if (
											blockGroup &&
											index >= blockGroup.rowRange.start &&
											index <= blockGroup.rowRange.end
										) {
											drag.startBlockRunDrag(event, {
												parentId: blockGroup.parentId,
												fromIndex: blockGroup.fromIndex,
												count: blockGroup.count,
												blockIds: blockGroup.blockIds,
												grabbedId: line.nodeId,
											});
											return;
										}
										if (blockGroup) setStructuralSelection(null);
										drag.startDrag(event, line.nodeId);
									}}
									onItemHandleDown={(event) => {
										if (line.itemId === undefined) return;
										if (line.itemIndex === undefined) return;
										// A blocks-kind zone containing this bullet is still
										// "the one object": grabbing the bullet's handle inside
										// the zone lifts the whole run, same as grabbing a
										// block grip inside it. Positional membership — the
										// bullet's list may be nested inside a promoted run.
										if (
											blockGroup &&
											index >= blockGroup.rowRange.start &&
											index <= blockGroup.rowRange.end
										) {
											drag.startBlockRunDrag(event, {
												parentId: blockGroup.parentId,
												fromIndex: blockGroup.fromIndex,
												count: blockGroup.count,
												blockIds: blockGroup.blockIds,
												grabbedId: line.nodeId,
											});
											return;
										}
										if (blockGroup) setStructuralSelection(null);
										// Grabbing a SELECTED item's handle carries the whole
										// contiguous group as one object; grabbing any other
										// item retires the group and drags just that item.
										if (
											itemGroup &&
											itemGroup.count > 1 &&
											itemGroup.listId === line.nodeId &&
											line.itemIndex >= itemGroup.fromIndex &&
											line.itemIndex <
												itemGroup.fromIndex + itemGroup.count
										) {
											drag.startItemDrag(event, {
												listId: itemGroup.listId,
												itemId: line.itemId,
												itemIndex: itemGroup.fromIndex,
												count: itemGroup.count,
												itemIds: itemGroup.itemIds,
											});
											return;
										}
										setStructuralSelection(null);
										drag.startItemDrag(event, {
											listId: line.nodeId,
											itemId: line.itemId,
											itemIndex: line.itemIndex,
										});
									}}
									onItemShiftClick={
										line.role === "item"
											? () => handleItemShiftClick(line)
											: undefined
									}
									itemMenuOpen={rowItemMenuOpen}
									onToggleItemMenu={() => {
										const itemId = line.itemId;
										const itemIndex = line.itemIndex;
										if (itemId === undefined || itemIndex === undefined) {
											return;
										}
										setItemMenu((current) =>
											current?.itemId === itemId
												? null
												: { listId: line.nodeId, itemId, itemIndex },
										);
									}}
									onCloseItemMenu={() => setItemMenu(null)}
									// Indent needs a previous sibling to nest under
									// (nestListItemStep's precondition) …
									canItemIndent={
										rowItemMenuOpen && (line.itemIndex ?? 0) > 0
									}
									// … and Outdent needs the list to be nested inside an
									// item (unnestListItemStep's precondition, resolved by
									// the same locator the keymap's Shift+Tab uses).
									canItemOutdent={
										rowItemMenuOpen &&
										findUnnestLocation(
											prompt,
											line.nodeId,
											line.itemIndex ?? 0,
										) !== undefined
									}
									onItemDuplicate={() => {
										if (line.itemIndex === undefined) return;
										const result = duplicateListItemStep(
											prompt,
											line.nodeId,
											line.itemIndex,
										);
										if (!result.step) return;
										onPromptChange(result.prompt, line.nodeId, [result.step]);
									}}
									// Indent / Outdent / Delete apply their steps through
									// the exact plumbing the keymap's Tab / Shift+Tab /
									// Backspace paths use (editor-keymap.ts applyTab and
									// remove-empty-item) — same step producers, same
									// onPromptChange shape, no parallel mutation path.
									onItemIndent={() => {
										if (line.itemIndex === undefined || line.itemIndex <= 0) {
											return;
										}
										const result = nestListItemStep(
											prompt,
											line.nodeId,
											line.itemIndex,
										);
										if (!result.step) return;
										onPromptChange(result.prompt, line.nodeId, [result.step]);
									}}
									onItemOutdent={() => {
										if (line.itemIndex === undefined) return;
										const location = findUnnestLocation(
											prompt,
											line.nodeId,
											line.itemIndex,
										);
										if (!location) return;
										const result = unnestListItemStep(
											prompt,
											location.outerListId,
											location.parentItemIndex,
											line.itemIndex,
											line.nodeId,
										);
										if (!result.step) return;
										onPromptChange(result.prompt, location.outerListId, [
											result.step,
										]);
									}}
									onItemRemove={() => {
										if (line.itemIndex === undefined) return;
										// The keymap's empty-list rule: deleting a list's
										// LAST item removes the list itself.
										const list = line.node;
										const removesWholeList =
											(list.type === "bulletList" ||
												list.type === "orderedList") &&
											list.items.length <= 1;
										if (removesWholeList) {
											const removed = removeListWithStep(
												prompt,
												line.nodeId,
											);
											if (!removed.step) return;
											onPromptChange(removed.prompt, undefined, [
												removed.step,
											]);
											return;
										}
										const result = removeListItemStep(
											prompt,
											line.nodeId,
											line.itemIndex,
										);
										if (!result.step) return;
										onPromptChange(result.prompt, line.nodeId, [result.step]);
									}}
								/>
									)}
								</Fragment>
							);
						})}

						{/* Indent guides: thin bracket-style hairlines connecting a
						    container's open tag to its close tag. Positioned from
						    measured row offsets so wrapped rows don't misalign them. */}
						{guides.map((guide) => {
							const openRow = rowMetrics[guide.start];
							const closeRow = rowMetrics[guide.end];
							if (!openRow || !closeRow) return null;
							// Start just under the open tag's first line; stop at the
							// top of the close tag's line (bracket-guide idiom).
							// Top-level opens carry the landmark band's block padding,
							// so their guide starts under the whole measured band.
							const top =
								guide.depth === 0
									? openRow.top + openRow.height
									: openRow.top + openRow.lineHeight;
							const bottom = closeRow.top;
							if (bottom <= top) return null;
							return (
								<div
									key={`guide:${guide.nodeId}:${guide.start}`}
									className="pointer-events-none absolute z-0 w-px"
									style={{
										top,
										height: bottom - top,
										// The container's text column: gutter, then the body's
										// 0.75rem padding, then the container's own text
										// indent — the guide sits exactly under its open
										// tag's first character.
										left: `calc(${gutterWidth} + 0.75rem + ${promptFlowIndentForDepth(
											guide.depth,
										)})`,
										background: EDITOR_COLORS.guide,
										display:
											"var(--prompt-editor-guides-display, block)",
									}}
								/>
							);
						})}

					</div>
				)}
				</div>
				{outlineShown && (
					<SectionOutline
						sections={sections}
						activeRow={activeSectionRow}
						onSelect={scrollToSection}
					/>
				)}
			</div>

			{slash && (
				<SlashMenu
					query={slash.query}
					anchor={slash.anchor}
					selectedIndex={slash.selectedIndex}
					onSelect={chooseSlashCommand}
					onHoverIndex={(index) =>
						setSlash((current) =>
							current ? { ...current, selectedIndex: index } : current,
						)
					}
					onDismiss={() => setSlash(null)}
				/>
			)}

			<DragGhost drag={drag} />
			<DropIndicator drag={drag} gutterWidth={gutterWidth} />
		</section>
	);
}

/**
 * Which ONE of a node's rows owns the caret. A node can render several rows —
 * a code block draws two fences around its body, a section draws two tags, a
 * list draws a row per item — and exactly one of them may mount the editor.
 * Two editors sharing an edit target fight over focus, and the loser's blur
 * cancels the winner's edit.
 */
function isEditingLine(target: InlineEditTarget, line: XmlLine): boolean {
	// Structural rows (fences, close tags, gaps) never hold the caret.
	if (!line.editable) return false;
	if (line.role === "item") return target.itemIndex === line.itemIndex;
	// Multi-line leaf nodes (raw/code) edit as a single textarea anchored on
	// their first content line.
	if (line.contentLineIndex !== undefined) return line.contentLineIndex === 0;
	return true;
}

/** A just-converted section's tag, for pre-selecting the placeholder name. */
function sectionTagOf(prompt: PromptFlowViewProps["prompt"], nodeId: string): string {
	const found = findSection(prompt.nodes, nodeId);
	return found ?? "";
}

function findSection(
	nodes: readonly PromptBlockNode[],
	nodeId: string,
): string | undefined {
	for (const node of nodes) {
		if (node.id === nodeId && node.type === "section") return node.tag;
		const children =
			node.type === "section" || node.type === "example"
				? node.children
				: node.type === "field"
					? (node.children ?? [])
					: node.type === "contextUsage"
						? node.instructions
						: undefined;
		if (!children) continue;
		const found = findSection(children, nodeId);
		if (found !== undefined) return found;
	}
	return undefined;
}

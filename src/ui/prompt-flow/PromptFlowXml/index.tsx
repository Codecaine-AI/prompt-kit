// Slice: composition root for the Agent XML editing surface — layout + wiring
// only; row rendering, affordances, drag, and mutations live in siblings.
"use client";

import cn from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PromptBlockNode } from "../../../index";
import {
	editableTextToInline,
	type PromptEditorTreeEntry,
} from "../../editors";

import {
	EDITOR_COLORS,
	EDITOR_METRICS,
	LINE_HEIGHT_PX,
	PROMPT_EDITOR_ROOT_CLASS,
	editorRuleBackground,
	editorTypeStyle,
	promptEditorGutterWidth,
	promptEditorIndentForDepth,
} from "../../surface/editor-surface";
import {
	EmptyFlow,
	canHaveChildren,
	usePromptFlowInteractions,
} from "../PromptFlowShared";
import type { PromptFlowViewProps } from "../types";
import { buildXmlLineModel, type XmlLine } from "../xml-line-model";
import { resolveAutoformat } from "./autoformat";
import { caretAnchor } from "./caret-rect";
import { DragGhost, DropIndicator, useXmlDrag } from "./drag-controller";
import {
	handleEditorKey,
	type EditTarget,
	type EditorKeyContext,
} from "./editor-keymap";
import {
	computeGuides,
	computeLandmarks,
	computeNodeRanges,
	trimPaintedNodeRange,
	useRowMetrics,
} from "./node-geometry";
import {
	commitEdit,
	editorValueForLine,
	registerNestedLists,
	removeListItemOrList,
	retagSection,
} from "./node-mutations";
import { SectionOutline, type OutlineSection } from "./SectionOutline";
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
} from "./structure-steps";
import { XmlRow } from "./XmlRow";

/**
 * Agent XML editing surface. At rest it renders continuous, dense,
 * syntax-colored XML on a STRICT single-line grid that visually matches the
 * read-only Raw view (same mono metrics, one cumulative line-number gutter,
 * shared highlighter). The editorial layer speaks the code editor's own
 * structural vocabulary — a rigid gutter, bracket-style indent guides, faint
 * section landmarks, git-diff change-bars on hover — and never card/box
 * chrome. Drag handles, insert affordances, and inline editing only appear on
 * hover / interaction, so toggling Raw ↔ editor feels like toggling
 * editability rather than opening a different document.
 *
 * Line numbers track Raw line-for-line because the row model comes from
 * buildXmlLineModel, whose concatenation is guaranteed (by test) to equal
 * renderXmlMarkdown — the exact string Raw shows.
 */

// Line-height / font metrics + palette live in the shared editor-surface
// module so this flow and the Raw view render on one grid with one palette.
const ROW_TEXT = "font-mono";

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
	onPromptChange,
	showOutline = false,
}: PromptFlowViewProps & {
	/**
	 * Render the top-level section outline column beside the buffer. Hosts
	 * pass false only when the pane is too narrow to carry it.
	 */
	showOutline?: boolean;
}) {
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
	const [hoverItem, setHoverItem] = useState<{
		nodeId: string;
		itemIndex: number;
	} | null>(null);
	const [editTarget, setEditTarget] = useState<InlineEditTarget | null>(null);
	// The block menu ([⋮⋮] click) opens for one block at a time, anchored to its
	// first row so every block affordance stays in the one left cluster.
	const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
	// The slash menu, when `/` opened one. The caret rect is a snapshot taken on
	// each keystroke, so the menu tracks the query as it grows.
	const [slash, setSlash] = useState<
		(SlashSession & { anchor: SlashMenuAnchor }) | null
	>(null);
	const editSeqRef = useRef(0);
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
	 * Single entry point for putting the caret somewhere. Selection follows the
	 * caret so the accent bar always marks the block being typed into.
	 */
	const focusEdit = useCallback(
		(target: EditTarget) => {
			editSeqRef.current += 1;
			setEditTarget({ ...target, seq: editSeqRef.current });
			setMenuNodeId(null);
			// Any caret move retires the slash menu: it is anchored to one caret
			// on one line and has nothing to say about the row it moved to.
			setSlash(null);
			onSelectNode(target.nodeId);
		},
		[onSelectNode],
	);

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
	// must never silently destroy a block's text.
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
			commitEdit(prompt, entry, line, next, onPromptChange);
			focusEdit({
				nodeId: line.nodeId,
				itemIndex: line.itemIndex,
				caret: next.length,
			});
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
	// The outline column reuses the landmark rows: one entry per top-level
	// open tag, labeled with the bare tag name.
	const sections = useMemo<OutlineSection[]>(() => {
		const result: OutlineSection[] = [];
		lines.forEach((line, index) => {
			if (!landmarkRows.has(index)) return;
			const label =
				line.node.type === "section"
					? line.node.tag
					: line.text.trim().replace(/^<\/?/, "").replace(/\/?>$/, "");
			result.push({ row: index, label });
		});
		return result;
	}, [lines, landmarkRows]);
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

	const drag = useXmlDrag({
		lines,
		nodeRanges,
		entriesById,
		rowsRef,
		scrollRef,
		moveNear: flow.moveNear,
	});

	const gutterWidthFallback = useMemo(() => {
		const digits = Math.max(2, String(lines.length).length);
		return `${digits + 3}ch`;
	}, [lines.length]);
	const gutterWidth = promptEditorGutterWidth(gutterWidthFallback);

	const highlightNodeId = editTarget?.nodeId ?? drag.draggingId ?? hoverNodeId;
	const highlightRange = highlightNodeId
		? nodeRanges.get(highlightNodeId)
		: undefined;
	const paintedHighlightRange = trimPaintedNodeRange(lines, highlightRange);
	const selectedRange = flow.activeId
		? nodeRanges.get(flow.activeId)
		: undefined;
	const paintedSelectionRange = trimPaintedNodeRange(lines, selectedRange);
	// The dragged / flashed block dims / flashes across its ENTIRE visual line
	// range (including nested child rows), so the whole object reads as lifted
	// out and the drop flash covers everything the ghost showed.
	const dragRange = drag.draggingId
		? nodeRanges.get(drag.draggingId)
		: undefined;
	const flashRange = drag.flashNodeId
		? nodeRanges.get(drag.flashNodeId)
		: undefined;

	return (
		<section
			className={cn(
				PROMPT_EDITOR_ROOT_CLASS,
				"flex h-full min-h-0 flex-1 flex-col",
			)}
			style={{ background: EDITOR_COLORS.bg, color: EDITOR_COLORS.fg }}
			onClick={() => {
				onSelectNode(undefined);
				setEditTarget(null);
				setMenuNodeId(null);
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
				onScroll={outlineShown ? updateActiveSection : undefined}
				style={{
					background: EDITOR_COLORS.bg,
					// Rows carry their own type; the scroller repeats the font so the
					// `ch`-based max width below resolves in editor characters rather
					// than the shell's.
					fontFamily: EDITOR_METRICS.fontFamily,
					fontSize: EDITOR_METRICS.fontSize,
					...editorRuleBackground,
					// Alongside the outline the buffer stops at the content width,
					// so the column hugs the text instead of stranding a band of
					// empty canvas between them.
					...(outlineShown ? { maxWidth: EDITOR_METRICS.contentWidth } : null),
				}}
			>
				{model.tree.length === 0 ? (
					<div className="p-4">
						<EmptyFlow onInsert={(type) => flow.insertBlock(type, null)} />
					</div>
				) : (
					<div
						ref={rowsRef}
						className={cn("relative w-full", ROW_TEXT)}
						style={{
							...editorTypeStyle,
							maxWidth: EDITOR_METRICS.contentWidth,
							// Breathing room above line 1 / below the last line. One
							// line-height keeps the ruled-paper hairlines (drawn on
							// the scroller from y=0) aligned with row boundaries, and
							// row-metric offsets measure relative to this container's
							// border box, so absolute overlays stay aligned.
							paddingBlock: EDITOR_METRICS.lineHeight,
						}}
						onMouseLeave={() => {
							setHoverNodeId(null);
							setHoverItem(null);
						}}
					>
						{lines.map((line, index) => {
							const entry = entriesById.get(line.nodeId);
							const range = nodeRanges.get(line.nodeId);
							const selected =
								paintedSelectionRange !== undefined &&
								index >= paintedSelectionRange.start &&
								index <= paintedSelectionRange.end;
							const inHighlight =
								paintedHighlightRange !== undefined &&
								index >= paintedHighlightRange.start &&
								index <= paintedHighlightRange.end;
							const isRangeStart = range?.start === index;
							const isRangeEnd = range?.end === index;
							const dragging =
								dragRange !== undefined &&
								index >= dragRange.start &&
								index <= dragRange.end;
							const flashing =
								flashRange !== undefined &&
								index >= flashRange.start &&
								index <= flashRange.end &&
								line.role !== "gap";
							const affordanceVisible =
								highlightNodeId === line.nodeId ||
								flow.activeId === line.nodeId ||
								menuNodeId === line.nodeId;

							return (
								<XmlRow
									key={`${line.nodeId}:${index}:${line.role}`}
									line={line}
									lineNumber={index + 1}
									gutterWidth={gutterWidth}
									entry={entry}
									selected={selected}
									inHighlight={inHighlight}
									isSelectionStart={
										selected && paintedSelectionRange?.start === index
									}
									isSelectionEnd={
										selected && paintedSelectionRange?.end === index
									}
									isRangeStart={isRangeStart}
									isRangeEnd={isRangeEnd}
									isLandmark={landmarkRows.has(index)}
									dragging={dragging}
									flashing={flashing}
									editing={
										editTarget?.nodeId === line.nodeId &&
										isEditingLine(editTarget, line)
									}
									editCaret={editTarget?.caret}
									editSeq={editTarget?.seq ?? 0}
									menuOpen={menuNodeId === line.nodeId && isRangeStart}
									affordanceVisible={affordanceVisible}
									canInsertChild={canHaveChildren(line.node)}
									itemHovered={
										line.role === "item" &&
										hoverItem?.nodeId === line.nodeId &&
										hoverItem.itemIndex === line.itemIndex
									}
									prompt={prompt}
									onPromptChange={onPromptChange}
									onHoverNode={() => {
										if (drag.draggingId) return;
										setHoverNodeId(line.nodeId);
										if (line.role === "item" && line.itemIndex !== undefined) {
											setHoverItem({
												nodeId: line.nodeId,
												itemIndex: line.itemIndex,
											});
										} else {
											setHoverItem(null);
										}
									}}
									onHoverGap={() => {
										if (drag.draggingId) return;
										// A gap belongs to no block: hovering one is hovering
										// nothing, so every block affordance retires.
										setHoverNodeId(null);
										setHoverItem(null);
									}}
									onSelect={() => {
										onSelectNode(line.nodeId);
										setEditTarget(null);
										setMenuNodeId(null);
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
									onRemoveItem={() =>
										removeListItemOrList(
											prompt,
											line,
											entry,
											onPromptChange,
											flow.removeBlock,
										)
									}
									onDragHandleDown={(event) =>
										entry && drag.startDrag(event, line.nodeId)
									}
								/>
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
							const top = openRow.top + openRow.lineHeight;
							const bottom = closeRow.top;
							if (bottom <= top) return null;
							return (
								<div
									key={`guide:${guide.nodeId}:${guide.start}`}
									className="pointer-events-none absolute z-0 w-px"
									style={{
										top,
										height: bottom - top,
										left: `calc(${gutterWidth} + ${promptEditorIndentForDepth(
											guide.depth,
										)} + 0.55ch)`,
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

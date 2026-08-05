import type {
	CodeBlockNode,
	ContextUsageNode,
	ExampleNode,
	FieldNode,
	PromptBlockNode,
	PromptDocument,
	PromptListNode,
	RawNode,
	SectionNode,
} from "../nodes/types";
import {
	createRenderContext,
	escapeXmlAttribute,
	escapeXmlText,
	indent,
	renderInline,
	renderXmlMarkdown,
	type XmlMarkdownRenderContext,
} from "./index";

/**
 * The Agent XML editing surface renders the *same* text the read-only Raw view
 * renders, but as an editable, per-line model. To guarantee the editor's line
 * numbers track Raw's line-for-line, this module mirrors the prompt-kit XML
 * renderer (renderNode / renderNodes in prompt-kit) exactly — same indentation,
 * same `\n\n` separator between sibling blocks, same `\n` framing around section
 * bodies — but instead of a flat string it emits one `XmlLine` per rendered
 * line, tagged with the owning node so hover/selection/drag/inline-edit layers
 * can attach.
 *
 * INVARIANT (verified by xml-line-model.test.ts): joining every line's `text`
 * with "\n" equals `renderXmlMarkdown(prompt)`. If prompt-kit's renderer changes
 * its layout, that test fails and this mirror must be updated in lockstep.
 */

export type XmlLineRole =
	/** Blank separator line the renderer emits between sibling blocks. */
	| "gap"
	/** Opening tag of a container (section / example / contextUsage). */
	| "open"
	/** Closing tag of a container. */
	| "close"
	/** A single editable line of leaf content (paragraph, field, raw, code). */
	| "content"
	/** Code fence line (``` open/close). */
	| "fence"
	/** A list item line. */
	| "item";

export interface XmlLine {
	/** Rendered text for this line (exactly what Raw shows on the same row). */
	text: string;
	/** Owning block node. */
	node: PromptBlockNode;
	/** Node id (blocks always carry ids in the editor model). */
	nodeId: string;
	/** Nesting depth, matching PromptEditorTreeEntry.depth (top level = 0). */
	depth: number;
	role: XmlLineRole;
	/**
	 * Whether clicking the line's text region should open an inline text editor
	 * for this node: the primary content line of a leaf node, and a section's
	 * open tag (whose editable value is the bare tag name). Close tags, fences
	 * and gaps are structural.
	 */
	editable: boolean;
	/** For list nodes: which item this line renders (0-based). */
	itemIndex?: number;
	/**
	 * For item lines: the rendered item's OWN id (`node.items[itemIndex].id`).
	 * Items are annotation targets in their own right; overlay layers stamp
	 * this id on the row instead of the list's.
	 */
	itemId?: string;
	/**
	 * Id of the enclosing parent block for this line's target node — the list
	 * for an item line, the section for a paragraph inside it. Undefined at
	 * the top level. Lets targeting expand a leaf to its parent (Alt-hover).
	 */
	parentNodeId?: string;
	/** For multi-line leaf content (raw / code): line offset within the node. */
	contentLineIndex?: number;
}

interface Cursor {
	depth: number;
	ctx: XmlMarkdownRenderContext;
	lines: XmlLine[];
}

/**
 * The lines of a node's full rendered EXTENT, in document order, excluding
 * `gap` separators (a gap's node is merely the block that follows it — the
 * blank row belongs to no node visually). For a leaf this is its
 * content/fence rows; for a container it is everything from its first own
 * line to its last descendant line — a section spans open tag through close
 * tag with every child line in between, a list spans its item lines plus any
 * blocks nested in its items. Range-annotation offsets index this extent's
 * text (see `nodeRenderedText`), so a container-anchored range can quote a
 * swath across several children.
 *
 * `nodeId` may also be a LIST ITEM's id (`itemId` on item lines): the item
 * resolves to its own line plus any blocks nested in it. A list's id still
 * collects every item line, since item lines carry the list id as their
 * `nodeId`.
 *
 * A node renders contiguously, so the extent is the slice between the node's
 * first and last OWN lines — extended past the last own line while the
 * following lines still belong to the node's subtree (a list's own lines are
 * its item markers, so blocks nested in the FINAL item render after them).
 */
export function nodeRenderedLines(
	lines: readonly XmlLine[],
	nodeId: string,
): XmlLine[] {
	let first = -1;
	let last = -1;
	lines.forEach((line, index) => {
		if (line.role === "gap") return;
		if (line.nodeId !== nodeId && line.itemId !== nodeId) return;
		if (first === -1) first = index;
		last = index;
	});
	if (first === -1) return [];

	// Line-derived child → parent links, enough to chase trailing descendants:
	// blocks nested in an item chain block → item → list without needing the
	// list's own parent (which the line model does not record).
	const parents = new Map<string, string>();
	for (const line of lines) {
		if (line.role === "gap") continue;
		const target = line.itemId ?? line.nodeId;
		// First write wins — duplicated ids must not corrupt a recorded chain.
		if (line.parentNodeId && !parents.has(target)) {
			parents.set(target, line.parentNodeId);
		}
	}
	const inSubtree = (id: string): boolean => {
		const seen = new Set<string>();
		let current: string | undefined = id;
		while (current !== undefined && !seen.has(current)) {
			if (current === nodeId) return true;
			seen.add(current);
			current = parents.get(current);
		}
		return false;
	};
	for (let index = last + 1; index < lines.length; index += 1) {
		const line = lines[index]!;
		// A gap belongs to whatever follows it; the next real line decides.
		if (line.role === "gap") continue;
		if (!inSubtree(line.itemId ?? line.nodeId)) break;
		last = index;
	}

	return lines
		.slice(first, last + 1)
		.filter((line) => line.role !== "gap");
}

/**
 * A node's rendered text: its `nodeRenderedLines` texts joined with "\n".
 * Each line keeps its leading indentation — the text is exactly the rows the
 * editor (and Raw) show for the node, newline-separated. `prompt-range`
 * annotation offsets index THIS string.
 */
export function nodeRenderedText(
	lines: readonly XmlLine[],
	nodeId: string,
): string {
	return nodeRenderedLines(lines, nodeId)
		.map((line) => line.text)
		.join("\n");
}

/**
 * The XML entities the renderer's escaping can put into a line's `text`, and
 * the characters prose display shows for them. `&amp;` MUST decode in the same
 * single pass as the rest (see decodeXmlEntities) — sequential replaces would
 * turn a literal `&amp;lt;` into `<`.
 */
export const XML_DISPLAY_ENTITIES: Readonly<Record<string, string>> = {
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&apos;": "'",
	"&amp;": "&",
};

const XML_ENTITY_REGEX = /&(?:lt|gt|amp|quot|apos);/g;

/** Decodes the display entities in one pass (never re-decodes a decode). */
export function decodeXmlEntities(text: string): string {
	return text.replace(
		XML_ENTITY_REGEX,
		(entity) => XML_DISPLAY_ENTITIES[entity] ?? entity,
	);
}

/**
 * Whether the editor DISPLAYS this row's text with XML entities decoded —
 * prose the renderer escaped on the way out: paragraph / field content rows
 * and list-item rows (whose display is built from the model's inline content,
 * which was never escaped). Structural rows (tags, fences) and raw / code
 * content rows show the model text verbatim: their text was never escaped, so
 * a literal `&lt;` there really is the four characters.
 *
 * BOTH sides of the DOM↔model bridge key off this: the read-mode renderer
 * (XmlRow/RowText) decides to decode with it, and the annotate-mode offset
 * walk (`modelOffsetFromDom`) decides to consume whole entities with it. They
 * must agree or Cmd+drag offsets misalign.
 */
export function lineRendersDecodedEntities(line: XmlLine): boolean {
	if (line.role === "item") return true;
	if (line.role !== "content") return false;
	return line.node.type === "paragraph" || line.node.type === "field";
}

export interface XmlLineModel {
	lines: XmlLine[];
	/** The whole-document render, identical to Raw's source string. */
	rendered: string;
}

export function buildXmlLineModel(
	prompt: PromptDocument,
	options: { variables?: Record<string, unknown> } = {},
): XmlLineModel {
	const ctx = createRenderContext({ variables: options.variables });
	const cursor: Cursor = { depth: 0, ctx, lines: [] };
	emitNodes(prompt.nodes, 0, cursor);
	return {
		lines: cursor.lines,
		rendered: renderXmlMarkdown(prompt, { variables: options.variables }),
	};
}

/**
 * Mirror of prompt-kit `renderNodes`: render each non-empty block and join with
 * a blank line. We insert an explicit `gap` line between rendered siblings so
 * cumulative line numbers include the blank rows Raw shows.
 */
function emitNodes(
	nodes: readonly PromptBlockNode[],
	level: number,
	cursor: Cursor,
	parentNodeId?: string,
): void {
	let first = true;
	for (const node of nodes) {
		const before = cursor.lines.length;
		emitNode(node, level, cursor, parentNodeId);
		const produced = cursor.lines.length > before;
		if (!produced) continue; // renderNodes filters empty renders
		if (!first) {
			// The blank separator belongs *before* this block's first line.
			insertGapBefore(cursor, before, node, level);
		}
		first = false;
	}
}

function insertGapBefore(
	cursor: Cursor,
	index: number,
	node: PromptBlockNode,
	level: number,
): void {
	const gap: XmlLine = {
		text: "",
		node,
		nodeId: requireId(node),
		depth: level,
		role: "gap",
		editable: false,
	};
	cursor.lines.splice(index, 0, gap);
}

function emitNode(
	node: PromptBlockNode,
	level: number,
	cursor: Cursor,
	parentNodeId?: string,
): void {
	switch (node.type) {
		case "section":
			emitSection(
				node,
				node.tag,
				node.attrs,
				node.children,
				level,
				cursor,
				parentNodeId,
			);
			return;
		case "example":
			emitExample(node, level, cursor, parentNodeId);
			return;
		case "contextUsage":
			emitContextUsage(node, level, cursor, parentNodeId);
			return;
		case "paragraph":
			pushLine(cursor, {
				text: `${indent(level, cursor.ctx.indentText)}${renderInline(node.content, cursor.ctx)}`,
				node,
				depth: level,
				role: "content",
				editable: true,
				parentNodeId,
			});
			return;
		case "bulletList":
		case "orderedList":
			emitList(node, level, cursor);
			return;
		case "field":
			emitField(node, level, cursor, parentNodeId);
			return;
		case "codeBlock":
			emitCodeBlock(node, level, cursor, parentNodeId);
			return;
		case "raw":
			emitRaw(node, level, cursor, parentNodeId);
			return;
	}
}

function emitSection(
	node: SectionNode | ExampleNode | ContextUsageNode,
	tag: string,
	attrs: SectionNode["attrs"] | undefined,
	children: readonly PromptBlockNode[],
	level: number,
	cursor: Cursor,
	parentNodeId?: string,
): void {
	const pad = indent(level, cursor.ctx.indentText);
	pushLine(cursor, {
		text: `${pad}${renderOpenTag(tag, attrs)}`,
		node,
		depth: level,
		role: "open",
		// A section's open tag IS its name, so the tag is editable in place —
		// naming a section is typing, not a menu. Example / contextUsage tags are
		// derived from their own fields, and an attributed tag renders more than
		// a name, so those open lines stay structural.
		editable: node.type === "section" && !hasRenderedAttributes(attrs),
		parentNodeId,
	});
	emitNodes(children, level + 1, cursor, requireId(node));
	pushLine(cursor, {
		text: `${pad}</${tag}>`,
		node,
		depth: level,
		role: "close",
		editable: false,
		parentNodeId,
	});
}

function emitExample(
	node: ExampleNode,
	level: number,
	cursor: Cursor,
	parentNodeId?: string,
): void {
	const attrs = node.title ? { title: node.title } : undefined;
	emitSection(node, "example", attrs, node.children, level, cursor, parentNodeId);
}

function emitContextUsage(
	node: ContextUsageNode,
	level: number,
	cursor: Cursor,
	parentNodeId?: string,
): void {
	emitSection(
		node,
		node.tag ?? "context_usage",
		{ context_id: node.contextId },
		node.instructions,
		level,
		cursor,
		parentNodeId,
	);
}

/**
 * Mirror of `renderList` + `renderListItem`: items joined by "\n" (no blank
 * separator). Item children render at level+1 as a nested block group joined by
 * "\n" to the item line — but since the prompt-flow editor does not currently
 * surface list-item children inline, we render them faithfully as content lines
 * so the whole-doc string still matches.
 */
function emitList(node: PromptListNode, level: number, cursor: Cursor): void {
	const start = node.type === "orderedList" ? (node.start ?? 1) : 0;
	const pad = indent(level, cursor.ctx.indentText);
	const listId = requireId(node);
	node.items.forEach((item, index) => {
		const marker = node.type === "orderedList" ? `${start + index}.` : "-";
		const text = `${pad}${marker} ${renderInline(item.content, cursor.ctx)}`.trimEnd();
		pushLine(cursor, {
			text,
			node,
			depth: level,
			role: "item",
			editable: true,
			itemIndex: index,
			// The item is its own annotation target; the list is its parent.
			itemId: item.id,
			parentNodeId: listId,
		});
		const children = item.children ?? [];
		if (children.length > 0) {
			// renderListItem joins the item line to its children with a single
			// "\n" (no blank line). emitNodes only inserts gaps *between*
			// siblings, so the first child abuts the item line as required.
			// Blocks nested in an item parent to the ITEM (falling back to the
			// list when the item carries no id).
			emitNodes(children, level + 1, cursor, item.id ?? listId);
		}
	});
}

function emitField(
	node: FieldNode,
	level: number,
	cursor: Cursor,
	parentNodeId?: string,
): void {
	const pad = indent(level, cursor.ctx.indentText);
	const value = renderInline(node.value, cursor.ctx);
	const line = `${pad}${escapeXmlText(node.label)}: ${value}`.trimEnd();
	pushLine(cursor, {
		text: line,
		node,
		depth: level,
		role: "content",
		editable: true,
		parentNodeId,
	});
	const children = node.children ?? [];
	if (children.length > 0) emitNodes(children, level + 1, cursor, requireId(node));
}

function emitCodeBlock(
	node: CodeBlockNode,
	level: number,
	cursor: Cursor,
	parentNodeId?: string,
): void {
	const pad = indent(level, cursor.ctx.indentText);
	pushLine(cursor, {
		text: `${pad}\`\`\`${node.language ?? ""}`,
		node,
		depth: level,
		role: "fence",
		editable: false,
		parentNodeId,
	});
	const codeLines = node.code.split("\n");
	codeLines.forEach((raw, index) => {
		pushLine(cursor, {
			// indentMultiline leaves empty lines empty; non-empty get the pad.
			text: raw.length > 0 ? `${pad}${raw}` : raw,
			node,
			depth: level,
			role: "content",
			editable: true,
			contentLineIndex: index,
			parentNodeId,
		});
	});
	pushLine(cursor, {
		text: `${pad}\`\`\``,
		node,
		depth: level,
		role: "fence",
		editable: false,
		parentNodeId,
	});
}

function emitRaw(
	node: RawNode,
	level: number,
	cursor: Cursor,
	parentNodeId?: string,
): void {
	const pad = indent(level, cursor.ctx.indentText);
	const rawLines = node.value.split("\n");
	rawLines.forEach((raw, index) => {
		pushLine(cursor, {
			text: raw.length > 0 ? `${pad}${raw}` : raw,
			node,
			depth: level,
			role: "content",
			editable: true,
			contentLineIndex: index,
			parentNodeId,
		});
	});
}

/** True when `attrs` puts anything after the tag name in the rendered line. */
function hasRenderedAttributes(attrs?: SectionNode["attrs"]): boolean {
	return Object.values(attrs ?? {}).some(
		(value) => value !== null && value !== undefined,
	);
}

function renderOpenTag(
	tag: string,
	attrs?: SectionNode["attrs"],
): string {
	const renderedAttrs = Object.entries(attrs ?? {})
		.filter((entry): entry is [string, string | number | boolean] => {
			const value = entry[1];
			return value !== null && value !== undefined;
		})
		.map(([key, value]) => `${key}="${escapeXmlAttribute(String(value))}"`);
	if (renderedAttrs.length === 0) return `<${tag}>`;
	return `<${tag} ${renderedAttrs.join(" ")}>`;
}

function pushLine(
	cursor: Cursor,
	line: Omit<XmlLine, "nodeId">,
): void {
	cursor.lines.push({ ...line, nodeId: requireId(line.node) });
}

function requireId(node: PromptBlockNode): string {
	// The editor model runs ensurePromptNodeIds before building the tree, so
	// every block has an id by the time this surface renders.
	return node.id ?? "";
}

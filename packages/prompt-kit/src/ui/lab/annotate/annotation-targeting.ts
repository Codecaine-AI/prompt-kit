// Slice: DOM ↔ line-model bridging for annotate-mode targeting — row lookup
// by node id and DOM-Range → prompt-range offset mapping. Pure functions over
// the stamped rows (`data-prompt-node-id` / `data-prompt-row-text`); no React.

import type { PromptRangeTarget } from "../../../annotations/schema";
import type { PromptDocument } from "../../../document/nodes/types";
import { visitPrompt } from "../../../document/transforms/visit";
import {
	lineRendersDecodedEntities,
	nodeRenderedLines,
	XML_DISPLAY_ENTITIES,
	type XmlLine,
} from "../../../document/render/line-model";

/**
 * Child id → parent id for every annotatable node in the prompt: blocks and
 * list items (an item's parent is its LIST; blocks nested in an item parent
 * to the item — the same parenting the line model stamps on rows). Top-level
 * blocks get no entry: the document itself is not an annotation scope.
 *
 * Built from the prompt tree rather than the line model because `XmlLine`
 * only records ONE level (and list lines drop the list's own parent), while
 * the scope breadcrumb needs the full chain. Build once per prompt and feed
 * `annotationScopeChain`.
 */
export function buildAnnotationParentMap(
	prompt: PromptDocument,
): Map<string, string> {
	const parents = new Map<string, string>();
	visitPrompt(prompt, ({ node, parent }) => {
		if (!parent || !("type" in node) || !("type" in parent)) return;
		// Inline nodes (variables, references) are not annotation targets.
		if (node.type === "variable" || node.type === "reference") return;
		if (!node.id || !parent.id) return;
		// First write wins — duplicated ids are invalid but must not corrupt
		// an already-recorded chain.
		if (!parents.has(node.id)) parents.set(node.id, parent.id);
	});
	return parents;
}

/**
 * Leaf-first ancestor chain for `leafId`: `[leafId, parent, grandparent, …]`
 * up to the top-level block (the document is never included — top-level ids
 * have no entry in the parent map). Cycle-guarded so a corrupt map can never
 * hang the UI; unknown ids yield a single-entry chain.
 */
export function annotationScopeChain(
	parents: ReadonlyMap<string, string>,
	leafId: string,
): string[] {
	const chain = [leafId];
	const seen = new Set(chain);
	let current = leafId;
	for (;;) {
		const parent = parents.get(current);
		if (!parent || seen.has(parent)) break;
		chain.push(parent);
		seen.add(parent);
		current = parent;
	}
	return chain;
}

/**
 * Every stamped row owned by `nodeId` inside `scope`, in document order.
 * Filtered in JS rather than interpolated into a selector because prompt node
 * ids are user-editable and may contain selector metacharacters.
 */
export function nodeRowElements(
	scope: ParentNode,
	nodeId: string,
): HTMLElement[] {
	return Array.from(
		scope.querySelectorAll<HTMLElement>("[data-prompt-node-id]"),
	).filter((element) => element.getAttribute("data-prompt-node-id") === nodeId);
}

/**
 * Every stamped row in `nodeId`'s visual extent: the rows the node renders
 * itself (`data-prompt-node-id`) plus the rows of its direct children
 * (`data-prompt-parent-node-id`). Rings/anchors built from this set span a
 * whole list (item rows carry item ids, so the list has no own rows), an
 * item's nested blocks, or a section's body. Document order.
 */
export function annotationRowElements(
	scope: ParentNode,
	nodeId: string,
): HTMLElement[] {
	return Array.from(
		scope.querySelectorAll<HTMLElement>("[data-prompt-node-id]"),
	).filter(
		(element) =>
			element.getAttribute("data-prompt-node-id") === nodeId ||
			element.getAttribute("data-prompt-parent-node-id") === nodeId,
	);
}

/**
 * The rows a prompt-range target actually SPANS — the visual extent of the
 * drag itself. A cross-node drag stores its offsets against the nearest
 * common ancestor's rendered text, but its ring/anchors must cover only the
 * rows the offsets intersect, not the ancestor's whole extent (dragging two
 * bullets and a paragraph must never ring the entire section). Falls back to
 * the ancestor's full extent when the DOM and model can't be aligned.
 */
export function promptRangeRowElements(
	container: HTMLElement,
	lines: readonly XmlLine[],
	target: PromptRangeTarget,
): HTMLElement[] {
	const aligned = alignedNodeRows(
		container,
		lines,
		target.nodeId,
		null,
		target.docId,
	);
	if (!aligned) return annotationRowElements(container, target.nodeId);
	const rows: HTMLElement[] = [];
	let cursor = 0;
	for (let index = 0; index < aligned.nodeLines.length; index += 1) {
		const rowStart = cursor;
		const rowEnd = cursor + aligned.nodeLines[index]!.text.length;
		cursor = rowEnd + 1;
		if (rowStart < target.end && rowEnd > target.start) {
			rows.push(aligned.rowElements[index]!);
		}
	}
	return rows.length > 0 ? rows : aligned.rowElements;
}

/**
 * Each row's DISPLAY region: the `[data-prompt-row-text]` descendant, falling
 * back to the row itself when a row has none. Rings and popover anchors
 * measure these instead of the full-width row divs, so the targeting ring
 * hugs the object's content (and the label chip sits at the content's left
 * edge) rather than spanning the gutter and the row's full width. DISPLAY
 * only — range-offset math (`mapDomRangeToPromptRange` and friends) keeps
 * operating on the rows themselves.
 */
export function rowDisplayRegions(rows: HTMLElement[]): HTMLElement[] {
	return rows.map(
		(row) => row.querySelector<HTMLElement>("[data-prompt-row-text]") ?? row,
	);
}

/** The stamped row an event/boundary node sits in, or null. */
export function closestPromptRow(node: Node | null): HTMLElement | null {
	const element =
		node instanceof HTMLElement ? node : (node?.parentElement ?? null);
	return element?.closest<HTMLElement>("[data-prompt-node-id]") ?? null;
}

/**
 * Maps a released DOM selection to a prompt-range target.
 *
 * Anchor: the stamped row containing `range.startContainer` names the start
 * node — for an item row that is the ITEM's own id, so a drag on a bullet
 * yields an item-scoped range. When the drag ENDS in a row owned by a
 * DIFFERENT node and `parents` is supplied, the target widens to the nearest
 * common ancestor of the two rows (bullets 2–4 → their LIST; bullets across
 * two lists → the SECTION), so a multi-node swath maps honestly instead of
 * collapsing to the first bullet. Without `parents` — or when the chains
 * never meet (different top-level blocks) — the drag clamps to the start
 * node's text, the old single-node behavior. Offsets index the target node's
 * rendered text — its extent's `XmlLine.text` values joined with "\n" (see
 * `nodeRenderedText`) — and `quote` is the exact slice of that string, NOT
 * the raw DOM selection string, so quote and offsets always agree. Returns
 * null when the drag cannot be mapped (started outside any row, DOM rows out
 * of sync with the line model, empty/whitespace slice).
 */
export function mapDomRangeToPromptRange(options: {
	container: HTMLElement;
	range: Range;
	lines: readonly XmlLine[];
	docId: string;
	/**
	 * Child → parent links from `buildAnnotationParentMap`, enabling the
	 * common-ancestor widening above. Optional for callers that only ever map
	 * single-node drags.
	 */
	parents?: ReadonlyMap<string, string>;
}): PromptRangeTarget | null {
	const { container, range, lines, docId, parents } = options;

	const anchorRow = closestPromptRow(range.startContainer);
	if (!anchorRow || !container.contains(anchorRow)) return null;
	const startId = anchorRow.getAttribute("data-prompt-node-id");
	if (!startId) return null;

	const endRow = closestPromptRow(range.endContainer);
	const endId =
		endRow && container.contains(endRow)
			? endRow.getAttribute("data-prompt-node-id")
			: null;

	let nodeId = startId;
	if (parents && endId && endId !== startId) {
		// No shared block (endpoints under different top-level blocks or
		// sections) anchors to the DOCUMENT itself — "whatever the drag
		// bounded" must always be selectable, and only the document's rendered
		// text spans an arbitrary cross-section swath. Offsets then index the
		// full rendered prompt text.
		nodeId = nearestCommonAncestor(parents, startId, endId) ?? docId;
	}

	const aligned = alignedNodeRows(container, lines, nodeId, anchorRow, docId);
	if (!aligned) return null;
	const { rowElements, nodeLines } = aligned;

	const nodeText = nodeLines.map((line) => line.text).join("\n");
	// Start offset of each row's text within `nodeText` (+1 per "\n" joint).
	const rowStarts: number[] = [];
	let cursor = 0;
	for (const line of nodeLines) {
		rowStarts.push(cursor);
		cursor += line.text.length + 1;
	}

	const start = boundaryModelOffset(
		range.startContainer,
		range.startOffset,
		rowElements,
		nodeLines,
		rowStarts,
		"start",
		nodeText.length,
	);
	const end = boundaryModelOffset(
		range.endContainer,
		range.endOffset,
		rowElements,
		nodeLines,
		rowStarts,
		"end",
		nodeText.length,
	);
	if (start === null || end === null) return null;

	const clampedEnd = Math.min(end, nodeText.length);
	if (start >= clampedEnd) return null;
	const quote = nodeText.slice(start, clampedEnd);
	if (quote.trim().length === 0) return null;

	return { kind: "prompt-range", docId, nodeId, start, end: clampedEnd, quote };
}

/**
 * First id on `a`'s leaf-first scope chain that also lies on `b`'s — the
 * nearest block containing both rows. Null when the chains never meet (the
 * rows live under different top-level blocks; the document is not a scope).
 */
function nearestCommonAncestor(
	parents: ReadonlyMap<string, string>,
	a: string,
	b: string,
): string | null {
	const bChain = new Set(annotationScopeChain(parents, b));
	for (const id of annotationScopeChain(parents, a)) {
		if (bChain.has(id)) return id;
	}
	return null;
}

/**
 * The node's rendered lines paired 1:1 with its stamped DOM rows, located by
 * STAMP-RUN matching: the extent's expected stamp sequence
 * (`line.itemId ?? line.nodeId` per line) is searched for as a contiguous run
 * among the container's stamped rows, preferring the run that contains the
 * drag's anchor row. This deliberately does NOT require the whole container
 * to mirror the line model — stray stamped elements elsewhere (outline
 * entries, auxiliary UI, mid-edit churn outside the extent) must not kill
 * range mapping for an extent that IS rendered faithfully. Null only when no
 * matching run exists.
 */
function alignedNodeRows(
	container: HTMLElement,
	lines: readonly XmlLine[],
	nodeId: string,
	anchorRow: HTMLElement | null,
	docId?: string,
): { rowElements: HTMLElement[]; nodeLines: XmlLine[] } | null {
	// The document id anchors a cross-section range: its extent is every
	// rendered (non-gap) line of the prompt.
	const nodeLines =
		docId !== undefined && nodeId === docId
			? lines.filter((line) => line.role !== "gap")
			: nodeRenderedLines(lines, nodeId);
	if (nodeLines.length === 0) return null;
	const expected = nodeLines.map((line) => line.itemId ?? line.nodeId);
	const rows = Array.from(
		container.querySelectorAll<HTMLElement>("[data-prompt-node-id]"),
	);
	const stamps = rows.map((row) => row.getAttribute("data-prompt-node-id"));
	let fallback: HTMLElement[] | null = null;
	for (let start = 0; start + expected.length <= rows.length; start += 1) {
		let matches = true;
		for (let offset = 0; offset < expected.length; offset += 1) {
			if (stamps[start + offset] !== expected[offset]) {
				matches = false;
				break;
			}
		}
		if (!matches) continue;
		const slice = rows.slice(start, start + expected.length);
		if (!anchorRow || slice.includes(anchorRow)) {
			return { rowElements: slice, nodeLines };
		}
		fallback ??= slice;
	}
	return fallback ? { rowElements: fallback, nodeLines } : null;
}

/**
 * One Range boundary → an offset in the node's rendered text. A boundary in a
 * row the anchor node does not own (multi-node drag past the target's extent)
 * clamps: end boundaries to the end of the node text, start boundaries fail
 * (the anchor row IS the start row, so this only happens when the DOM shifted
 * underneath us).
 */
function boundaryModelOffset(
	boundaryNode: Node,
	boundaryOffset: number,
	rowElements: HTMLElement[],
	nodeLines: readonly XmlLine[],
	rowStarts: readonly number[],
	kind: "start" | "end",
	nodeTextLength: number,
): number | null {
	const row = closestPromptRow(boundaryNode);
	const rowIndex = row ? rowElements.indexOf(row) : -1;
	if (rowIndex === -1) {
		return kind === "end" ? nodeTextLength : null;
	}
	const line = nodeLines[rowIndex]!;
	const rowStart = rowStarts[rowIndex]!;

	const region =
		row!.querySelector<HTMLElement>("[data-prompt-row-text]") ?? row!;
	if (!region.contains(boundaryNode)) {
		// Boundary sits in row chrome (gutter, affordances): snap to the row's
		// text edge nearest the selection's interior.
		return kind === "start" ? rowStart : rowStart + line.text.length;
	}

	const domOffset = domPrefixLength(region, boundaryNode, boundaryOffset);
	if (domOffset === null) {
		return kind === "start" ? rowStart : rowStart + line.text.length;
	}
	const domText = region.textContent ?? "";
	const modelOffset = modelOffsetFromDom(
		line.text,
		domText,
		domOffset,
		// Start boundaries snap FORWARD onto the first selected character so
		// display-only trim the DOM drops (indent, the space after a list
		// marker) never leaks into the front of the quote.
		kind === "start",
		// Prose rows display entities DECODED (`&lt;` shows as `<`), so the
		// walk must consume whole entities; verbatim rows (code / raw / tags)
		// really contain the `&lt;` characters and must walk them literally.
		lineRendersDecodedEntities(line),
	);
	return rowStart + modelOffset;
}

/**
 * Characters of text inside `region` that precede the boundary
 * `(container, offset)`. Text-node boundaries count their own offset;
 * element boundaries resolve to "before child #offset". Returns null when
 * the boundary cannot be located.
 */
function domPrefixLength(
	region: HTMLElement,
	container: Node,
	offset: number,
): number | null {
	const doc = region.ownerDocument;
	if (!doc) return null;

	const isTextBoundary = container.nodeType === Node.TEXT_NODE;
	// For an element boundary the position is immediately before this child;
	// null means "after the element's last child".
	const beforeNode = isTextBoundary
		? null
		: (container.childNodes[offset] ?? null);

	let total = 0;
	const walker = doc.createTreeWalker(region, NodeFilter.SHOW_TEXT);
	let current: Node | null = walker.nextNode();
	while (current) {
		const text = current as Text;
		if (isTextBoundary) {
			if (text === container) {
				return total + Math.min(offset, text.data.length);
			}
			total += text.data.length;
		} else if (beforeNode) {
			const position = text.compareDocumentPosition(beforeNode);
			// beforeNode after this text node → the text node precedes the
			// boundary and counts; anything else (contains / precedes) means the
			// boundary has been reached.
			if ((position & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return total;
			total += text.data.length;
		} else {
			// "After last child" of `container`: count text inside or before it.
			if (container.contains(text)) {
				total += text.data.length;
			} else {
				const position = text.compareDocumentPosition(container);
				if ((position & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return total;
				total += text.data.length;
			}
		}
		current = walker.nextNode();
	}
	// A text boundary we never met is outside the region after all.
	return isTextBoundary ? null : total;
}

/**
 * Aligns a DOM text offset onto the row's MODEL text. The row's DOM text is
 * the model text minus display-only trim (leading indent rendered as
 * padding, the space after a list marker), i.e. a subsequence — so a greedy
 * character walk recovers the model offset. Offsets past the end clamp.
 *
 * `entityAware` rows (see `lineRendersDecodedEntities`) additionally display
 * the model's XML entities as their decoded characters: where the model holds
 * `&lt;` the DOM shows `<`. There a decoded DOM character consumes the WHOLE
 * entity — matching the leading `&` literally would strand the offset inside
 * the entity, and skipping char-by-char would let a later literal match
 * misalign the walk. Entity-aware boundaries therefore always land on entity
 * seams, and the stored quote (a MODEL slice) never cuts an entity in half.
 */
function modelOffsetFromDom(
	modelText: string,
	domText: string,
	domOffset: number,
	snapToNextChar: boolean,
	entityAware = false,
): number {
	// Model-side step at `model` toward the DOM character `char`: reports a
	// match (and how many model characters it spans) or the skip width.
	const matchAt = (
		model: number,
		char: string,
	): { matched: boolean; length: number } => {
		if (entityAware) {
			const entity = entityAtModel(modelText, model);
			if (entity) {
				// The entity displays as ONE decoded char; its own characters are
				// not individually visible, so a non-matching entity skips whole.
				return { matched: entity.decoded === char, length: entity.length };
			}
		}
		return { matched: modelText[model] === char, length: 1 };
	};

	let model = 0;
	const limit = Math.min(domOffset, domText.length);
	for (let dom = 0; dom < limit; dom += 1) {
		const char = domText[dom]!;
		while (model < modelText.length) {
			const step = matchAt(model, char);
			model += step.length;
			if (step.matched) break;
		}
		if (model >= modelText.length && dom < limit - 1) return modelText.length;
	}
	if (snapToNextChar && domOffset < domText.length) {
		const next = domText[domOffset]!;
		while (model < modelText.length) {
			const step = matchAt(model, next);
			if (step.matched) break;
			model += step.length;
		}
	}
	return Math.min(model, modelText.length);
}

/** The display entity starting at `index` of the model text, if any. */
function entityAtModel(
	text: string,
	index: number,
): { length: number; decoded: string } | null {
	if (text[index] !== "&") return null;
	// Longest display entity is 6 chars (&quot;) — bound the scan.
	const semi = text.indexOf(";", index);
	if (semi === -1 || semi - index > 5) return null;
	const candidate = text.slice(index, semi + 1);
	const decoded = XML_DISPLAY_ENTITIES[candidate];
	return decoded === undefined ? null : { length: candidate.length, decoded };
}

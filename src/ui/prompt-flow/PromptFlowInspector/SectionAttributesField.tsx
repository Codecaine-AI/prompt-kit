// Slice: the section attribute editor — the panel surface for everything that
// renders inside a section's open tag after its name.
"use client";

import cn from "classnames";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PromptDocument, SectionNode } from "../../../index";
import type { PromptEditorTreeEntry } from "../../editors";

import { updateNode } from "../PromptFlowShared";
import type { PromptFlowChangeHandler } from "../types";
import {
	attrRowsFromAttrs,
	attrsSignature,
	buildAttrs,
	sanitizeAttributeKey,
	type AttrRow,
	type PromptAttrs,
} from "./attrs";

/** A row keyed independently of its position, so removing one keeps focus sane. */
type UiRow = AttrRow & { id: number };

/**
 * Attributes are the answer to "how do I add fields to a section": each row
 * becomes `name="value"` inside the open tag, so `<steps>` becomes
 * `<steps priority="high">` as the row is typed.
 *
 * The rows are the working copy and the record is rebuilt from them on every
 * keystroke — a record cannot hold a row that has a value but no name yet, and
 * rebuilding keeps the order stable while a name is being retyped. Each rebuild
 * commits through the shared step helper, so attribute edits undo like any
 * other block edit.
 */
export function SectionAttributesField({
	entry,
	node,
	prompt,
	onPromptChange,
}: {
	entry: PromptEditorTreeEntry;
	node: SectionNode;
	prompt: PromptDocument;
	onPromptChange: PromptFlowChangeHandler;
}) {
	const nextId = useRef(0);
	const seed = () =>
		attrRowsFromAttrs(node.attrs).map((row) => ({ ...row, id: nextId.current++ }));

	const [rows, setRows] = useState<UiRow[]>(seed);
	// The record this working copy was seeded from: unchanged values keep their
	// stored type, so a number in the document survives an edit to its neighbour.
	const originals = useRef<PromptAttrs | undefined>(node.attrs);
	// Signature of the record we last wrote. A record that differs from it came
	// from somewhere else — an undo, a buffer edit — and reseeds the rows.
	const committed = useRef(attrsSignature(node.attrs));

	useEffect(() => {
		const signature = attrsSignature(node.attrs);
		if (signature === committed.current) return;
		committed.current = signature;
		originals.current = node.attrs;
		// `seed` closes over the same node.attrs this effect reads.
		setRows(seed());
	}, [node.attrs]);

	function commit(next: UiRow[]) {
		setRows(next);
		const { attrs } = buildAttrs(next, originals.current);
		committed.current = attrsSignature(attrs);
		updateNode(prompt, entry, onPromptChange, (current) =>
			current.type === "section" ? withAttrs(current, attrs) : current,
		);
	}

	const { duplicateRows } = buildAttrs(rows, originals.current);
	const duplicates = new Set(duplicateRows);

	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
				attributes
			</span>

			{rows.length > 0 && (
				<div className="flex flex-col gap-1">
					{rows.map((row, index) => (
						<div key={row.id} className="flex items-center gap-1">
							<RowInput
								value={row.key}
								placeholder="name"
								invalid={duplicates.has(index)}
								className="w-[38%] shrink-0"
								onChange={(key) =>
									commit(replaceRow(rows, index, { key: sanitizeAttributeKey(key) }))
								}
							/>
							<RowInput
								value={row.value}
								placeholder="value"
								className="min-w-0 flex-1"
								onChange={(value) => commit(replaceRow(rows, index, { value }))}
							/>
							<button
								type="button"
								aria-label="Remove attribute"
								onClick={() =>
									commit(rows.filter((_, position) => position !== index))
								}
								className="flex h-7 w-6 shrink-0 items-center justify-center text-muted-foreground/60 outline-none hover:text-foreground focus-visible:text-foreground"
							>
								<X className="h-3 w-3" />
							</button>
						</div>
					))}
				</div>
			)}

			{duplicates.size > 0 && (
				<p className="text-[11px] leading-relaxed text-status-warning">
					Repeated name — not saved.
				</p>
			)}

			<button
				type="button"
				onClick={() =>
					commit([...rows, { id: nextId.current++, key: "", value: "" }])
				}
				className="flex items-center gap-1 self-start text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
			>
				<Plus className="h-3 w-3" />
				Add attribute
			</button>
		</div>
	);
}

function RowInput({
	value,
	placeholder,
	className,
	invalid,
	onChange,
}: {
	value: string;
	placeholder: string;
	className?: string;
	invalid?: boolean;
	onChange: (value: string) => void;
}) {
	return (
		<input
			value={value}
			placeholder={placeholder}
			spellCheck={false}
			aria-invalid={invalid || undefined}
			onChange={(event) => onChange(event.target.value)}
			className={cn(
				"h-7 rounded-[2px] border bg-background px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40",
				// The warning outranks the focus ring: a duplicate is flagged while
				// it is being typed, which is exactly when the flag is useful.
				invalid
					? "border-status-warning focus:border-status-warning"
					: "border-border focus:border-status-success",
				className,
			)}
		/>
	);
}

function replaceRow(
	rows: readonly UiRow[],
	index: number,
	patch: Partial<AttrRow>,
): UiRow[] {
	return rows.map((row, position) =>
		position === index ? { ...row, ...patch } : row,
	);
}

/** An attribute-free section carries no `attrs` key at all. */
function withAttrs(node: SectionNode, attrs?: PromptAttrs): SectionNode {
	if (!attrs) {
		const { attrs: _dropped, ...rest } = node;
		return rest satisfies SectionNode;
	}
	return { ...node, attrs } satisfies SectionNode;
}

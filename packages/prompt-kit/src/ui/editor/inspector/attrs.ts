// Slice: the editable row projection of a section's `attrs` record, plus the
// sanitation that keeps a typed key renderable as an XML attribute name.
//
// A record cannot hold a half-typed row (an attribute with no name yet), so the
// editor keeps an ordered row list as its working copy and rebuilds the record
// from it on every commit. Rebuilding — rather than patching — is what keeps
// key order stable while a key is being renamed.

export type PromptAttrValue = string | number | boolean | null | undefined;
export type PromptAttrs = Record<string, PromptAttrValue>;

export interface AttrRow {
	key: string;
	value: string;
}

/** Text the editor shows for a stored value; null/undefined render nothing. */
export function attrValueText(value: PromptAttrValue): string {
	return value === null || value === undefined ? "" : String(value);
}

export function attrRowsFromAttrs(attrs?: PromptAttrs): AttrRow[] {
	return Object.entries(attrs ?? {}).map(([key, value]) => ({
		key,
		value: attrValueText(value),
	}));
}

/**
 * Keeps a typed key a legal XML attribute name: whitespace becomes `_` (typing
 * two words is the common case), characters outside the name set are dropped,
 * and a leading character that cannot start a name (a digit, `-`) is trimmed.
 * Applied on every keystroke, so it must be idempotent.
 */
export function sanitizeAttributeKey(value: string): string {
	return value
		.replace(/\s+/g, "_")
		.replace(/[^A-Za-z0-9_:-]+/g, "")
		.replace(/^[^A-Za-z_:]+/, "");
}

export interface BuiltAttrs {
	/** The record to store, or undefined when no row carries a key. */
	attrs?: PromptAttrs;
	/** Rows whose key repeats an earlier row's; flagged, never committed. */
	duplicateRows: number[];
}

/**
 * Rebuilds the record from rows. Keyless rows are dropped (they are rows the
 * user is still filling in), and a repeated key is reported rather than written
 * — the first row wins, so a duplicate can never silently clobber a value.
 *
 * `originals` is the record the rows were seeded from: a value that still reads
 * exactly as it was stored keeps its stored type, so a number or boolean
 * already in the document does not turn into a string when a neighbouring row
 * is edited.
 */
export function buildAttrs(
	rows: readonly AttrRow[],
	originals?: PromptAttrs,
): BuiltAttrs {
	const attrs: PromptAttrs = {};
	const duplicateRows: number[] = [];

	rows.forEach((row, index) => {
		const key = row.key.trim();
		if (!key) return;
		if (Object.hasOwn(attrs, key)) {
			duplicateRows.push(index);
			return;
		}
		attrs[key] = attrValueForKey(key, row.value, originals);
	});

	return {
		attrs: Object.keys(attrs).length === 0 ? undefined : attrs,
		duplicateRows,
	};
}

function attrValueForKey(
	key: string,
	text: string,
	originals?: PromptAttrs,
): PromptAttrValue {
	if (originals && Object.hasOwn(originals, key)) {
		const original = originals[key];
		if (typeof original !== "string" && attrValueText(original) === text) {
			return original;
		}
	}
	return text;
}

/** Stable identity for a record: reseeding is skipped while it is unchanged. */
export function attrsSignature(attrs?: PromptAttrs): string {
	return JSON.stringify(
		Object.entries(attrs ?? {}).map(([key, value]) => [
			key,
			value === undefined ? ["undefined"] : value,
		]),
	);
}

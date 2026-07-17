// The non-mutating text-edit vocabulary shared by the formatter and modifier:
// `JsoncEdit`, `JsoncRange` and `JsoncFormattingOptions`.
//
// Edits describe replacements as `offset`/`length`/`content`; applying them in
// reverse-offset order is byte-minimal and preserves comments and whitespace —
// the core value proposition over `JSON.parse`/`JSON.stringify` round-trips.
//
// `JsoncEdit`, `JsoncRange`, `JsoncPath`, `JsoncSegment` and
// `JsoncFormattingOptions` are bound by the jsonc/yaml parity convention:
// their future `Yaml*` counterparts must be structurally identical (same
// field names, types, optionality and semantics) so consumer code can be
// written once over "a document codec's Edit/Range/Path".

import { Schema } from "effect";

/**
 * A range within a JSONC document, expressed as a zero-based character
 * `offset` and a `length` in UTF-16 code units. Pass to `JsoncFormatter.format`
 * to restrict formatting to a region.
 *
 * @public
 */
export class JsoncRange extends Schema.Class<JsoncRange>("JsoncRange")({
	offset: Schema.Number,
	length: Schema.Number,
}) {}

/**
 * Options controlling JSONC formatting. All fields are omissible.
 *
 * - `tabSize` — the indent width in columns when `insertSpaces` is `true`.
 *   Defaults to `2`.
 * - `insertSpaces` — indent with spaces (`tabSize` of them) when `true`, or a
 *   single tab character when `false`. Defaults to `true`.
 * - `eol` — the line-ending string inserted between formatted tokens.
 *   Defaults to `"\n"`.
 * - `insertFinalNewline` — append `eol` at the end of the document if it
 *   doesn't already end with one. Defaults to `false`.
 * - `keepLines` — preserve existing line breaks (including blank lines)
 *   between tokens instead of collapsing each gap to the canonical single
 *   `eol`. Defaults to `false`.
 *
 * @public
 */
export class JsoncFormattingOptions extends Schema.Class<JsoncFormattingOptions>("JsoncFormattingOptions")({
	tabSize: Schema.optionalKey(Schema.Number),
	insertSpaces: Schema.optionalKey(Schema.Boolean),
	eol: Schema.optionalKey(Schema.String),
	insertFinalNewline: Schema.optionalKey(Schema.Boolean),
	keepLines: Schema.optionalKey(Schema.Boolean),
}) {}

/**
 * Formatting options accepted at call sites: either a
 * {@link JsoncFormattingOptions} instance or a plain literal with the same
 * fields (the two are structurally interchangeable — only the option fields
 * are read). Mirrors the `YamlRangeLike` posture in `@effected/yaml`, so a
 * caller can pass `{ insertSpaces: false, tabSize: 2 }` without constructing
 * the class. `JsoncFormattingOptions` remains the canonical decoded form.
 *
 * @public
 */
export type JsoncFormattingOptionsLike =
	| JsoncFormattingOptions
	| {
			readonly tabSize?: number;
			readonly insertSpaces?: boolean;
			readonly eol?: string;
			readonly insertFinalNewline?: boolean;
			readonly keepLines?: boolean;
	  };

/**
 * A non-mutating text edit: replace the span `[offset, offset + length)` with
 * `content`. Set `length` to `0` to insert, `content` to `""` to delete.
 *
 * @public
 */
export class JsoncEdit extends Schema.Class<JsoncEdit>("JsoncEdit")({
	offset: Schema.Number,
	length: Schema.Number,
	content: Schema.String,
}) {
	/**
	 * Apply `edits` to `text`, producing a new string. Edits are applied in
	 * reverse-offset order so earlier offsets stay valid; the input `edits`
	 * array is not mutated. Pure and total.
	 *
	 * @param text - The source text to edit.
	 * @param edits - The edits to apply, in any order.
	 * @returns The edited text.
	 */
	static applyAll(text: string, edits: ReadonlyArray<JsoncEdit>): string {
		const sorted = [...edits].sort((a, b) => b.offset - a.offset);
		let result = text;
		for (const edit of sorted) {
			result = result.substring(0, edit.offset) + edit.content + result.substring(edit.offset + edit.length);
		}
		return result;
	}
}

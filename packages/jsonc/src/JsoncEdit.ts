/**
 * The non-mutating text-edit vocabulary shared by the formatter and modifier:
 * {@link JsoncEdit}, {@link JsoncRange} and {@link JsoncFormattingOptions}.
 *
 * Edits describe replacements as `offset`/`length`/`content`; applying them in
 * reverse-offset order is byte-minimal and preserves comments and whitespace —
 * the core value proposition over `JSON.parse`/`JSON.stringify` round-trips.
 *
 * @remarks
 * `JsoncEdit`, `JsoncRange`, `JsoncPath`, `JsoncSegment` and
 * `JsoncFormattingOptions` are bound by the jsonc/yaml parity convention: their
 * future `Yaml*` counterparts must be structurally identical (same field names,
 * types, optionality and semantics) so consumer code can be written once over
 * "a document codec's Edit/Range/Path".
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

/**
 * Schema-generated base class backing {@link JsoncRange}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const JsoncRange_base: Schema.Class<
	JsoncRange,
	Schema.Struct<{
		readonly offset: typeof Schema.Number;
		readonly length: typeof Schema.Number;
	}>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.Class's own `Inherited = {}` default
	{}
> = Schema.Class<JsoncRange>("JsoncRange")({
	offset: Schema.Number,
	length: Schema.Number,
});

/**
 * A range within a JSONC document, expressed as a zero-based character
 * `offset` and a `length` in UTF-16 code units. Pass to `JsoncFormatter.format`
 * to restrict formatting to a region.
 *
 * @public
 */
export class JsoncRange extends JsoncRange_base {}

/**
 * Schema-generated base class backing {@link JsoncFormattingOptions}. Not meant
 * to be referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const JsoncFormattingOptions_base: Schema.Class<
	JsoncFormattingOptions,
	Schema.Struct<{
		readonly tabSize: Schema.optionalKey<typeof Schema.Number>;
		readonly insertSpaces: Schema.optionalKey<typeof Schema.Boolean>;
		readonly eol: Schema.optionalKey<typeof Schema.String>;
		readonly insertFinalNewline: Schema.optionalKey<typeof Schema.Boolean>;
		readonly keepLines: Schema.optionalKey<typeof Schema.Boolean>;
	}>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.Class's own `Inherited = {}` default
	{}
> = Schema.Class<JsoncFormattingOptions>("JsoncFormattingOptions")({
	tabSize: Schema.optionalKey(Schema.Number),
	insertSpaces: Schema.optionalKey(Schema.Boolean),
	eol: Schema.optionalKey(Schema.String),
	insertFinalNewline: Schema.optionalKey(Schema.Boolean),
	keepLines: Schema.optionalKey(Schema.Boolean),
});

/**
 * Options controlling JSONC formatting.
 *
 * All fields are omissible; the formatter resolves absent fields to defaults:
 * `tabSize` 2, `insertSpaces` `true`, `eol` `"\n"`, `insertFinalNewline`
 * `false`, `keepLines` `false`.
 *
 * @public
 */
export class JsoncFormattingOptions extends JsoncFormattingOptions_base {}

/**
 * Schema-generated base class backing {@link JsoncEdit}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const JsoncEdit_base: Schema.Class<
	JsoncEdit,
	Schema.Struct<{
		readonly offset: typeof Schema.Number;
		readonly length: typeof Schema.Number;
		readonly content: typeof Schema.String;
	}>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.Class's own `Inherited = {}` default
	{}
> = Schema.Class<JsoncEdit>("JsoncEdit")({
	offset: Schema.Number,
	length: Schema.Number,
	content: Schema.String,
});

/**
 * A non-mutating text edit: replace the span `[offset, offset + length)` with
 * `content`. Set `length` to `0` to insert, `content` to `""` to delete.
 *
 * @public
 */
export class JsoncEdit extends JsoncEdit_base {
	/**
	 * Apply `edits` to `text`, producing a new string. Edits are applied in
	 * reverse-offset order so earlier offsets stay valid; the input `edits`
	 * array is not mutated. Pure and total.
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

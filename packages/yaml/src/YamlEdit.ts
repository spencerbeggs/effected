/**
 * The non-mutating text-edit vocabulary shared by the formatter and modifier:
 * {@link YamlEdit}, {@link YamlRange}, {@link (YamlPath:type)} and
 * {@link (YamlSegment:type)}.
 *
 * Edits describe replacements as `offset`/`length`/`content`; applying them in
 * reverse-offset order is byte-minimal and preserves comments and whitespace —
 * the library's real differentiator over `yaml` round-trips.
 *
 * @remarks
 * `YamlEdit`, `YamlRange`, `YamlPath`, `YamlSegment` and
 * `YamlFormattingOptions` are bound by the jsonc/yaml parity convention: they
 * are structurally identical to their `Jsonc*` counterparts (same field names,
 * types, optionality and semantics) so consumer code can be written once over
 * "a document codec's Edit/Range/Path".
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

/**
 * A single path segment: a `string` for mapping keys or a `number` for
 * sequence indices.
 *
 * @public
 */
export type YamlSegment = string | number;

/**
 * An ordered sequence of {@link (YamlSegment:type)} values describing a
 * location within a YAML document tree.
 *
 * @public
 */
export type YamlPath = ReadonlyArray<YamlSegment>;

/**
 * Schema-generated base class backing {@link YamlRange}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const YamlRange_base: Schema.Class<
	YamlRange,
	Schema.Struct<{
		readonly offset: typeof Schema.Number;
		readonly length: typeof Schema.Number;
	}>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.Class's own `Inherited = {}` default
	{}
> = Schema.Class<YamlRange>("YamlRange")({
	offset: Schema.Number,
	length: Schema.Number,
});

/**
 * A range within a YAML document, expressed as a zero-based character
 * `offset` and a `length` in UTF-16 code units. Pass to `YamlFormat.format`
 * to restrict formatting to a region.
 *
 * @public
 */
export class YamlRange extends YamlRange_base {}

/**
 * Schema-generated base class backing {@link YamlEdit}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const YamlEdit_base: Schema.Class<
	YamlEdit,
	Schema.Struct<{
		readonly offset: typeof Schema.Number;
		readonly length: typeof Schema.Number;
		readonly content: typeof Schema.String;
	}>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.Class's own `Inherited = {}` default
	{}
> = Schema.Class<YamlEdit>("YamlEdit")({
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
export class YamlEdit extends YamlEdit_base {
	/**
	 * Apply `edits` to `text`, producing a new string. Edits are applied in
	 * reverse-offset order so earlier offsets stay valid; the input `edits`
	 * array is not mutated. Pure and total.
	 */
	static applyAll(text: string, edits: ReadonlyArray<YamlEdit>): string {
		const sorted = [...edits].sort((a, b) => b.offset - a.offset);
		let result = text;
		for (const edit of sorted) {
			result = result.substring(0, edit.offset) + edit.content + result.substring(edit.offset + edit.length);
		}
		return result;
	}
}

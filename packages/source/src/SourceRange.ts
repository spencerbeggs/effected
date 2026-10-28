/**
 * A span of a source text as a start offset and a length, both in UTF-16 code
 * units: the characters `[offset, offset + length)`.
 *
 * @remarks
 * The shape every kit format package uses for a range (`JsoncRange`,
 * `YamlRange`, `TomlRange`, `MarkdownRange`) and for the positional part of an
 * edit, so any of them satisfies this interface as it stands. A `length` of
 * `0` is an empty span, an insertion point.
 *
 * Offsets are string indices, not bytes and not code points. Convert to a
 * line and character with {@link LineIndex.spanOf}.
 *
 * @public
 */
export interface SourceRange {
	/** The zero-based UTF-16 offset of the first character. */
	readonly offset: number;
	/** The number of UTF-16 code units in the span. */
	readonly length: number;
}

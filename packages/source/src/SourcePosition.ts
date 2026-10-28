/**
 * A zero-based line and character in a source text, the shape of an LSP
 * `Position`.
 *
 * @remarks
 * Both fields count from `0`. `character` counts UTF-16 code units from the
 * start of the line, which is LSP's default position encoding and what a
 * JavaScript string index already is, so an astral character such as an emoji
 * occupies two. A line is ended by `\n`, `\r\n` or a bare `\r` unless the
 * {@link LineIndex} that produced the position was built with another
 * {@link (LineBreaks:type)} rule.
 *
 * This is a structural interface, not a class: any `{ line, character }`
 * record satisfies it, so the kit's format packages can return their own
 * classes and still be read through it, and two installed copies of this
 * package never disagree about what a position is.
 *
 * A human reader counts from 1. Add 1 to both fields when printing a
 * position for a person, and keep the structured value zero-based.
 *
 * @public
 */
export interface SourcePosition {
	/** The zero-based line number. */
	readonly line: number;
	/** The zero-based offset within the line, in UTF-16 code units. */
	readonly character: number;
}

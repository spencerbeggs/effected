import type { SourcePosition } from "./SourcePosition.js";

/**
 * A span of a source text as two {@link SourcePosition}s, the shape of an LSP
 * `Range`. `end` is exclusive.
 *
 * @remarks
 * The line-and-character twin of {@link SourceRange}. An LSP server reports
 * and receives this shape; a parser reports offsets. {@link LineIndex.spanOf}
 * and {@link LineIndex.rangeOf} convert between them.
 *
 * @public
 */
export interface SourceSpan {
	/** The position of the first character. */
	readonly start: SourcePosition;
	/** The position just past the last character. */
	readonly end: SourcePosition;
}

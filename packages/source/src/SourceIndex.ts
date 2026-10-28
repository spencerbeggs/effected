import type { LineBreaks } from "./LineIndex.js";
import type { SourceLocation } from "./SourceDiagnostic.js";
import type { SourcePosition } from "./SourcePosition.js";
import type { SourceRange } from "./SourceRange.js";
import type { SourceSpan } from "./SourceSpan.js";

/**
 * The public surface of a line index, as a structural interface: what
 * {@link LineIndex} answers, with nothing that ties a value to one copy of
 * this package.
 *
 * @remarks
 * Type a signature that takes or returns a line index with this interface,
 * never with the `LineIndex` class. The class has `private` members, and
 * TypeScript compares a class with `private` members nominally: when two
 * copies of `@effected/source` are installed (a format package on one
 * version, its consumer on another), a `LineIndex` built by one copy is not
 * assignable to the other copy's `LineIndex` type (TS2345, "Types have
 * separate declarations of a private property"). Every member here is a
 * public method or a readonly property, so an index from any copy satisfies
 * this interface from any other.
 *
 * Construct one with {@link LineIndex.make}; this interface has no
 * constructor of its own, and nothing checks `instanceof`.
 *
 * @example
 * ```ts
 * import type { SourceIndex, SourcePosition } from "@effected/source";
 * import { LineIndex } from "@effected/source";
 *
 * const startOf = (index: SourceIndex, offset: number): SourcePosition => index.positionAt(offset);
 * console.log(startOf(LineIndex.make("a\nb"), 2));
 * // => { line: 1, character: 0 }
 * ```
 *
 * @public
 */
export interface SourceIndex {
	/** The text this index was built over. */
	readonly text: string;
	/** The rule that decided where lines end. */
	readonly lineBreaks: LineBreaks;
	/** The number of lines, at least `1`. */
	readonly lineCount: number;
	/** The zero-based line that contains `offset`; see {@link LineIndex.lineAt}. */
	lineAt(offset: number): number;
	/** The offset of the first character of `line`; see {@link LineIndex.lineStart}. */
	lineStart(line: number): number;
	/** The offset where `line`'s terminator starts; see {@link LineIndex.lineEnd}. */
	lineEnd(line: number): number;
	/** The text of `line`, without its terminator; see {@link LineIndex.lineText}. */
	lineText(line: number): string;
	/** The `{ line, character }` of `offset`; see {@link LineIndex.positionAt}. */
	positionAt(offset: number): SourcePosition;
	/** The offset of a position; see {@link LineIndex.offsetAt}. */
	offsetAt(position: SourcePosition): number;
	/** The span of an offset range; see {@link LineIndex.spanOf}. */
	spanOf(range: SourceRange): SourceSpan;
	/** The offset range of a span; see {@link LineIndex.rangeOf}. */
	rangeOf(span: SourceSpan): SourceRange;
	/** The location of a range; see {@link LineIndex.locationOf}. */
	locationOf(range: SourceRange): SourceLocation;
}

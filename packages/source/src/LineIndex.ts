import type { SourceLocation } from "./SourceDiagnostic.js";
import type { SourceIndex } from "./SourceIndex.js";
import type { SourcePosition } from "./SourcePosition.js";
import type { SourceRange } from "./SourceRange.js";
import type { SourceSpan } from "./SourceSpan.js";

/**
 * Which characters end a line, for {@link LineIndex.make}.
 *
 * @remarks
 * - `"lsp"` (the default): `\n`, `\r\n` and a bare `\r`, the Language Server
 *   Protocol's rule. `\r\n` is one terminator. Markdown, TOML, YAML (its
 *   tokens, lint lines and diagnostics alike) and an LSP client all count
 *   lines this way.
 * - `"lf"`: a line ends at `\n` only. `\r\n` is still one terminator (the
 *   `\r` is not part of the line's text), but a bare `\r` is an ordinary
 *   character. No kit package uses it now; it stays for a consumer that must
 *   reproduce a `\n`-only line count, such as a tool that splits on `\n`.
 * - `"unicode"`: the `"lsp"` rule plus U+2028 LINE SEPARATOR and U+2029
 *   PARAGRAPH SEPARATOR, each a terminator on its own. `@effected/jsonc`
 *   counts its diagnostics' lines this way, as its scanner does. An LSP
 *   client does not, so a position computed under this rule disagrees with
 *   the client's after the first separator.
 *
 * @public
 */
export type LineBreaks = "lsp" | "lf" | "unicode";

/**
 * Options for {@link LineIndex.make}.
 *
 * @public
 */
export interface LineIndexOptions {
	/**
	 * Which characters end a line. Defaults to `"lsp"`: `\n`, `\r\n` and a
	 * bare `\r`.
	 */
	readonly lineBreaks?: LineBreaks;
}

const LF = 0x0a;
const CR = 0x0d;
const LS = 0x2028;
const PS = 0x2029;

const requireInteger = (name: string, value: number): void => {
	if (!Number.isInteger(value)) {
		throw new RangeError(`LineIndex: ${name} must be an integer, received ${value}`);
	}
};

const requireLength = (length: number): void => {
	requireInteger("length", length);
	if (length < 0) {
		throw new RangeError(`LineIndex: length must not be negative, received ${length}`);
	}
};

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

/**
 * A line table over one source text, built once and queried many times:
 * offset to `{ line, character }` and back, the number of lines, and where
 * each line starts and ends.
 *
 * @remarks
 * Positions are zero-based and `character` counts UTF-16 code units, LSP's
 * default encoding (see {@link SourcePosition}). Building the index is one
 * forward scan, `O(n)`; every lookup is a binary search, `O(log n)`, so build
 * one per text and reuse it rather than rescanning for every diagnostic.
 *
 * Out-of-range input clamps instead of throwing, following
 * `vscode-languageserver-textdocument`'s `TextDocument`, which most LSP
 * servers already use:
 *
 * - an offset below `0` reads as `0`, and one past the end as `text.length`;
 * - an offset inside a two-character terminator (the `\n` of a `\r\n`) reads
 *   as the end of its line, because no position can name the middle of a
 *   terminator;
 * - a `character` past the end of its line reads as the end of the line's
 *   text, before its terminator, and a negative one as the line's start;
 * - a `line` below `0` reads as offset `0`, and one past the last line as
 *   `text.length`.
 *
 * A value that is not an integer (`NaN`, `1.5`, `Infinity`) is a programmer
 * error, not out-of-range input, and throws a `RangeError`: clamping `NaN`
 * would silently answer "line 0".
 *
 * Every text has at least one line. The empty text has one empty line, and a
 * text ending in a terminator has an empty last line after it, so `"a\n"` has
 * two lines, as an editor shows it.
 *
 * `character` can name the low half of a surrogate pair; LSP leaves that to
 * the client, and so does this index. It offers no code-point encoding:
 * every LSP client must accept UTF-16, and each kit format package reports
 * UTF-16 offsets.
 *
 * There is no shared-instance contract. Nothing checks `instanceof LineIndex`,
 * and every value it returns is a plain record, so two installed copies of
 * this package interoperate at runtime. At the type level the class does
 * not: its `private` members make TypeScript compare it nominally, so a
 * `LineIndex` from one copy is not assignable to another copy's `LineIndex`.
 * Type a signature that takes or returns an index with the structural
 * {@link SourceIndex} interface this class implements, never with the class.
 *
 * @example
 * ```ts
 * import { LineIndex } from "@effected/source";
 *
 * const index = LineIndex.make("name: kit\r\nversion: 1\n");
 * console.log(index.lineCount);
 * // => 3
 * console.log(index.positionAt(11));
 * // => { line: 1, character: 0 }
 * console.log(index.offsetAt({ line: 1, character: 9 }));
 * // => 20
 * console.log(index.lineText(1));
 * // => "version: 1"
 * ```
 *
 * @public
 */
export class LineIndex implements SourceIndex {
	private constructor(
		/** The text this index was built over. */
		readonly text: string,
		/** The rule that decided where lines end. */
		readonly lineBreaks: LineBreaks,
		private readonly starts: ReadonlyArray<number>,
	) {}

	/**
	 * Build the line table for `text` with one forward scan.
	 *
	 * @param text - The source text.
	 * @param options - Which characters end a line; see {@link LineIndexOptions}.
	 * @returns The index.
	 */
	static make(text: string, options?: LineIndexOptions): LineIndex {
		const lineBreaks = options?.lineBreaks ?? "lsp";
		const starts: number[] = [0];
		const length = text.length;
		for (let i = 0; i < length; i++) {
			const code = text.charCodeAt(i);
			if (code === LF) {
				starts.push(i + 1);
			} else if (code === CR) {
				if (i + 1 < length && text.charCodeAt(i + 1) === LF) {
					starts.push(i + 2);
					i++;
				} else if (lineBreaks !== "lf") {
					starts.push(i + 1);
				}
			} else if ((code === LS || code === PS) && lineBreaks === "unicode") {
				starts.push(i + 1);
			}
		}
		return new LineIndex(text, lineBreaks, starts);
	}

	/** The number of lines, at least `1`. */
	get lineCount(): number {
		return this.starts.length;
	}

	/**
	 * The zero-based line that contains `offset`. An offset at a terminator
	 * belongs to the line the terminator ends.
	 *
	 * @param offset - A UTF-16 offset, clamped to `[0, text.length]`.
	 * @returns The line number.
	 */
	lineAt(offset: number): number {
		requireInteger("offset", offset);
		const target = clamp(offset, 0, this.text.length);
		let low = 0;
		let high = this.starts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if ((this.starts[mid] as number) <= target) low = mid;
			else high = mid - 1;
		}
		return low;
	}

	/**
	 * The offset of the first character of `line`.
	 *
	 * @param line - A zero-based line, clamped to `[0, lineCount - 1]`.
	 * @returns The line's start offset.
	 */
	lineStart(line: number): number {
		return this.starts[this.clampLine(line)] as number;
	}

	/**
	 * The offset just past the last character of `line`'s text, which is
	 * where its terminator starts, or `text.length` on the last line.
	 *
	 * @param line - A zero-based line, clamped to `[0, lineCount - 1]`.
	 * @returns The line's end offset, excluding its terminator.
	 */
	lineEnd(line: number): number {
		return this.endOf(this.clampLine(line));
	}

	/**
	 * The text of `line`, without its terminator.
	 *
	 * @param line - A zero-based line, clamped to `[0, lineCount - 1]`.
	 * @returns The line's text.
	 */
	lineText(line: number): string {
		const index = this.clampLine(line);
		return this.text.slice(this.starts[index], this.endOf(index));
	}

	/**
	 * The zero-based `{ line, character }` of `offset`.
	 *
	 * @param offset - A UTF-16 offset, clamped to `[0, text.length]`; one
	 *   inside a `\r\n` reads as the end of its line.
	 * @returns The position.
	 */
	positionAt(offset: number): SourcePosition {
		const line = this.lineAt(offset);
		const target = clamp(offset, 0, this.text.length);
		const start = this.starts[line] as number;
		return { line, character: Math.min(target, this.endOf(line)) - start };
	}

	/**
	 * The offset of a zero-based `{ line, character }`.
	 *
	 * @param position - The position. A `line` past the last reads as
	 *   `text.length` and one below `0` as `0`; a `character` past the line's
	 *   text reads as the line's end, before its terminator.
	 * @returns The UTF-16 offset.
	 */
	offsetAt(position: SourcePosition): number {
		requireInteger("line", position.line);
		requireInteger("character", position.character);
		if (position.line < 0) return 0;
		if (position.line >= this.starts.length) return this.text.length;
		const start = this.starts[position.line] as number;
		const end = this.endOf(position.line);
		return clamp(start + position.character, start, end);
	}

	/**
	 * The {@link SourceSpan} (LSP `Range`) of an offset range.
	 *
	 * @param range - The range; its `length` must not be negative.
	 * @returns The start and exclusive end positions.
	 */
	spanOf(range: SourceRange): SourceSpan {
		requireLength(range.length);
		return { start: this.positionAt(range.offset), end: this.positionAt(range.offset + range.length) };
	}

	/**
	 * The {@link SourceRange} of a {@link SourceSpan}, after each position is
	 * clamped as {@link LineIndex.offsetAt} clamps it.
	 *
	 * @param span - The span; `end` must not precede `start`.
	 * @returns The offset and length.
	 */
	rangeOf(span: SourceSpan): SourceRange {
		const start = this.offsetAt(span.start);
		const end = this.offsetAt(span.end);
		if (end < start) {
			throw new RangeError(
				`LineIndex: span end ${span.end.line}:${span.end.character} precedes its start ${span.start.line}:${span.start.character}`,
			);
		}
		return { offset: start, length: end - start };
	}

	/**
	 * The {@link SourceLocation} of a range: the range itself, unchanged,
	 * with the position of its start. The shape a diagnostic carries.
	 *
	 * @param range - The range; its `length` must be a non-negative integer,
	 *   as {@link LineIndex.spanOf} requires.
	 * @returns `offset`, `length`, `line` and `character`.
	 */
	locationOf(range: SourceRange): SourceLocation {
		requireLength(range.length);
		const { line, character } = this.positionAt(range.offset);
		return { offset: range.offset, length: range.length, line, character };
	}

	/**
	 * Where `line`'s text ends, derived from the next line's start rather
	 * than stored: the next start minus the terminator's length, two for a
	 * `\r\n` and one for every other terminator, or `text.length` on the
	 * last line. Keeping one table halves the index's memory; the lookup
	 * stays `O(1)` after the `O(log n)` search that found the line.
	 */
	private endOf(line: number): number {
		const next = this.starts[line + 1];
		if (next === undefined) return this.text.length;
		// A line never starts between the `\r` and `\n` of a `\r\n`, so a
		// `\r\n` just before the next start is always this line's terminator.
		return this.text.charCodeAt(next - 1) === LF && this.text.charCodeAt(next - 2) === CR ? next - 2 : next - 1;
	}

	private clampLine(line: number): number {
		requireInteger("line", line);
		return clamp(line, 0, this.starts.length - 1);
	}
}

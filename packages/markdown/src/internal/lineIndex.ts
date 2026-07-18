// An offset -> unist Point (1-based line/column) index. Built once per parse
// from the source text, iteratively (a single forward scan, no recursion),
// then queried by binary search — MarkdownNode.ts's Point construction is the
// consumer. Imports nothing; this module never participates in the cycle
// firewall (src/internal/ never imports public modules, and this file
// imports nothing at all).

/** A 1-based line/column pair, unist's `Point` shape minus the `offset` field. */
export interface LineColumn {
	readonly line: number;
	readonly column: number;
}

/**
 * A precomputed index of line-start offsets over a fixed source text,
 * answering `positionAt(offset)` in `O(log n)` via binary search rather than
 * rescanning the text per query.
 *
 * @remarks
 * Only `\n` begins a new line. A `\r` immediately before a `\n` (CRLF) is
 * left as the trailing character of the prior line — the pair still reads as
 * a single boundary because the following `\n` is what advances the line
 * counter, not the `\r`. A bare `\r` (old Mac line endings) is not
 * recognized as a break; CommonMark's preprocessing pass normalizes those
 * before this index is ever built.
 */
export class LineIndex {
	private constructor(
		private readonly text: string,
		private readonly lineStarts: ReadonlyArray<number>,
	) {}

	/** Build a {@link LineIndex} over `text` with one forward scan. */
	static make(text: string): LineIndex {
		const lineStarts: number[] = [0];
		for (let i = 0; i < text.length; i++) {
			if (text.charCodeAt(i) === 0x0a) {
				lineStarts.push(i + 1);
			}
		}
		return new LineIndex(text, lineStarts);
	}

	/**
	 * The 1-based `{ line, column }` of `offset` within this index's text.
	 * Out-of-range offsets clamp to the nearest valid position (`0` or
	 * `text.length`) rather than throwing.
	 */
	positionAt(offset: number): LineColumn {
		const clamped = Math.min(Math.max(offset, 0), this.text.length);

		let low = 0;
		let high = this.lineStarts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if ((this.lineStarts[mid] ?? 0) <= clamped) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}

		const lineStart = this.lineStarts[low] ?? 0;
		return { line: low + 1, column: clamped - lineStart + 1 };
	}
}

// One candidate line of a JSONL journal, located in the source by byte.

import { Schema } from "effect";

/**
 * A single candidate line: its text, and where it lives in the source **in
 * bytes**.
 *
 * Every offset here is a UTF-8 byte offset, never a UTF-16 code-unit index,
 * because these values are cursors into a file that persist across process
 * restarts. A `String.length`-derived offset is correct only for ASCII journals
 * and is the single most likely bug in this module.
 *
 * The terminator is **not** part of the content: `text` and `length` exclude
 * the trailing `\n`, and exclude the `\r` of a `\r\n` pair. `end` includes it,
 * which is why `end - offset` is not always `length`.
 *
 * A plain record rather than a class: `Line.split` produces one per line of
 * every read, and a class instance costs some forty times a plain object on
 * that path. The schema exists so errors can carry the line structurally.
 *
 * @example
 * ```ts
 * import { Line } from "@effected/jsonl";
 *
 * const [first] = Line.split('{"a":1}\r\n{"b":2}\n');
 * first?.text;       // '{"a":1}'
 * first?.offset;     // 0
 * first?.length;     // 7  — content bytes, no terminator
 * first?.end;        // 9  — past the CR and the LF
 * first?.terminated; // true
 * ```
 *
 * @public
 */
export const LineSlice = Schema.Struct({
	/** UTF-8 byte offset of this line's first content byte. */
	offset: Schema.Number,
	/**
	 * UTF-8 byte offset just past this line's terminator — the offset at which
	 * the next line begins, and the resume cursor for an incremental read.
	 *
	 * Equal to `offset + length` when the line is unterminated.
	 */
	end: Schema.Number,
	/** UTF-8 byte length of `text`, excluding any terminator. */
	length: Schema.Number,
	/** The line's content, with its terminator and any paired `\r` removed. */
	text: Schema.String,
	/**
	 * Whether a `\n` terminated this line in the source.
	 *
	 * `false` can only occur on the final line, and means the line **may be a
	 * torn tail** — a writer caught mid-append.
	 */
	terminated: Schema.Boolean,
});

/**
 * A single candidate line: its text, and where it lives in the source in bytes.
 *
 * @public
 */
export type LineSlice = typeof LineSlice.Type;

/**
 * Where an envelope's line sits in the journal, in UTF-8 bytes.
 *
 * All an envelope keeps of its source line: enough to resume from (`end`) or
 * to go back and read the line again (`offset`). The line's text is not kept —
 * the envelope already holds its decoded payload, and a second copy of every
 * payload as raw JSON would double what a buffered stream holds. Errors keep
 * the full {@link (LineSlice:type)}, because there the text is the evidence.
 *
 * @public
 */
export interface LinePosition {
	/** Byte offset of the line's first content byte. */
	readonly offset: number;
	/**
	 * Byte offset just past the line's terminator — where the next line begins.
	 * Persist this and pass it back as a slice's `cursor` to resume.
	 */
	readonly end: number;
}

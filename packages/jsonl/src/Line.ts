// The pure, synchronous line layer of a JSONL journal.
//
// Nothing here touches `FileSystem`, builds an `Effect`, or needs a runtime.
// This layer knows JSON, not envelopes: a malformed *envelope* and a malformed
// *line* stay distinguishable failures one layer up.

import { Result } from "effect";
import { utf8Length } from "./internal/utf8.js";
import { MalformedLine } from "./JsonlError.js";
import type { LineSlice } from "./LineSlice.js";

/**
 * Whether a line carries nothing but whitespace.
 *
 * @internal
 */
export const isBlank = (line: LineSlice): boolean => line.text.trim() === "";

/**
 * Splitting and parsing JSONL text.
 *
 * Every operation is total and synchronous: nothing here throws. A `JSON.parse`
 * failure becomes a {@link MalformedLine}, because a journal is untrusted input
 * and untrusted input fails typed.
 *
 * @public
 */
export class Line {
	private constructor() {}

	/**
	 * The UTF-8 byte length of a string.
	 *
	 * Exposed because callers doing their own offset arithmetic must measure the
	 * same way this module does. `String.length` is a different number for any
	 * non-ASCII line. An unpaired surrogate counts as the 3 bytes of U+FFFD,
	 * matching what a UTF-8 write emits.
	 *
	 * @example
	 * ```ts
	 * import { Line } from "@effected/jsonl";
	 *
	 * Line.byteLength("\u{1F600}"); // 4
	 * "\u{1F600}".length;           // 2 — the trap
	 * ```
	 */
	static byteLength(text: string): number {
		return utf8Length(text);
	}

	/**
	 * Split text into candidate lines with byte-exact offsets.
	 *
	 * Lines are separated by `\n`; a `\r` immediately preceding it is part of the
	 * terminator, so CRLF journals split identically to LF ones. A bare `\r` is
	 * ordinary content. A trailing terminator does **not** produce a phantom
	 * empty final line; interior blank lines *are* returned, because they are
	 * real bytes at real offsets. Only the final slice can be unterminated.
	 *
	 * @param text - JSONL source text.
	 * @param base - The byte offset `text` starts at in its file. Every offset
	 *   returned is shifted by it, so text read from the middle of a journal
	 *   yields offsets into the journal rather than into the text.
	 * @returns One {@link (LineSlice:type)} per candidate line, in source order.
	 */
	static split(text: string, base = 0): ReadonlyArray<LineSlice> {
		const lines: Array<LineSlice> = [];
		let offset = base;
		let start = 0;
		for (;;) {
			const newline = text.indexOf("\n", start);
			if (newline === -1) {
				break;
			}
			const carriageReturn = newline > start && text.charCodeAt(newline - 1) === 13;
			const content = text.slice(start, carriageReturn ? newline - 1 : newline);
			const length = utf8Length(content);
			const end = offset + length + (carriageReturn ? 2 : 1);
			lines.push({ offset, end, length, text: content, terminated: true });
			offset = end;
			start = newline + 1;
		}
		if (start < text.length) {
			const content = text.slice(start);
			const length = utf8Length(content);
			lines.push({ offset, end: offset + length, length, text: content, terminated: false });
		}
		return lines;
	}

	/**
	 * Parse one candidate line's JSON.
	 *
	 * Any JSON value succeeds — objects, arrays and scalars alike.
	 *
	 * @param line - A slice from {@link Line.split}.
	 * @returns The parsed value, or a {@link MalformedLine} carrying the slice so
	 *   the caller can locate the damage. An unterminated malformed line is a
	 *   torn tail; a terminated one is a hole that will never heal.
	 */
	static parseResult(line: LineSlice): Result.Result<unknown, MalformedLine> {
		try {
			return Result.succeed(JSON.parse(line.text) as unknown);
		} catch {
			// A SyntaxError from invalid JSON and a RangeError from pathological
			// nesting alike: a throw escaping here would be an uncatchable defect.
			return Result.fail(new MalformedLine({ line }));
		}
	}
}

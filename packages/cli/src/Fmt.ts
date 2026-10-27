import { Duration, Option, Predicate } from "effect";
import { causeMessage } from "./internal/causeMessage.js";
import { displayWidth, graphemes, isEscapeOnly, stripAnsi } from "./internal/displayWidth.js";

/**
 * Options for {@link Fmt.truncate}.
 *
 * @public
 */
export interface TruncateOptions {
	/** Marks the cut; `…` by default. Counted by display width. */
	readonly ellipsis?: string | undefined;
}

/**
 * Options for {@link Fmt.percent}.
 *
 * @public
 */
export interface PercentOptions {
	/** Decimal places to round to; `1` by default. A trailing zero decimal is dropped. */
	readonly digits?: number | undefined;
	/**
	 * What the input is scaled to: `1` (the default) is a ratio from 0 to 1, `100` is already a percentage from 0
	 * to 100, as istanbul's coverage numbers are.
	 */
	readonly scale?: 1 | 100 | undefined;
}

/**
 * Options for {@link Fmt.pad}.
 *
 * @public
 */
export interface PadOptions {
	/**
	 * Where the text sits in the padded field: `left` (the default) fills on the right, `right` fills on the left, and
	 * `center` splits the fill, the odd column going on the right.
	 */
	readonly align?: "left" | "right" | "center" | undefined;
	/** The fill, one column wide; a space by default. Anything that is not exactly one column wide is a space. */
	readonly fill?: string | undefined;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to match control characters
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Text made safe to lay out and print: complete ANSI and OSC sequences removed, every remaining control character
 * removed (a stray ESC, BEL, BS, DEL, the C1 range) except line feed and carriage return, and a tab turned into a
 * space.
 *
 * @remarks
 * Stripping complete sequences is not enough on its own: a lone ESC survives it, and so does whatever would
 * complete a sequence once two adjacent pieces of text are joined (`ESC` in one node, `[31m` in the next). With
 * every ESC and C0 or C1 control gone after the strip, nothing can reassemble, so the width of the text equals what
 * a terminal shows. A tab counts as no columns but draws up to eight, hence the space.
 *
 * @internal
 */
export const sanitize = (input: string): string => stripAnsi(input).replace(/\t/g, " ").replace(CONTROL, "");

/**
 * Small, pure formatting primitives for terminal output.
 *
 * @public
 */
export class Fmt {
	private constructor() {}

	/**
	 * Text made safe to lay out and print, exactly as the renderers make it: complete ANSI and OSC sequences removed,
	 * every other control character removed (a stray ESC, BEL, BS, DEL, the C1 range) except line feed and carriage
	 * return, and a tab turned into a space.
	 *
	 * @remarks
	 * For a `render` or any other text a program builds by hand from data it does not control: an error message, a
	 * file name, a value from the environment. Line breaks are kept, so split on them if the text must be one line.
	 *
	 * @param text - the text
	 */
	static readonly sanitize: (text: string) => string = sanitize;

	/**
	 * The display width of `text` in terminal columns: wide East Asian characters and emoji count two,
	 * combining marks and ANSI escapes count none.
	 *
	 * @param text - the text to measure
	 */
	static readonly width = (text: string): number => displayWidth(text);

	/**
	 * Cut `text` to at most `width` columns, ending in `ellipsis` when it was cut.
	 *
	 * @remarks
	 * Grapheme-safe: a grapheme, such as a wide character or an emoji ZWJ family, is kept whole or dropped
	 * whole, so the result is never wider than `width`. Text that already fits is returned unchanged, colour
	 * escapes included. Text that must be cut is cut as plain text: its ANSI escapes are dropped rather than cut
	 * in half. When the ellipsis cannot fit, it is omitted and the text is cut to `width`; a `width` of 0 or
	 * less gives `""`.
	 *
	 * @param text - the text to truncate
	 * @param width - the most columns the result may take
	 * @param options - the ellipsis
	 */
	static readonly truncate = (text: string, width: number, options?: TruncateOptions): string => {
		const limit = Number.isFinite(width) ? Math.floor(width) : width === Number.POSITIVE_INFINITY ? Infinity : 0;
		if (limit <= 0) return "";
		if (displayWidth(text) <= limit) return text;

		const plain = stripAnsi(text);
		const ellipsis = options?.ellipsis ?? "…";
		const ellipsisWidth = displayWidth(ellipsis);
		const useEllipsis = ellipsisWidth <= limit && ellipsis !== "";
		const budget = useEllipsis ? limit - ellipsisWidth : limit;

		let out = "";
		let used = 0;
		for (const grapheme of graphemes(plain)) {
			const w = displayWidth(grapheme);
			if (used + w > budget) break;
			out += grapheme;
			used += w;
		}
		return useEllipsis ? `${out}${ellipsis}` : out;
	};

	/**
	 * A duration as short human text: `250ms`, `1.2s`, `2s`, `1m 3s`, `2m`, `1h 2m`, `2h`.
	 *
	 * @remarks
	 * Under a second it is whole milliseconds; under a minute, seconds to one decimal with a trailing `.0`
	 * dropped; under an hour, minutes and whole seconds, with the seconds dropped when zero; from an hour, hours and
	 * whole minutes, the seconds dropped. A value that rounds up to the next unit (`999.6` to a second, `59999` to a
	 * minute, `3599999` to an hour) is written in that unit, so `1000ms`, `60s` and `60m` never appear. There is no
	 * days unit. The format is bespoke: core's `Duration.format` renders differently.
	 *
	 * The input is anything `Duration.Input` admits. A plain number is milliseconds and is used as given, never
	 * converted through a `Duration`, which rounds a fractional millisecond to whole nanoseconds and would move a value
	 * such as `999.4999999` across the rounding boundary. A `bigint` is nanoseconds, as in core. A negative, infinite
	 * or invalid input (a string `Duration.Input` cannot parse) is `0ms`: a formatter in a render path never throws.
	 *
	 * @param input - the duration; a number is milliseconds
	 */
	static readonly duration = (input: Duration.Input): string => {
		const ms =
			typeof input === "number"
				? input
				: Option.match(Duration.fromInput(input), { onNone: () => 0, onSome: Duration.toMillis });
		const value = Number.isFinite(ms) ? Math.max(0, ms) : 0;
		const whole = Math.round(value);
		if (whole < 1000) return `${whole}ms`;
		const tenths = Math.round(value / 100);
		if (tenths < 600) return `${Number((tenths / 10).toFixed(1))}s`;
		const seconds = Math.round(value / 1000);
		if (seconds >= 3600) {
			const hours = Math.floor(seconds / 3600);
			const remaining = Math.floor((seconds % 3600) / 60);
			return remaining === 0 ? `${hours}h` : `${hours}h ${remaining}m`;
		}
		const minutes = Math.floor(seconds / 60);
		const rest = seconds % 60;
		return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
	};

	/**
	 * A ratio from 0 to 1 as a percentage, or a number already from 0 to 100 with `scale: 100`: `83.3%`, `50%`,
	 * `100%`.
	 *
	 * @remarks
	 * Rounded to `digits` decimal places (one by default) with trailing zeros dropped, so whole values print
	 * without a decimal. A value that rounds to zero prints `0%`, never `-0%`. The input is not validated.
	 *
	 * @param n - the ratio, 0 to 1 (0 to 100 with `scale: 100`)
	 * @param options - the decimal places and the scale
	 */
	static readonly percent = (n: number, options?: PercentOptions): string => {
		const digits = Math.min(10, Math.max(0, Math.floor(options?.digits ?? 1)));
		const percent = options?.scale === 100 ? n : n * 100;
		return `${Number(percent.toFixed(digits))}%`;
	};

	/**
	 * A count with its noun: `1 test`, `2 tests`, `0 tests`.
	 *
	 * @param n - the count
	 * @param singular - the noun for exactly one
	 * @param plural - the noun otherwise; `singular` with an `s` appended by default
	 */
	static readonly plural = (n: number, singular: string, plural?: string): string =>
		`${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;

	/**
	 * Pad `text` to `width` terminal columns, measured as {@link Fmt.width} measures: a wide character counts two and
	 * an escape sequence none, so coloured text pads to the same column as plain text.
	 *
	 * @remarks
	 * Text already `width` columns or wider is returned unchanged: compose with {@link Fmt.truncate} to cut it. A
	 * `width` that is not a finite number pads nothing. Never throws.
	 *
	 * @param text - the text to pad
	 * @param width - the columns the result should take
	 * @param options - the alignment and the fill
	 */
	static readonly pad = (text: string, width: number, options?: PadOptions): string => {
		const missing = Number.isFinite(width) ? Math.floor(width) - displayWidth(text) : 0;
		if (missing <= 0) return text;
		const fill =
			options?.fill !== undefined && displayWidth(options.fill) === 1 && stripAnsi(options.fill) === options.fill
				? options.fill
				: " ";
		switch (options?.align) {
			case "right":
				return `${fill.repeat(missing)}${text}`;
			case "center": {
				const before = Math.floor(missing / 2);
				return `${fill.repeat(before)}${text}${fill.repeat(missing - before)}`;
			}
			default:
				return `${text}${fill.repeat(missing)}`;
		}
	};

	/**
	 * `text` without its escape sequences: CSI (colour, cursor moves, erases), OSC (titles, OSC 8 hyperlinks) ending in
	 * BEL or ST, the DCS, SOS, PM and APC strings, and every other escape, the nF sequences (`ESC ( B`) and the
	 * two-byte ones (`ESC 7`, `ESC 8`, `ESC =`, `ESC c`).
	 *
	 * @remarks
	 * The same strip {@link Fmt.width} and {@link Fmt.sanitize} start from. Only complete sequences go: a lone ESC, or
	 * any other control character, is kept, and so is an ESC in front of a lowercase letter other than `c`, which a
	 * stray ESC before a word would otherwise cost the word its first letter. An unterminated CSI or OSC keeps its `[`
	 * or `]`. Use {@link Fmt.sanitize} for text that will be laid out and printed.
	 *
	 * @param text - the text
	 */
	static readonly stripAnsi = (text: string): string => stripAnsi(text);

	/**
	 * Whether `text` is nothing but escape sequences, as {@link Fmt.stripAnsi} reads them: a cursor hide or show, a
	 * clear-screen, an erase-scrollback. Empty text is not escape-only, and neither is a bare control character
	 * (`\r`, BEL), which is not an escape sequence.
	 *
	 * @param text - the text
	 */
	static readonly isEscapeOnly = (text: string): boolean => isEscapeOnly(text);

	/**
	 * Integers as compact ranges: `[1, 2, 3, 5, 10, 11]` is `"1-3,5,10-11"`, a run of consecutive numbers written
	 * `start-end` and the rest one by one, joined with commas.
	 *
	 * @remarks
	 * The input is sorted and its duplicates dropped first, so order does not matter. Anything that is not a finite
	 * integer is left out, and no input is `""`. Never throws.
	 *
	 * @param numbers - the integers, such as line numbers
	 */
	static readonly ranges = (numbers: Iterable<number>): string => {
		const sorted = [...new Set(Array.from(numbers).filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
		const parts: Array<string> = [];
		let index = 0;
		while (index < sorted.length) {
			const start = sorted[index] as number;
			let end = start;
			while (index + 1 < sorted.length && sorted[index + 1] === end + 1) end = sorted[++index] as number;
			parts.push(start === end ? `${start}` : `${start}-${end}`);
			index++;
		}
		return parts.join(",");
	};

	/**
	 * Any value as text, without ever throwing.
	 *
	 * @remarks
	 * A string is itself; a number, boolean, bigint or symbol is `String(value)`; `undefined` and `null` are
	 * `"undefined"` and `"null"`. A value with a string `message` (an `Error`, one from another realm, a plain
	 * `{ message }`) is that message. Anything else is its JSON, or `String(value)` when it has none (a cycle, a
	 * function), or `"[unprintable value]"` when that throws too. A getter that throws is a value with no message.
	 *
	 * The text is not sanitised: pass it through {@link Fmt.sanitize} before printing data you do not control. For
	 * the messages along an error's `cause` chain, use {@link Fmt.causeMessage}.
	 *
	 * @param value - the value
	 */
	static readonly describe = (value: unknown): string => {
		if (Predicate.isString(value)) return value;
		if (value === undefined || value === null) return String(value);
		if (typeof value !== "object" && typeof value !== "function") return String(value);
		try {
			if (Predicate.hasProperty(value, "message") && Predicate.isString(value.message)) return value.message;
		} catch {
			// A throwing `message` getter: describe the value some other way.
		}
		try {
			const json = JSON.stringify(value);
			if (json !== undefined) return json;
		} catch {
			// A cycle or a bigint: fall through to String.
		}
		try {
			return String(value);
		} catch {
			return "[unprintable value]";
		}
	};

	/**
	 * Every distinct non-empty message along a value's `cause` chain, nearest first and joined with `: `, or
	 * `undefined` when nothing along it has one.
	 *
	 * @remarks
	 * The kit's one guarded cause-message read, the one its own errors render a preserved cause with. A node's message
	 * is a thrown string or a non-empty string `message` property, read without `instanceof Error`, so an error from
	 * another realm or a plain `{ message }` object counts. A deeper message the joined text already contains is not
	 * repeated, and one that contains the joined text replaces it, so a `SqlError` wrapping SQLite's own text reads
	 * `Failed to execute statement: SQLITE_BUSY: database is locked`. It is the whole chain, not the innermost
	 * message alone. The walk stops after eight nodes, so a cyclic chain terminates.
	 *
	 * Never throws: a `message` getter that throws leaves that node without text, and a `cause` getter that throws ends
	 * the walk with the text found so far, `undefined` when there is none, so a caller's own fallback
	 * (`?? Fmt.describe(value)`) applies.
	 *
	 * @param value - the error, or whatever was thrown
	 */
	static readonly causeMessage = (value: unknown): string | undefined => causeMessage(value);
}

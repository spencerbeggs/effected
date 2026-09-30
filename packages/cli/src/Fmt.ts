import { displayWidth, graphemes, stripAnsi } from "./internal/displayWidth.js";

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
}

/**
 * Small, pure formatting primitives for terminal output.
 *
 * @public
 */
export class Fmt {
	private constructor() {}

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
	 * A duration in milliseconds as short human text: `250ms`, `1.2s`, `2s`, `1m 3s`, `2m`, `1h 2m`, `2h`.
	 *
	 * @remarks
	 * Under a second it is whole milliseconds; under a minute, seconds to one decimal with a trailing `.0`
	 * dropped; under an hour, minutes and whole seconds, with the seconds dropped when zero; from an hour, hours and
	 * whole minutes, the seconds dropped. A value that rounds up to the next unit (`999.6` to a second, `59999` to a
	 * minute, `3599999` to an hour) is written in that unit, so `1000ms`, `60s` and `60m` never appear. There is no
	 * days unit. A negative or non-finite input is `0ms`.
	 *
	 * @param ms - the duration in milliseconds
	 */
	static readonly duration = (ms: number): string => {
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
	 * A ratio from 0 to 1 as a percentage: `83.3%`, `50%`, `100%`.
	 *
	 * @remarks
	 * Rounded to `digits` decimal places (one by default) with trailing zeros dropped, so whole values print
	 * without a decimal. A value that rounds to zero prints `0%`, never `-0%`. The input is not validated.
	 *
	 * @param n - the ratio, 0 to 1
	 * @param options - the decimal places
	 */
	static readonly percent = (n: number, options?: PercentOptions): string => {
		const digits = Math.min(10, Math.max(0, Math.floor(options?.digits ?? 1)));
		return `${Number((n * 100).toFixed(digits))}%`;
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
}

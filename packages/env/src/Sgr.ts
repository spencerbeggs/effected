import type { ColorLevel } from "./ColorLevel.js";

/**
 * A basic SGR style: an attribute or one of the 16 base foreground colours.
 *
 * @public
 */
export type SgrStyle =
	| "bold"
	| "dim"
	| "italic"
	| "underline"
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "gray";

/** How each style opens and closes. Closers are per attribute, so nested paints compose. */
const CODES: Readonly<Record<SgrStyle, readonly [open: number, close: number]>> = {
	bold: [1, 22],
	dim: [2, 22],
	italic: [3, 23],
	underline: [4, 24],
	black: [30, 39],
	red: [31, 39],
	green: [32, 39],
	yellow: [33, 39],
	blue: [34, 39],
	magenta: [35, 39],
	cyan: [36, 39],
	white: [37, 39],
	gray: [90, 39],
};

/**
 * `ESC [ params m`, parameters being digits, `;` and `:`. The parameter class excludes ESC and `m`, so each
 * match attempt scans forward once and a run that never reaches `m` fails in linear time.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the escape byte is the point
const SGR = /\u001b\[[0-9;:]*m/g;

/**
 * SGR-only terminal text helpers: strip colour and attribute sequences, or paint text with basic styles.
 *
 * @remarks
 * Only SGR (`ESC [ params m`) is touched. Cursor moves, erases and OSC 8 hyperlinks survive {@link Sgr.strip},
 * unlike a general escape stripper. {@link Sgr.paint} takes an explicit {@link ColorLevel}, so detection and
 * audience decisions stay with the caller. Basic colours only; no 256-colour or truecolor.
 *
 * @example
 * ```ts
 * import { Sgr } from "@effected/env"
 *
 * Sgr.paint("basic", ["bold", "red"], "failed")
 * Sgr.strip("\u001b[31mred\u001b[39m") // "red"
 * ```
 *
 * @public
 */
export class Sgr {
	private constructor() {}

	/**
	 * Remove SGR sequences, the colon form included. Cursor moves and OSC 8 hyperlinks are kept.
	 *
	 * @public
	 */
	static strip(text: string): string {
		return text.replace(SGR, "");
	}

	/**
	 * Wrap `text` in one style or several; the identity at level `none` and for empty text.
	 *
	 * @remarks
	 * A style array is listed outermost first. Each attribute closes with its own code, and a closer found inside
	 * `text` is followed by the opener again, so a painted span nested in a painted span leaves the outer style in
	 * force for the text after it.
	 *
	 * @public
	 */
	static paint(level: ColorLevel, style: SgrStyle | ReadonlyArray<SgrStyle>, text: string): string {
		if (level === "none" || text === "") return text;
		const styles = typeof style === "string" ? [style] : style;
		let out = text;
		for (const name of styles.toReversed()) {
			const [o, c] = CODES[name];
			const open = `\u001b[${o}m`;
			const close = `\u001b[${c}m`;
			out = `${open}${out.replaceAll(close, `${close}${open}`)}${close}`;
		}
		return out;
	}
}

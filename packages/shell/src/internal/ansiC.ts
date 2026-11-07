// Decoding the body of an ANSI-C quoted string, `$'…'`, the way bash does.
// Pure and total: an escape it cannot decode is kept as written.

/** @internal */
export interface AnsiCDecoded {
	readonly value: string;
	/** Offsets (into the source) of `\u` / `\U` escapes naming a code point above U+10FFFF. */
	readonly invalid: ReadonlyArray<{ readonly offset: number; readonly length: number }>;
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
	a: "\x07",
	b: "\b",
	e: "\x1b",
	E: "\x1b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
	v: "\v",
	"\\": "\\",
	"'": "'",
	'"': '"',
	"?": "?",
};

const isOctal = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "7";

const isHex = (c: string | undefined): boolean =>
	c !== undefined && ((c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F"));

/**
 * Decode `source[from, to)`, the text between `$'` and the closing `'`.
 *
 * @remarks
 * Follows bash's `$'…'` table: `\a \b \e \E \f \n \r \t \v \\ \' \" \?`,
 * octal `\nnn` (one to three digits, masked to a byte), `\xHH` (one or two
 * hex digits), `\uHHHH` (one to four), `\UHHHHHHHH` (one to eight) and `\cX`
 * (a control character). A byte escape decodes to the code point of that
 * byte, not to a UTF-8 sequence. An escape bash does not know keeps its
 * backslash. A NUL ends the string, as it does in bash, whose strings are C
 * strings: everything after it is dropped. A `\u` or `\U` escape above
 * U+10FFFF is kept as written and reported, so `String.fromCodePoint` is
 * never handed a value it would throw on.
 *
 * @internal
 */
export const decodeAnsiC = (source: string, from: number, to: number): AnsiCDecoded => {
	let value = "";
	const invalid: Array<{ readonly offset: number; readonly length: number }> = [];
	let run = from;
	let i = from;
	while (i < to) {
		if (source[i] !== "\\") {
			i += 1;
			continue;
		}
		value += source.slice(run, i);
		const next = i + 1 < to ? source[i + 1] : undefined;
		if (next === undefined) {
			value += "\\";
			i += 1;
			run = i;
			continue;
		}
		const simple = SIMPLE_ESCAPES[next];
		if (simple !== undefined) {
			value += simple;
			i += 2;
			run = i;
			continue;
		}
		if (isOctal(next)) {
			let j = i + 1;
			let code = 0;
			while (j < to && j < i + 4 && isOctal(source[j])) {
				code = code * 8 + (source.charCodeAt(j) - 48);
				j += 1;
			}
			code &= 0xff;
			if (code === 0) return { value, invalid };
			value += String.fromCharCode(code);
			i = j;
			run = i;
			continue;
		}
		if (next === "x" || next === "u" || next === "U") {
			const max = next === "x" ? 2 : next === "u" ? 4 : 8;
			let j = i + 2;
			while (j < to && j < i + 2 + max && isHex(source[j])) j += 1;
			if (j === i + 2) {
				// No digits: bash keeps the escape as written.
				value += source.slice(i, j);
				i = j;
				run = i;
				continue;
			}
			const code = Number.parseInt(source.slice(i + 2, j), 16);
			if (code === 0) return { value, invalid };
			if (code > 0x10ffff) {
				invalid.push({ offset: i, length: j - i });
				value += source.slice(i, j);
			} else {
				value += String.fromCodePoint(code);
			}
			i = j;
			run = i;
			continue;
		}
		if (next === "c") {
			const target = i + 2 < to ? source[i + 2] : undefined;
			if (target === undefined) {
				value += "\\c";
				i += 2;
				run = i;
				continue;
			}
			const code = target === "?" ? 0x7f : target.toUpperCase().charCodeAt(0) & 0x1f;
			if (code === 0) return { value, invalid };
			value += String.fromCharCode(code);
			i += 3;
			run = i;
			continue;
		}
		value += `\\${next}`;
		i += 2;
		run = i;
	}
	value += source.slice(run, to);
	return { value, invalid };
};

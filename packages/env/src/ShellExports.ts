import { Effect, Result, Schema } from "effect";

/**
 * Why {@link ShellExports.parseResult} or {@link ShellExports.parseBytesResult} rejected a text.
 *
 * - `unsupported-statement`: anything but a blank line, a `#` comment line, or one `export NAME=WORD` (a second
 *   assignment, a trailing comment or word, an operator, `export NAME` without a value, `NAME+=`, a subscript,
 *   a backslash-newline continuation, or any other command).
 * - `expansion`: a character the shell would expand or evaluate: an unquoted `$` (other than `$'`), a backtick, `{`,
 *   `}`, `*`, `?`, `[` or `]`, or a `~` at the start of the value or after `:` or `=`; or a `$` or backtick inside
 *   `"…"`.
 * - `special-variable`: a name bash treats specially (dynamic, read-only, an array, set by bash itself, or one that
 *   changes how bash reads the rest of the text), or any name starting with `BASH_`.
 * - `unterminated-quote`: a `'…'`, `"…"` or `$'…'` runs to the end of the text.
 * - `invalid-encoding`: text the dialect does not spell that way: a raw control character (other than a tab or
 *   newline inside quotes), a `$'…'` whose bytes are not UTF-8 or that holds a NUL escape, a `\u`/`\U` escape (its
 *   bytes depend on the locale), an escape bash does not define, or a lone UTF-16 surrogate; and, read as bytes, a
 *   non-ASCII byte outside `$'…'` that does not begin a whole UTF-8 character.
 * - `invalid-name`: the name does not match `[A-Za-z_][A-Za-z0-9_]*`.
 *
 * @public
 */
export type ShellExportsErrorReason =
	| "unsupported-statement"
	| "expansion"
	| "special-variable"
	| "unterminated-quote"
	| "invalid-encoding"
	| "invalid-name";

/**
 * The first place a text leaves the {@link ShellExports} dialect. The whole text is rejected: once one statement is
 * not understood, no earlier variable can be trusted.
 *
 * @public
 */
export class ShellExportsError extends Schema.TaggedError<ShellExportsError>()("ShellExportsError", {
	/** The 1-based line of the offending character (lines end at `\n`). */
	line: Schema.Number,
	/**
	 * The 1-based column of the offending character, in UTF-16 code units from the line start (for bytes, of the line
	 * decoded as UTF-8).
	 */
	column: Schema.Number,
	/** What is wrong there. */
	reason: Schema.Literals([
		"unsupported-statement",
		"expansion",
		"special-variable",
		"unterminated-quote",
		"invalid-encoding",
		"invalid-name",
	]),
}) {
	override get message(): string {
		return `Not a shell export file: ${this.reason} at line ${this.line}, column ${this.column}`;
	}
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Names bash does not leave as plain variables when a file exports them: read-only (UID, EUID, PPID, SHELLOPTS,
// BASHOPTS, BASH_VERSINFO), dynamic (RANDOM, SRANDOM, LINENO, SECONDS, EPOCHSECONDS, EPOCHREALTIME, BASHPID, HISTCMD,
// OPTIND, `_`), arrays that never reach the environment (GROUPS, FUNCNAME, DIRSTACK), set by bash itself in every
// shell it starts (BASH, IFS, SHLVL, PWD, OLDPWD, COMP_WORDBREAKS), written by bash builtins (OPTARG, REPLY, MAPFILE, COPROC), or
// changing how bash reads what follows (POSIXLY_CORRECT turns on POSIX mode). Each is pinned against bash in the tests.
const SPECIAL = new Set([
	"UID",
	"EUID",
	"PPID",
	"SHELLOPTS",
	"BASHOPTS",
	"RANDOM",
	"SRANDOM",
	"LINENO",
	"SECONDS",
	"EPOCHSECONDS",
	"EPOCHREALTIME",
	"GROUPS",
	"BASHPID",
	"HISTCMD",
	"FUNCNAME",
	"OPTIND",
	"OPTARG",
	"_",
	"BASH",
	"DIRSTACK",
	"IFS",
	"POSIXLY_CORRECT",
	"SHLVL",
	"PWD",
	"OLDPWD",
	"REPLY",
	"MAPFILE",
	"COPROC",
	"COMP_WORDBREAKS",
]);

/** Whether bash treats `name` specially: the denylist, or the `BASH_` prefix bash reserves for its own variables. */
const isSpecial = (name: string): boolean => SPECIAL.has(name) || name.startsWith("BASH_");

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const isControl = (code: number): boolean => code < 0x20 || code === 0x7f;
const isOctal = (code: number | undefined): boolean => code !== undefined && code >= 0x30 && code <= 0x37;
const isHex = (code: number | undefined): boolean =>
	code !== undefined &&
	((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66));
// Name characters by code, so the statement loop tests no regex per character.
const isNameChar = (code: number): boolean =>
	(code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f;

const hexValue = (code: number): number => (code <= 0x39 ? code - 0x30 : (code | 0x20) - 0x57);

// ignoreBOM keeps a leading U+FEFF: each word is decoded on its own, and bash exports the BOM as part of the value.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const lenient = new TextDecoder("utf-8", { ignoreBOM: true });
const encoder = new TextEncoder();

// The ASCII bytes the tokenizer branches on.
const TAB = 0x09;
const LF = 0x0a;
const SPACE = 0x20;
const DQUOTE = 0x22;
const HASH = 0x23;
const DOLLAR = 0x24;
const SQUOTE = 0x27;
const SEMI = 0x3b;
const EQUALS = 0x3d;
const BACKSLASH = 0x5c;
const BACKTICK = 0x60;
const COLON = 0x3a;
const TILDE = 0x7e;
const EXPORT = [0x65, 0x78, 0x70, 0x6f, 0x72, 0x74];
/** Unquoted, these expand: a backtick, `{`, `}`, `*`, `?`, `[`, `]`. */
const EXPANDS = new Set([0x60, 0x7b, 0x7d, 0x2a, 0x3f, 0x5b, 0x5d]);
/** Unquoted, these are operators: `|`, `&`, `<`, `>`, `(`, `)`. */
const OPERATORS = new Set([0x7c, 0x26, 0x3c, 0x3e, 0x28, 0x29]);

/** The one-character `$'…'` escapes, as bytes, keyed by the escape letter's byte. */
const SIMPLE_ESCAPES: ReadonlyMap<number, number> = new Map([
	[0x61, 0x07], // a
	[0x62, 0x08], // b
	[0x65, 0x1b], // e
	[0x45, 0x1b], // E
	[0x66, 0x0c], // f
	[0x6e, 0x0a], // n
	[0x72, 0x0d], // r
	[0x74, 0x09], // t
	[0x76, 0x0b], // v
	[0x5c, 0x5c], // \
	[0x27, 0x27], // '
	[0x22, 0x22], // "
	[0x3f, 0x3f], // ?
]);

/**
 * The `\c` targets every bash this dialect promises reads alike: letters, `@`, `[`, `]`, `^` and `_`. `\c?` is left
 * out because bash versions disagree on it (3.2 reads 0x1F, 5.x reads DEL), and so is every other target, which bash
 * reads as its low five bits but no writer emits. `\c@` is NUL, rejected after decoding like every NUL.
 */
const isControlTarget = (code: number | undefined): code is number =>
	code !== undefined &&
	((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || [0x40, 0x5b, 0x5d, 0x5e, 0x5f].includes(code));

const inRange = (code: number | undefined, low: number, high: number): boolean =>
	code !== undefined && code >= low && code <= high;

/**
 * The length of the well-formed UTF-8 sequence at `at` (WHATWG's table: no overlong form, no surrogate, nothing past
 * U+10FFFF), or 0 when the bytes there are not one.
 */
const utf8Length = (bytes: Uint8Array, at: number): number => {
	const lead = bytes[at] as number;
	if (lead < 0x80) return 1;
	const b1 = bytes[at + 1];
	if (lead >= 0xc2 && lead <= 0xdf) return inRange(b1, 0x80, 0xbf) ? 2 : 0;
	const low = lead === 0xe0 ? 0xa0 : lead === 0xf0 ? 0x90 : 0x80;
	const high = lead === 0xed ? 0x9f : lead === 0xf4 ? 0x8f : 0xbf;
	if (lead >= 0xe0 && lead <= 0xef) return inRange(b1, low, high) && inRange(bytes[at + 2], 0x80, 0xbf) ? 3 : 0;
	if (lead >= 0xf0 && lead <= 0xf4)
		return inRange(b1, low, high) && inRange(bytes[at + 2], 0x80, 0xbf) && inRange(bytes[at + 3], 0x80, 0xbf) ? 4 : 0;
	return 0;
};

/** A rejection at a byte offset; the caller turns it into a line and column. */
class Reject {
	constructor(
		readonly reason: ShellExportsErrorReason,
		readonly at: number,
	) {}
}

/**
 * The single linear pass, over bytes: every byte is visited a bounded number of times, and nothing is copied per
 * line. Outside `$'…'` every non-ASCII byte must start a whole UTF-8 character; inside it, raw bytes and byte escapes
 * join one byte string, which must then be UTF-8 as a whole.
 */
const tokenize = (src: Uint8Array): Readonly<Record<string, string>> => {
	const vars: Record<string, string> = Object.create(null);
	const n = src.length;
	let i = 0;
	let lineStart = true;

	/**
	 * One raw character at `at` outside `$'…'`, appended to `out`: a control byte is rejected (a tab and newline are
	 * let through when `quoted`), and a non-ASCII byte must start a whole UTF-8 character. Returns its length.
	 */
	const rawChar = (out: Array<number>, at: number, quoted: boolean): number => {
		const code = src[at] as number;
		if (isControl(code) && !(quoted && (code === TAB || code === LF))) throw new Reject("invalid-encoding", at);
		const length = utf8Length(src, at);
		if (length === 0) throw new Reject("invalid-encoding", at);
		for (let k = 0; k < length; k++) out.push(src[at + k] as number);
		return length;
	};

	/** `$'…'` from just past `$'`, appended to `out`; leaves `i` past the closing quote. */
	const ansiC = (out: Array<number>): void => {
		const from = out.length;
		for (;;) {
			if (i >= n) throw new Reject("unterminated-quote", i);
			const c = src[i] as number;
			if (c === SQUOTE) {
				i++;
				break;
			}
			if (c !== BACKSLASH) {
				// A raw byte, high or not: bash 3.2's printf %q leaves some bytes of a character raw and escapes the rest.
				if (isControl(c) && c !== TAB && c !== LF) throw new Reject("invalid-encoding", i);
				out.push(c);
				i++;
				continue;
			}
			const escapeAt = i;
			const e = src[i + 1];
			if (e === undefined) throw new Reject("unterminated-quote", i);
			i += 2;
			const simple = SIMPLE_ESCAPES.get(e);
			let byte: number;
			if (simple !== undefined) {
				byte = simple;
			} else if (isOctal(e)) {
				// Up to three octal digits, the escape letter the first; a value past 0o377 keeps its low byte, as in bash.
				byte = e - 0x30;
				for (let k = 0; k < 2 && isOctal(src[i]); k++) byte = byte * 8 + ((src[i++] as number) - 0x30);
				byte &= 0xff;
			} else if (e === 0x78 /* x */) {
				if (!isHex(src[i])) throw new Reject("invalid-encoding", escapeAt);
				byte = 0;
				for (let k = 0; k < 2 && isHex(src[i]); k++) byte = byte * 16 + hexValue(src[i++] as number);
			} else if (e === 0x63 /* c */) {
				const target = src[i];
				if (!isControlTarget(target)) throw new Reject("invalid-encoding", escapeAt);
				i++;
				byte = target & 0x1f;
			} else {
				// \u and \U spell a code point whose bytes depend on the locale; anything else is no escape bash defines.
				throw new Reject("invalid-encoding", escapeAt);
			}
			// A bash string cannot hold NUL: bash would cut the value short here.
			if (byte === 0) throw new Reject("invalid-encoding", escapeAt);
			out.push(byte);
		}
		try {
			decoder.decode(new Uint8Array(out.slice(from)));
		} catch {
			throw new Reject("invalid-encoding", i - 1);
		}
	};

	/** One WORD from `i`, up to an unquoted blank, newline, `;` or the end. */
	const word = (): string => {
		const start = i;
		const out: Array<number> = [];
		for (;;) {
			if (i >= n) break;
			const c = src[i] as number;
			if (c === SPACE || c === TAB || c === LF || c === SEMI) break;
			if (c === SQUOTE) {
				const close = src.indexOf(SQUOTE, i + 1);
				if (close === -1) throw new Reject("unterminated-quote", i);
				for (let k = i + 1; k < close; ) k += rawChar(out, k, true);
				i = close + 1;
			} else if (c === DQUOTE) {
				i++;
				for (;;) {
					if (i >= n) throw new Reject("unterminated-quote", i);
					const q = src[i] as number;
					if (q === DQUOTE) {
						i++;
						break;
					}
					if (q === DOLLAR || q === BACKTICK) throw new Reject("expansion", i);
					if (q === BACKSLASH) {
						const next = src[i + 1];
						if (next === undefined) throw new Reject("unterminated-quote", i);
						if (next === DQUOTE || next === BACKSLASH) {
							out.push(next);
							i += 2;
							continue;
						}
						// `\$` and a backslash-backtick hold the characters the dialect keeps out of quotes; `\`-newline
						// is a continuation.
						if (next === DOLLAR || next === BACKTICK) throw new Reject("expansion", i + 1);
						if (next === LF) throw new Reject("unsupported-statement", i);
						out.push(BACKSLASH);
						i++;
						continue;
					}
					i += rawChar(out, i, true);
				}
			} else if (c === DOLLAR) {
				if (src[i + 1] !== SQUOTE) throw new Reject("expansion", i);
				i += 2;
				ansiC(out);
			} else if (c === BACKSLASH) {
				const next = src[i + 1];
				if (next === undefined || next === LF) throw new Reject("unsupported-statement", i);
				i += 1 + rawChar(out, i + 1, false);
			} else if (EXPANDS.has(c)) {
				throw new Reject("expansion", i);
			} else if (c === TILDE && (i === start || src[i - 1] === COLON || src[i - 1] === EQUALS)) {
				// A tilde expands at the start of an assignment's value and after `:` or `=` in it; elsewhere it is literal.
				throw new Reject("expansion", i);
			} else if (OPERATORS.has(c)) {
				throw new Reject("unsupported-statement", i);
			} else {
				i += rawChar(out, i, false);
			}
		}
		// Every part was checked as it was read, so the whole is UTF-8.
		return decoder.decode(new Uint8Array(out));
	};

	const isExport = (at: number): boolean => {
		for (let k = 0; k < EXPORT.length; k++) if (src[at + k] !== EXPORT[k]) return false;
		return src[at + EXPORT.length] === SPACE || src[at + EXPORT.length] === TAB;
	};

	while (i < n) {
		const c = src[i] as number;
		if (c === SPACE || c === TAB) {
			i++;
			continue;
		}
		if (c === LF) {
			i++;
			lineStart = true;
			continue;
		}
		if (c === HASH && lineStart) {
			const nl = src.indexOf(LF, i);
			i = nl === -1 ? n : nl;
			continue;
		}
		// A statement: `export`, blanks, NAME, `=`, WORD, then blanks and a newline, `;` or the end.
		if (!isExport(i)) throw new Reject("unsupported-statement", i);
		i += EXPORT.length;
		while (src[i] === SPACE || src[i] === TAB) i++;
		const nameStart = i;
		while (i < n && isNameChar(src[i] as number)) i++;
		if (i === nameStart) throw new Reject(src[i] === DOLLAR ? "expansion" : "unsupported-statement", nameStart);
		// A name is ASCII by construction, so its bytes are its characters.
		const name = lenient.decode(src.subarray(nameStart, i));
		if (!NAME.test(name)) throw new Reject("invalid-name", nameStart);
		// `NAME+=`, `NAME[…]=` and `export NAME` with no value all stop here.
		if (src[i] !== EQUALS) throw new Reject("unsupported-statement", i);
		if (isSpecial(name)) throw new Reject("special-variable", nameStart);
		i++;
		const value = word();
		while (src[i] === SPACE || src[i] === TAB) i++;
		if (i < n && src[i] !== LF && src[i] !== SEMI) throw new Reject("unsupported-statement", i);
		if (src[i] === SEMI) i++;
		vars[name] = value;
		lineStart = false;
	}
	return vars;
};

/**
 * The 1-based line and column of byte offset `at`: the column counts UTF-16 code units of the line so far, decoded
 * leniently, so a text and its UTF-8 bytes report the same position. Called once, on rejection.
 */
const position = (src: Uint8Array, at: number): { readonly line: number; readonly column: number } => {
	let line = 1;
	let lineStart = 0;
	for (let k = src.indexOf(LF); k !== -1 && k < at; k = src.indexOf(LF, k + 1)) {
		line++;
		lineStart = k + 1;
	}
	return { line, column: lenient.decode(src.subarray(lineStart, at)).length + 1 };
};

/** Runs the byte pass over `src`, turning a rejection into a typed failure. */
const run = (src: Uint8Array): Result.Result<Readonly<Record<string, string>>, ShellExportsError> => {
	try {
		return Result.succeed(tokenize(src));
	} catch (error) {
		if (!(error instanceof Reject)) throw error;
		return Result.fail(new ShellExportsError({ ...position(src, error.at), reason: error.reason }));
	}
};

// A value needs no quoting when every character is one of these (printf %q leaves them bare too).
const BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;

const ANSI_C_ESCAPES: Readonly<Record<string, string>> = {
	"\u0007": "\\a",
	"\b": "\\b",
	"\u001b": "\\E",
	"\f": "\\f",
	"\n": "\\n",
	"\r": "\\r",
	"\t": "\\t",
	"\v": "\\v",
	"\\": "\\\\",
	"'": "\\'",
};

const hasControl = (value: string): boolean => {
	for (let k = 0; k < value.length; k++) if (isControl(value.charCodeAt(k))) return true;
	return false;
};

const quote = (value: string): string => {
	if (value === "") return "''";
	if (BARE.test(value)) return value;
	if (hasControl(value)) {
		let body = "";
		for (const ch of value) {
			const code = ch.codePointAt(0) as number;
			body += ANSI_C_ESCAPES[ch] ?? (isControl(code) ? `\\${code.toString(8).padStart(3, "0")}` : ch);
		}
		return `$'${body}'`;
	}
	return `'${value.replaceAll("'", "'\\''")}'`;
};

/**
 * Read and write shell export files in one strict dialect: what `printf 'export %s=%q\n'` and
 * {@link ShellExports.format} write, and Claude Code's `session-env` files use.
 *
 * @remarks
 * The dialect is blank lines, `#` comment lines (a comment starts at a line's first non-blank character), and
 * `export NAME=WORD` statements, one assignment each, ending at an unquoted newline or `;`. NAME matches
 * `[A-Za-z_][A-Za-z0-9_]*` and is not a variable bash treats specially. WORD concatenates bare characters with no
 * expansion character (a `~` only where bash would not expand it), `\x` escapes, `'…'`, `"…"` without `$` or a backtick, and `$'…'` (bash's escapes; `\xHH` and
 * `\nnn` bytes decoded as UTF-8).
 *
 * Nothing is interpreted: a text inside the dialect means exactly the variables it names, as bash sourcing it would
 * export them, and anything else rejects the whole text. That claim assumes the sourcing shell has no `export`
 * function or alias and no read-only variable the text names. Pure and synchronous: no `process`, no IO.
 *
 * Core's `ConfigProvider.fromDotEnvContents` is not enough here: it reads a lenient dotenv grammar (`:` separators,
 * trailing comments, backtick quotes, no `$'…'` decoding) and skips what it does not understand, so it cannot promise
 * that what it read is what bash would export.
 *
 * @example
 * ```ts
 * import { ShellExports } from "@effected/env"
 * import { Result } from "effect"
 *
 * const parsed = ShellExports.parseResult("export GREETING=$'hello\\nworld'\nexport NAME='it'\\''s'\n")
 * if (Result.isSuccess(parsed)) {
 * 	parsed.success.GREETING // "hello\nworld"
 * }
 * ```
 *
 * @public
 */
export class ShellExports {
	private constructor() {}

	/**
	 * Read a text in the dialect: the variables it exports, or the first place it leaves the dialect.
	 *
	 * @remarks
	 * A later export of the same name wins, as in bash. The record has a null prototype, so a `__proto__` name is an
	 * ordinary key. Linear in the text's length.
	 *
	 * @param text - the file's text
	 */
	static parseResult(text: string): Result.Result<Readonly<Record<string, string>>, ShellExportsError> {
		// A lone surrogate has no UTF-8 form, so it is reported before the text becomes bytes.
		const surrogate = LONE_SURROGATE.exec(text);
		if (surrogate !== null) {
			const prefix = encoder.encode(text.slice(0, surrogate.index));
			return Result.fail(new ShellExportsError({ ...position(prefix, prefix.length), reason: "invalid-encoding" }));
		}
		return run(encoder.encode(text));
	}

	/**
	 * Read a file's bytes in the dialect: {@link ShellExports.parseResult} at the byte level, so a value bash wrote
	 * partly as raw bytes reads back whole.
	 *
	 * @remarks
	 * macOS's `/bin/bash` 3.2 writes a non-ASCII value through `printf %q` as raw bytes mixed with octal escapes inside
	 * one `$'…'`: `日` becomes the raw byte 0xE6, the escape `\227`, then the raw byte 0xA5. Decoding the file to a string first
	 * turns those lone raw bytes into U+FFFD, and {@link ShellExports.parseResult} then rightly rejects the text. Here
	 * the raw bytes and byte escapes of each `$'…'` join one byte string, which must be UTF-8 as a whole. Outside
	 * `$'…'`, every non-ASCII byte must begin a whole UTF-8 character, and a `#` comment line is skipped unread.
	 *
	 * The dialect is otherwise the same: for the UTF-8 bytes of any text, the result equals
	 * {@link ShellExports.parseResult}'s for that text, rejection position included. A rejection's column counts
	 * UTF-16 code units of its line decoded as UTF-8, a malformed sequence counting as U+FFFD.
	 *
	 * @param bytes - the file's bytes
	 */
	static parseBytesResult(bytes: Uint8Array): Result.Result<Readonly<Record<string, string>>, ShellExportsError> {
		return run(bytes);
	}

	/**
	 * {@link ShellExports.parseResult} as an `Effect`, with a span.
	 *
	 * @param text - the file's text
	 */
	static readonly parse = Effect.fn("ShellExports.parse")((text: string) =>
		Effect.fromResult(ShellExports.parseResult(text)),
	);

	/**
	 * Write `vars` as `export NAME=value` lines in the dialect, one per entry in record order, each value quoted so
	 * that {@link ShellExports.parseResult} and bash read it back exactly.
	 *
	 * @remarks
	 * A value of only `A-Za-z0-9_@%+=:,./-` is written bare; one holding a control character or DEL as `$'…'`, with
	 * the control characters as escapes; any other as `'…'`, with `'` as `'\''`. Every line ends in `\n`.
	 *
	 * @param vars - variable name to value
	 * @throws RangeError for a name that is not a shell variable name (`[A-Za-z_][A-Za-z0-9_]*`) or is one bash treats
	 *   specially, or a value holding NUL or a lone UTF-16 surrogate: a caller's mistake, since the dialect cannot
	 *   export any of them.
	 */
	static format(vars: Readonly<Record<string, string>>): string {
		let out = "";
		for (const [name, value] of Object.entries(vars)) {
			if (!NAME.test(name)) throw new RangeError(`ShellExports.format: "${name}" is not a shell variable name`);
			if (isSpecial(name)) throw new RangeError(`ShellExports.format: "${name}" is a variable bash treats specially`);
			if (value.includes("\0")) throw new RangeError(`ShellExports.format: the value of "${name}" holds NUL`);
			if (LONE_SURROGATE.test(value))
				throw new RangeError(`ShellExports.format: the value of "${name}" holds a lone surrogate`);
			out += `export ${name}=${quote(value)}\n`;
		}
		return out;
	}
}

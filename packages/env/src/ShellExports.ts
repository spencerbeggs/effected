import { Effect, Result, Schema } from "effect";

/**
 * Why {@link ShellExports.parseResult} rejected a text.
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
 *   newline inside quotes), a `$'…'` byte escape that is not UTF-8 or is NUL, a `\u`/`\U` escape (its bytes depend
 *   on the locale), an escape bash does not define, or a lone UTF-16 surrogate.
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
	/** The 1-based column of the offending character, in UTF-16 code units from the line start. */
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
const isOctal = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "7";
const isHex = (ch: string | undefined): boolean => ch !== undefined && /[0-9A-Fa-f]/.test(ch);
// Name characters by code, so the statement loop tests no regex per character.
const isNameChar = (code: number): boolean =>
	(code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f;

const decoder = new TextDecoder("utf-8", { fatal: true });

/** The one-character `$'…'` escapes, as bytes. */
const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
	a: 0x07,
	b: 0x08,
	e: 0x1b,
	E: 0x1b,
	f: 0x0c,
	n: 0x0a,
	r: 0x0d,
	t: 0x09,
	v: 0x0b,
	"\\": 0x5c,
	"'": 0x27,
	'"': 0x22,
	"?": 0x3f,
};

/** Appends the UTF-8 bytes of one code point; the text is known to hold no lone surrogate. */
const pushUtf8 = (bytes: Array<number>, cp: number): void => {
	if (cp < 0x80) bytes.push(cp);
	else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
	else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
	else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
};

/** A rejection at an index; the caller turns it into a line and column. */
class Reject {
	constructor(
		readonly reason: ShellExportsErrorReason,
		readonly at: number,
	) {}
}

/** The single linear pass: every character is visited a bounded number of times, and nothing is copied per line. */
const tokenize = (text: string): Readonly<Record<string, string>> => {
	const surrogate = LONE_SURROGATE.exec(text);
	if (surrogate !== null) throw new Reject("invalid-encoding", surrogate.index);
	const vars: Record<string, string> = Object.create(null);
	const n = text.length;
	let i = 0;
	let lineStart = true;

	/** A raw character inside quotes: tab and newline are allowed, any other control is not. */
	const quotedChar = (at: number): void => {
		const code = text.charCodeAt(at);
		if (isControl(code) && code !== 0x09 && code !== 0x0a) throw new Reject("invalid-encoding", at);
	};

	/** `$'…'` from just past `$'`; returns the decoded content and leaves `i` past the closing quote. */
	const ansiC = (): string => {
		const bytes: Array<number> = [];
		for (;;) {
			if (i >= n) throw new Reject("unterminated-quote", i);
			const c = text[i] as string;
			if (c === "'") {
				i++;
				break;
			}
			if (c !== "\\") {
				quotedChar(i);
				pushUtf8(bytes, text.codePointAt(i) as number);
				i += (text.codePointAt(i) as number) > 0xffff ? 2 : 1;
				continue;
			}
			const escapeAt = i;
			const e = text[i + 1];
			if (e === undefined) throw new Reject("unterminated-quote", i);
			i += 2;
			const simple = SIMPLE_ESCAPES[e];
			let byte: number;
			if (simple !== undefined) {
				byte = simple;
			} else if (isOctal(e)) {
				const from = i - 1;
				while (i - from < 3 && isOctal(text[i])) i++;
				byte = Number.parseInt(text.slice(from, i), 8) & 0xff;
			} else if (e === "x") {
				const from = i;
				while (i - from < 2 && isHex(text[i])) i++;
				if (i === from) throw new Reject("invalid-encoding", escapeAt);
				byte = Number.parseInt(text.slice(from, i), 16);
			} else if (e === "c") {
				const target = text[i];
				if (target === undefined || !/[A-Za-z@[\]^_?]/.test(target)) throw new Reject("invalid-encoding", escapeAt);
				i++;
				byte = target === "?" ? 0x7f : target.toUpperCase().charCodeAt(0) & 0x1f;
			} else {
				// \u and \U spell a code point whose bytes depend on the locale; anything else is no escape bash defines.
				throw new Reject("invalid-encoding", escapeAt);
			}
			// A bash string cannot hold NUL: bash would cut the value short here.
			if (byte === 0) throw new Reject("invalid-encoding", escapeAt);
			bytes.push(byte);
		}
		try {
			return decoder.decode(new Uint8Array(bytes));
		} catch {
			throw new Reject("invalid-encoding", i - 1);
		}
	};

	/** One WORD from `i`, up to an unquoted blank, newline, `;` or the end. */
	const word = (): string => {
		const start = i;
		let out = "";
		for (;;) {
			if (i >= n) return out;
			const c = text[i] as string;
			if (c === " " || c === "\t" || c === "\n" || c === ";") return out;
			if (c === "'") {
				const close = text.indexOf("'", i + 1);
				if (close === -1) throw new Reject("unterminated-quote", i);
				for (let k = i + 1; k < close; k++) quotedChar(k);
				out += text.slice(i + 1, close);
				i = close + 1;
			} else if (c === '"') {
				i++;
				for (;;) {
					if (i >= n) throw new Reject("unterminated-quote", i);
					const q = text[i] as string;
					if (q === '"') {
						i++;
						break;
					}
					if (q === "$" || q === "`") throw new Reject("expansion", i);
					if (q === "\\") {
						const next = text[i + 1];
						if (next === undefined) throw new Reject("unterminated-quote", i);
						if (next === '"' || next === "\\") {
							out += next;
							i += 2;
							continue;
						}
						// `\$` and a backslash-backtick hold the characters the dialect keeps out of quotes; `\`-newline
						// is a continuation.
						if (next === "$" || next === "`") throw new Reject("expansion", i + 1);
						if (next === "\n") throw new Reject("unsupported-statement", i);
						out += "\\";
						i++;
						continue;
					}
					quotedChar(i);
					out += q;
					i++;
				}
			} else if (c === "$") {
				if (text[i + 1] !== "'") throw new Reject("expansion", i);
				i += 2;
				out += ansiC();
			} else if (c === "\\") {
				const next = text[i + 1];
				if (next === undefined || next === "\n") throw new Reject("unsupported-statement", i);
				if (isControl(next.charCodeAt(0))) throw new Reject("invalid-encoding", i + 1);
				const s = String.fromCodePoint(text.codePointAt(i + 1) as number);
				out += s;
				i += 1 + s.length;
			} else if ("`{}*?[]".includes(c)) {
				throw new Reject("expansion", i);
			} else if (c === "~" && (i === start || text[i - 1] === ":" || text[i - 1] === "=")) {
				// A tilde expands at the start of an assignment's value and after `:` or `=` in it; elsewhere it is literal.
				throw new Reject("expansion", i);
			} else if ("|&<>()".includes(c)) {
				throw new Reject("unsupported-statement", i);
			} else if (isControl(c.charCodeAt(0))) {
				throw new Reject("invalid-encoding", i);
			} else {
				out += c;
				i++;
			}
		}
	};

	while (i < n) {
		const c = text[i] as string;
		if (c === " " || c === "\t") {
			i++;
			continue;
		}
		if (c === "\n") {
			i++;
			lineStart = true;
			continue;
		}
		if (c === "#" && lineStart) {
			const nl = text.indexOf("\n", i);
			i = nl === -1 ? n : nl;
			continue;
		}
		// A statement: `export`, blanks, NAME, `=`, WORD, then blanks and a newline, `;` or the end.
		if (!text.startsWith("export", i) || (text[i + 6] !== " " && text[i + 6] !== "\t"))
			throw new Reject("unsupported-statement", i);
		i += 6;
		while (text[i] === " " || text[i] === "\t") i++;
		const nameStart = i;
		while (i < n && isNameChar(text.charCodeAt(i))) i++;
		const name = text.slice(nameStart, i);
		if (name === "") throw new Reject(text[i] === "$" ? "expansion" : "unsupported-statement", nameStart);
		if (!NAME.test(name)) throw new Reject("invalid-name", nameStart);
		// `NAME+=`, `NAME[…]=` and `export NAME` with no value all stop here.
		if (text[i] !== "=") throw new Reject("unsupported-statement", i);
		if (isSpecial(name)) throw new Reject("special-variable", nameStart);
		i++;
		const value = word();
		while (text[i] === " " || text[i] === "\t") i++;
		if (i < n && text[i] !== "\n" && text[i] !== ";") throw new Reject("unsupported-statement", i);
		if (text[i] === ";") i++;
		vars[name] = value;
		lineStart = false;
	}
	return vars;
};

/** The 1-based line and column of index `at`. Called once, on rejection. */
const position = (text: string, at: number): { readonly line: number; readonly column: number } => {
	let line = 1;
	let lineStart = 0;
	for (let k = text.indexOf("\n"); k !== -1 && k < at; k = text.indexOf("\n", k + 1)) {
		line++;
		lineStart = k + 1;
	}
	return { line, column: at - lineStart + 1 };
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
		try {
			return Result.succeed(tokenize(text));
		} catch (error) {
			if (!(error instanceof Reject)) throw error;
			return Result.fail(new ShellExportsError({ ...position(text, error.at), reason: error.reason }));
		}
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

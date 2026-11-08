// The nesting-aware skip scanner: given the offset just past an opener
// (`$(`, `<(`, `>(`, `${`, a backtick, `$((`, `((`, `$[`, a subscript `[`),
// find the offset just
// past its closer. Bodies are opaque to the lexer, but finding where one ends
// needs quotes, escapes, nested substitutions, comments, heredocs and
// arithmetic understood. Depth is held on an explicit frame stack, never the
// call stack, so a megabyte of `$(` is one linear pass.

import { decodeAnsiC } from "./ansiC.js";
import { consumeHeredocBodies, readHeredocDelimiter } from "./heredoc.js";
import type { RawSpan, RawSubstitution } from "./raw.js";
import { skipContinuations } from "./raw.js";

/** A `$(`, `<(` or `>(` body: ends at `)`. @internal */
export const SUBST = 0;
/** A bare `(` inside a body: ends at `)`. */
const GROUP = 1;
/** A `${` body: ends at `}`. @internal */
export const BRACE = 2;
const DQUOTE = 3;
const SQUOTE = 4;
const ANSIC = 5;
/** A backtick body: ends at the first unescaped backtick. @internal */
export const BACKTICK = 6;
/**
 * A `$((` body: arithmetic, ending at `))`. A `)` that closes the second
 * parenthesis without a `)` right after it means the text was `$( (…) …)`, a
 * command substitution holding a subshell, and the frame becomes `SUBST`.
 *
 * @internal
 */
export const ARITH_SUBST = 7;
/**
 * A `((` arithmetic command: ends at `))`. The same `)` rule demotes it to
 * two groups; as a scan root it stops there and reports `demoted`.
 *
 * @internal
 */
export const ARITH_GROUP = 8;
/** A bare `(` inside arithmetic: ends at `)`. */
const ARITH_PAREN = 9;
/**
 * A bracket span read as a matched pair: the legacy arithmetic expansion
 * `$[…]`, or the subscript of a `NAME[…]` word. Ends at the matching `]`; a
 * `[` inside nests. Like bash's matched-pair reader it honours quotes,
 * escapes and substitutions, and nothing else: `<<` is a shift, not a
 * heredoc, `#` is no comment, `(` and `)` are plain characters, and a
 * newline is part of the span.
 *
 * @internal
 */
export const ARITH_BRACKET = 10;
/**
 * A `'…'` run opened inside an expansion context: a `${…}` body, arithmetic
 * (`$((…))`, `((…))`, `$[…]`) or a bracket subscript. It ends at the next
 * `'`, like `SQUOTE`, because bash honours the quote while it looks for the
 * closer. What it holds is another matter: inside `"${x:-'…'}"`, a heredoc's
 * `${…}`, any arithmetic and an indexed array's subscript, bash keeps the
 * quote characters and still expands the text between them, so
 * `echo "${x:-'$(cmd)'}"` runs `cmd`. Whether it does depends on the quoting
 * around the `${`, on the operator (`${x//a/'$(cmd)'}` runs nothing) and on
 * whether the array is associative, none of which a skip scan can know.
 * Nor can it know what the run joins: bash removes the quotes and reads the
 * text again, so a `$` in the run opens a substitution with whatever follows
 * it, the next run included (`x=(['$'(cmd)]=1)` runs `cmd`). So a run
 * holding any `$` or backtick (`holdsDollarOrBacktick`) is recorded in
 * `NestedScan.quoted`, which the lexer reports as
 * `QuotedSubstitutionInExpansion`: fail closed, never skipped. The same goes
 * for every other way a `$` or backtick reaches such a frame quoted: a
 * `"…"` run directly inside it holding a literal `$` (`"$"`, `"a$"`, but not
 * the `$` of `"$HOME"`) or an escaped `\$` or `` \` ``, and an escaped `\$` or
 * `` \` `` in the frame itself (`x=([\$\(cmd\)]=1)`, `"${x:-"$"(cmd)}"` both
 * run `cmd`), and a bare `$` before an escaped `(` or backtick, which
 * removing the backslash turns into `$(` (`x=([$\(cmd\)]=1)` runs `cmd`).
 * A substitution part is not placed for it, because bash reads the run
 * twice, once as a quote to match the closer and once as expansion text, and
 * the two readings need not agree on where a `$(…)` ends.
 *
 * Honouring the quote to find the closer is bash's default mode only. In
 * POSIX mode (`set -o posix`, or an inherited `POSIXLY_CORRECT`) a `'` inside
 * a double-quoted `${…}` is an ordinary character, so `}` in
 * `echo "${x:-'}"; cmd; echo "'}"` closes the expansion early and `cmd` runs,
 * where the default mode runs nothing. The two readings differ only when the
 * POSIX reading of the run's text is unbalanced (`posixReadingDiffers`): a
 * `}` or `]` it takes as a closer, or a `"`, `${` or `$[` left open. Such a run
 * inside an expansion frame that sits in double quotes (or a heredoc body,
 * which over-reports, since a heredoc body ends at its delimiter line in
 * either mode) is recorded in `NestedScan.closers`, which the lexer reports
 * as `QuotedCloserInExpansion`. A run holding a `$(` or a backtick is already
 * in `quoted`. Arithmetic and unquoted `${…}` honour the quote in both modes
 * (checked under bash 5.3), but a frame inherits double quotes from the `"`
 * around it, so a run in `"$(( ${x:-'}'} ))"` is still reported.
 */
const EXPANSION_SQUOTE = 11;
/**
 * A `$'…'` run opened inside an expansion context: see `EXPANSION_SQUOTE`.
 * bash decodes its escapes first and expands the decoded text, so
 * `echo "${x:-$'\x24(cmd)'}"` runs `cmd`, and a decoded `$` or `(` joins the
 * text beside it, inside the run (`$'$\x28cmd)'`) or after it
 * (`$'\x24'(cmd)`, `$'$'(cmd)`, `$'$'"(cmd)"`). Such a run is checked raw
 * and decoded (`ansiCRunHoldsOpener`): a `$` or a backtick anywhere in its
 * decoded text records it, whatever follows. A `'…'` run is never decoded
 * (`"${x:-'\x24(cmd)'}"` runs nothing).
 */
const EXPANSION_ANSIC = 12;

/** Whether `kind` is a frame inside which a quoted run is still expanded. */
const expandsQuotes = (kind: number): boolean =>
	kind === BRACE || kind === ARITH_SUBST || kind === ARITH_GROUP || kind === ARITH_PAREN || kind === ARITH_BRACKET;

/**
 * Whether `source[from, to)` holds a `$` or a backtick at all. Inside a frame
 * bash reads again after quote removal, a quoted or escaped `$` joins
 * whatever follows it, the next run included, so any one of them may open a
 * substitution. One pass, no lookahead past `to`.
 *
 * @internal
 */
export const holdsDollarOrBacktick = (source: string, from: number, to: number): boolean => {
	for (let i = from; i < to; i += 1) {
		const c = source[i];
		if (c === "$" || c === "`") return true;
	}
	return false;
};

/**
 * Whether the body `source[from, to)` of a `$'…'` run, as bash expands it,
 * may open a command substitution: its decoded text holds a `$` or a
 * backtick anywhere. A `$` may open one with what follows it, inside the run
 * or after its closing quote, and a decoded `(` opens nothing without a `$`
 * before it, which this check or the neighbouring run's catches. One decode,
 * bounded by the run.
 *
 * @internal
 */
export const ansiCRunHoldsOpener = (source: string, from: number, to: number): boolean => {
	const { value } = decodeAnsiC(source, from, to);
	return value.includes("$") || value.includes("`");
};

const isNameOrDigit = (c: string | undefined): boolean =>
	c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_");

/**
 * Whether the `$` at `at`, inside double quotes, is a literal character
 * rather than the start of an expansion: what follows it is no name, digit,
 * special parameter or `(`, `{`, `[` (`"$"`, `"a$ b"`, `"$'"`). The caller
 * steps over `$$` itself, so `$` is not in the special set.
 */
const isLiteralDollar = (source: string, at: number, limit: number): boolean => {
	const next = skipContinuations(source, at + 1, limit);
	const c = next < limit ? source[next] : undefined;
	return c === undefined || !(isNameOrDigit(c) || "@*#?!-({[".includes(c));
};

/**
 * Whether POSIX-mode bash, which takes a `'` inside a double-quoted expansion
 * for an ordinary character, reads the run text `source[from, to)` as anything
 * other than balanced: a `}` or `]` it would take as the enclosing closer, or
 * a `"`, `${` or `$[` still open at `to`. A balanced text (`'${y:-v}'`,
 * `'""'`, `'\}'`) leaves both readings on the same closer. One pass, its
 * stack bounded by the run, no lookahead past `to`.
 *
 * @internal
 */
export const posixReadingDiffers = (source: string, from: number, to: number): boolean => {
	// The closers the POSIX reading is waiting for, innermost last.
	const open: Array<string> = [];
	for (let i = from; i < to; i += 1) {
		const c = source[i];
		const top = open[open.length - 1];
		if (c === "\\") i += 1;
		else if (c === '"') {
			if (top === '"') open.pop();
			else open.push('"');
		} else if (c === "}" || c === "]") {
			if (top === c) open.pop();
			else if (top !== '"') return true;
		} else if (c === "$") {
			const next = skipContinuations(source, i + 1, to);
			if (next < to && (source[next] === "{" || source[next] === "[")) {
				open.push(source[next] === "{" ? "}" : "]");
				i = next;
			}
		}
	}
	return open.length > 0;
};

/** @internal */
export type NestedRoot =
	| typeof SUBST
	| typeof BRACE
	| typeof BACKTICK
	| typeof ARITH_SUBST
	| typeof ARITH_GROUP
	| typeof ARITH_BRACKET;

/** @internal */
export interface NestedScan {
	/** Offset just past the closer, or `limit` when unterminated. */
	readonly end: number;
	readonly terminated: boolean;
	/**
	 * For an arithmetic root: whether it is still arithmetic (closed by `))`
	 * or `]`, or unterminated without demotion).
	 */
	readonly arithmetic: boolean;
	/**
	 * For an `ARITH_GROUP` root: whether a `)` closed its second parenthesis
	 * with no `)` after it, so `((` was two subshells. The scan stops there,
	 * `end` just past that `)`, and `terminated` is `false`.
	 */
	readonly demoted: boolean;
	/**
	 * The command and process substitutions directly inside the body (not
	 * inside another substitution), with absolute offsets. Only complete ones
	 * are listed.
	 */
	readonly substitutions: ReadonlyArray<RawSubstitution>;
	/**
	 * The quoted spans directly inside an expansion context of the body (not
	 * inside another substitution) through which a `$` or a backtick reaches
	 * it: a `'…'`, `$'…'` or `"…"` run, quote characters included, or a
	 * two-character `\$` or `` \` `` escape. Empty for a `SUBST` or `BACKTICK` root, whose
	 * body a caller parses again, and for an arithmetic root that turned out
	 * to be a substitution or two subshells.
	 */
	readonly quoted: ReadonlyArray<RawSpan>;
	/**
	 * The `'…'` and `$'…'` runs, kept on the same terms as `quoted`, inside an
	 * expansion frame that sits in double quotes, whose text POSIX-mode bash
	 * would read as syntax (see `EXPANSION_SQUOTE`).
	 */
	readonly closers: ReadonlyArray<RawSpan>;
}

/**
 * The text bash runs for a backtick body `source[from, to)`: a backslash
 * before `$`, a backtick or a backslash is removed, and inside double quotes
 * so is one before `"`. Every other backslash stays.
 *
 * @internal
 */
export const backtickBody = (source: string, from: number, to: number, inDoubleQuotes: boolean): string => {
	let out = "";
	let run = from;
	let i = from;
	while (i < to) {
		if (source[i] !== "\\" || i + 1 >= to) {
			i += 1;
			continue;
		}
		const next = source[i + 1];
		if (next === "$" || next === "`" || next === "\\" || (inDoubleQuotes && next === '"')) {
			out += source.slice(run, i) + next;
			i += 2;
			run = i;
		} else {
			i += 2;
		}
	}
	return out + source.slice(run, to);
};

const isNameStart = (c: string | undefined): boolean =>
	c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_");

const isNameChar = (c: string | undefined): boolean => isNameStart(c) || (c !== undefined && c >= "0" && c <= "9");

/**
 * Whether `i` starts a word of command text: the comment rule's word start. A
 * backslash-newline before `i` is not there as far as bash is concerned, so
 * `a\⏎#b` is one word, while the newline of `\\⏎` is a real one.
 */
const isCommentStart = (source: string, i: number, bodyStart: number): boolean => {
	let at = i;
	for (;;) {
		if (at === bodyStart) return true;
		if (source[at - 1] !== "\n") break;
		let backslashes = 0;
		for (let k = at - 2; k >= bodyStart && source[k] === "\\"; k -= 1) backslashes += 1;
		if (backslashes % 2 === 0) return true;
		at -= 2;
	}
	const prev = source[at - 1];
	return prev === " " || prev === "\t" || prev === ";" || prev === "&" || prev === "|" || prev === "(" || prev === ")";
};

type Opening =
	| { readonly kind: "commandSubstitution"; readonly style: "dollar" | "backtick"; readonly inDoubleQuotes: boolean }
	| { readonly kind: "processSubstitution"; readonly direction: "<" | ">" };

interface Entry {
	readonly opening: Opening;
	readonly start: number;
	readonly bodyStart: number;
	end: number;
	/** An `ARITH_SUBST` entry that closed as arithmetic: not a substitution. */
	arithmetic: boolean;
}

/**
 * Scan from `start` (just past the opener) to the matching closer.
 *
 * @remarks
 * Inside a `$(…)` body: single, double and ANSI-C quotes, backslash escapes,
 * nested `$(`, `${`, `$((`, `((`, `<(`, `>(`, backticks and bare
 * parentheses, `#` comments at a word start, and heredocs (`<<` / `<<-`,
 * whose bodies are skipped at the next newline so an apostrophe or a `)`
 * inside one closes nothing). Inside `${…}`: quotes, escapes and nested
 * substitutions; a lone `{` does not nest. Inside a backtick body: only
 * backslash escapes, since the first unescaped backtick closes it. Inside
 * arithmetic: quotes, escapes, substitutions and parentheses, but no heredoc
 * and no comment, so `1 << 2` is a shift. A `$[…]` and the subscript of a word
 * that starts `NAME[` are bracket spans (`ARITH_BRACKET`), read the same way
 * and closed by the matching `]`. bash reads such a subscript as a matched
 * pair only in command position; this scanner does not track command
 * position, so it reads one at every word start. That only ever stops a `<<`
 * from opening a heredoc, which over-reports the lines after it, never hides
 * them. A `case` pattern's `)` inside a body closes it early; that is a known
 * limit of skipping rather than parsing.
 *
 * `inDoubleQuotes` says whether the root opener sat inside double quotes or a
 * heredoc body, which only an expansion root (`${`, arithmetic) can.
 *
 * @internal
 */
export const scanNested = (
	source: string,
	start: number,
	limit: number,
	root: NestedRoot,
	inDoubleQuotes = false,
): NestedScan => {
	const kinds: Array<number> = [root];
	// Where each frame's opener starts, and where its body starts.
	const starts: Array<number> = [start];
	const opens: Array<number> = [start];
	// Index into `entries` a frame records into, or -1.
	const records: Array<number> = [-1];
	// Whether the frame raised `substDepth` (only real substitution frames do).
	const counted: Array<boolean> = [false];
	// Whether the frame sits in double quotes: a `"` frame does, command text
	// does not, and an expansion or quoted-run frame inherits it.
	const quotedContext: Array<boolean> = [inDoubleQuotes && root !== SUBST && root !== BACKTICK];
	// For a `"…"` frame directly inside an expansion frame: 1 once it has met a
	// literal `$`, an escaped `$` or an escaped backtick, 0 until then. -1 for
	// every other frame.
	const literals: Array<number> = [-1];
	const entries: Array<Entry> = [];
	const quoted: Array<RawSpan> = [];
	const closers: Array<RawSpan> = [];
	// A substitution root's body is parsed again by the caller, who sees its
	// quoted runs there.
	const recordsQuoted = root !== SUBST && root !== BACKTICK;
	let substDepth = 0;
	let rootArithmetic = root === ARITH_SUBST || root === ARITH_GROUP || root === ARITH_BRACKET;
	let pending: Array<{ readonly delimiter: string; readonly stripTabs: boolean; readonly quoted: boolean }> = [];
	let i = start;

	const push = (kind: number, at: number, opener: number, opening?: Opening): void => {
		let record = -1;
		let raises = false;
		if (opening !== undefined) {
			if (substDepth === 0) {
				record = entries.length;
				entries.push({ opening, start: at, bodyStart: at + opener, end: -1, arithmetic: false });
			}
			// An arithmetic frame is not a substitution: what is inside it is
			// listed at this level, so a `$(cmd)` inside `$((…))` is never lost.
			if (kind !== ARITH_SUBST) {
				substDepth += 1;
				raises = true;
			}
		}
		const inherits = quotedContext[quotedContext.length - 1] as boolean;
		literals.push(kind === DQUOTE && expandsQuotes(kinds[kinds.length - 1] as number) ? 0 : -1);
		kinds.push(kind);
		starts.push(at);
		opens.push(at + opener);
		records.push(record);
		counted.push(raises);
		quotedContext.push(
			kind === DQUOTE ? true : kind === SUBST || kind === GROUP || kind === BACKTICK ? false : inherits,
		);
	};

	// Pop the top frame, whose closer ends at `closerEnd`. Returns true when
	// the root itself closed.
	const pop = (closerEnd: number): boolean => {
		const kind = kinds.pop() as number;
		starts.pop();
		opens.pop();
		const record = records.pop() as number;
		const raised = counted.pop() as boolean;
		quotedContext.pop();
		literals.pop();
		if (kinds.length === 0) return true;
		if (raised) substDepth -= 1;
		const entry = record === -1 ? undefined : entries[record];
		if (entry !== undefined) {
			entry.end = closerEnd;
			if (kind === ARITH_SUBST) entry.arithmetic = true;
		}
		return false;
	};

	// A `'` at `i`: an ordinary single quote, or one bash expands inside.
	const singleQuote = (): void => {
		push(expandsQuotes(kinds[kinds.length - 1] as number) ? EXPANSION_SQUOTE : SQUOTE, i, 1);
		i += 1;
	};

	// The quoted run on top of the stack closed just before `end`.
	const closeQuotedRun = (end: number): void => {
		const at = kinds.length - 1;
		if (!recordsQuoted || substDepth !== 0) return;
		const from = opens[at] as number;
		if (
			holdsDollarOrBacktick(source, from, end - 1) ||
			(kinds[at] === EXPANSION_ANSIC && ansiCRunHoldsOpener(source, from, end - 1))
		) {
			quoted.push({ start: starts[at] as number, end });
		}
		if (quotedContext[at] === true && posixReadingDiffers(source, from, end - 1)) {
			closers.push({ start: starts[at] as number, end });
		}
	};

	// A `\` at `i` in an expansion frame: an escaped `$` or backtick reaches
	// the text bash reads again, so it is recorded like a quoted one.
	const escapeInExpansion = (): void => {
		const next = source[i + 1];
		if (recordsQuoted && substDepth === 0 && (next === "$" || next === "`")) quoted.push({ start: i, end: i + 2 });
		i += 2;
	};

	// A literal or escaped `$`, or an escaped backtick, inside the `"…"` frame
	// on top of the stack.
	const literalInDoubleQuotes = (): void => {
		const at = literals.length - 1;
		if (literals[at] === 0) literals[at] = 1;
	};

	// The `"…"` frame on top of the stack closed just before `end`.
	const closeDoubleQuotedRun = (end: number): void => {
		const at = kinds.length - 1;
		if (literals[at] === 1 && recordsQuoted && substDepth === 0) quoted.push({ start: starts[at] as number, end });
	};

	// `$` inside a body: open whatever it introduces.
	const dollar = (allowAnsiC: boolean, inDoubleQuotes: boolean): void => {
		const open = skipContinuations(source, i + 1, limit);
		const next = open < limit ? source[open] : undefined;
		const opener = open + 1 - i;
		if (next === "(") {
			const inner = skipContinuations(source, open + 1, limit);
			if (inner < limit && source[inner] === "(") {
				push(ARITH_SUBST, i, opener, { kind: "commandSubstitution", style: "dollar", inDoubleQuotes });
				i = inner + 1;
			} else {
				push(SUBST, i, opener, { kind: "commandSubstitution", style: "dollar", inDoubleQuotes });
				i = open + 1;
			}
		} else if (next === "{") {
			push(BRACE, i, opener);
			i = open + 1;
		} else if (next === "[") {
			// Legacy arithmetic: not a substitution, so what is inside it is
			// listed at this level.
			push(ARITH_BRACKET, i, opener);
			i = open + 1;
		} else if (next === "'" && allowAnsiC) {
			push(expandsQuotes(kinds[kinds.length - 1] as number) ? EXPANSION_ANSIC : ANSIC, i, opener);
			i = open + 1;
		} else {
			// A bare `$` before an escaped `(` in a frame bash reads again:
			// removing the backslash leaves `$(`, so `x=([$\(cmd\)]=1)` runs
			// `cmd`. Recorded like a quoted `$`, on the same terms as the other
			// recorders. An escaped backtick after it is recorded by
			// `escapeInExpansion`.
			if (
				next === "\\" &&
				open + 1 < limit &&
				source[open + 1] === "(" &&
				expandsQuotes(kinds[kinds.length - 1] as number) &&
				recordsQuoted &&
				substDepth === 0
			) {
				quoted.push({ start: i, end: open + 2 });
			}
			i += 1;
		}
	};

	const backtick = (inDoubleQuotes: boolean): void => {
		push(BACKTICK, i, 1, { kind: "commandSubstitution", style: "backtick", inDoubleQuotes });
		i += 1;
	};

	// `<(` or `>(` at `i`: a process substitution. Returns whether it opened one.
	const process = (): boolean => {
		const c = source[i];
		if (c !== "<" && c !== ">") return false;
		const open = skipContinuations(source, i + 1, limit);
		if (open >= limit || source[open] !== "(") return false;
		push(SUBST, i, open + 1 - i, { kind: "processSubstitution", direction: c });
		i = open + 1;
		return true;
	};

	while (i < limit) {
		const top = kinds[kinds.length - 1] as number;
		const c = source[i] as string;
		if (top === SQUOTE || top === EXPANSION_SQUOTE) {
			const close = source.indexOf("'", i);
			if (close === -1 || close >= limit) {
				i = limit;
				break;
			}
			i = close + 1;
			if (top === EXPANSION_SQUOTE) closeQuotedRun(i);
			pop(i);
			continue;
		}
		if (top === ANSIC || top === EXPANSION_ANSIC) {
			if (c === "\\") i += 2;
			else if (c === "'") {
				i += 1;
				if (top === EXPANSION_ANSIC) closeQuotedRun(i);
				pop(i);
			} else i += 1;
			continue;
		}
		if (top === BACKTICK) {
			if (c === "\\") i += 2;
			else if (c === "`") {
				i += 1;
				if (pop(i)) return finish(i, true, false);
			} else i += 1;
			continue;
		}
		if (top === DQUOTE) {
			if (c === "\\") {
				const next = source[i + 1];
				if (next === "$" || next === "`") literalInDoubleQuotes();
				i += 2;
			} else if (c === '"') {
				i += 1;
				closeDoubleQuotedRun(i);
				pop(i);
			} else if (c === "$") {
				const next = skipContinuations(source, i + 1, limit);
				// `$$` is the special parameter, not a literal `$` and then another.
				if (next < limit && source[next] === "$") i = next + 1;
				else {
					if (isLiteralDollar(source, i, limit)) literalInDoubleQuotes();
					dollar(false, true);
				}
			} else if (c === "`") backtick(true);
			else i += 1;
			continue;
		}
		if (top === BRACE) {
			if (c === "\\") escapeInExpansion();
			else if (c === "}") {
				i += 1;
				if (pop(i)) return finish(i, true, false);
			} else if (c === "'") singleQuote();
			else if (c === '"') {
				push(DQUOTE, i, 1);
				i += 1;
			} else if (c === "$") dollar(true, false);
			else if (c === "`") backtick(false);
			else if (!process()) i += 1;
			continue;
		}
		if (top === ARITH_BRACKET) {
			switch (c) {
				case "\\":
					escapeInExpansion();
					break;
				case "'":
					singleQuote();
					break;
				case '"':
					push(DQUOTE, i, 1);
					i += 1;
					break;
				case "`":
					backtick(false);
					break;
				case "$":
					dollar(true, false);
					break;
				case "[":
					push(ARITH_BRACKET, i, 1);
					i += 1;
					break;
				case "]":
					i += 1;
					if (pop(i)) return finish(i, true, false);
					break;
				default:
					i += 1;
			}
			continue;
		}
		if (top === ARITH_SUBST || top === ARITH_GROUP || top === ARITH_PAREN) {
			switch (c) {
				case "\\":
					escapeInExpansion();
					break;
				case "'":
					singleQuote();
					break;
				case '"':
					push(DQUOTE, i, 1);
					i += 1;
					break;
				case "`":
					backtick(false);
					break;
				case "$":
					dollar(true, false);
					break;
				case "(":
					push(ARITH_PAREN, i, 1);
					i += 1;
					break;
				case ")":
					if (top === ARITH_PAREN) {
						i += 1;
						pop(i);
					} else if (i + 1 < limit && source[i + 1] === ")") {
						i += 2;
						if (pop(i)) return finish(i, true, false);
					} else if (kinds.length === 1 && top === ARITH_GROUP) {
						return finish(i + 1, false, true);
					} else {
						// `$( (…) …)` or `( (…) …)`: the `)` closed the inner parenthesis.
						kinds[kinds.length - 1] = top === ARITH_SUBST ? SUBST : GROUP;
						quotedContext[quotedContext.length - 1] = false;
						if (kinds.length === 1) rootArithmetic = false;
						i += 1;
					}
					break;
				default:
					i += 1;
			}
			continue;
		}
		// SUBST or GROUP: shell command text.
		switch (c) {
			case ")":
				i += 1;
				if (pop(i)) return finish(i, true, false);
				break;
			case "(": {
				const second = skipContinuations(source, i + 1, limit);
				if (second < limit && source[second] === "(") {
					push(ARITH_GROUP, i, second + 1 - i);
					i = second + 1;
				} else {
					push(GROUP, i, 1);
					i += 1;
				}
				break;
			}
			case "'":
				push(SQUOTE, i, 1);
				i += 1;
				break;
			case '"':
				push(DQUOTE, i, 1);
				i += 1;
				break;
			case "`":
				backtick(false);
				break;
			case "\\":
				i += 2;
				break;
			case "$":
				dollar(true, false);
				break;
			case "#":
				if (isCommentStart(source, i, opens[opens.length - 1] as number)) {
					const newline = source.indexOf("\n", i);
					i = newline === -1 || newline >= limit ? limit : newline;
				} else i += 1;
				break;
			case ">":
				if (!process()) i += 1;
				break;
			case "<": {
				if (process()) break;
				const second = skipContinuations(source, i + 1, limit);
				if (second >= limit || source[second] !== "<") {
					i += 1;
					break;
				}
				const third = skipContinuations(source, second + 1, limit);
				if (third < limit && source[third] === "<") {
					i = third + 1;
					break;
				}
				const stripTabs = third < limit && source[third] === "-";
				let j = stripTabs ? third + 1 : third;
				for (;;) {
					if (j < limit && (source[j] === " " || source[j] === "\t")) j += 1;
					else if (j + 1 < limit && source[j] === "\\" && source[j + 1] === "\n") j += 2;
					else break;
				}
				const word = readHeredocDelimiter(source, j, limit);
				// No word, or one whose delimiter cannot be known: read no body.
				if (word === undefined || word.opaque) {
					i = j;
					break;
				}
				pending.push({ delimiter: word.delimiter, stripTabs, quoted: word.quoted });
				i = word.end;
				break;
			}
			case "\n":
				i += 1;
				if (pending.length > 0) {
					i = consumeHeredocBodies(source, i, limit, pending).next;
					pending = [];
				}
				break;
			default:
				if (isNameStart(c) && isCommentStart(source, i, opens[opens.length - 1] as number)) {
					// A word starting `NAME[`: read its subscript as a bracket
					// span, so a `<<` inside it opens no heredoc. Name characters
					// are not special here, so skipping the name is safe.
					let j = skipContinuations(source, i + 1, limit);
					while (j < limit && isNameChar(source[j])) j = skipContinuations(source, j + 1, limit);
					if (j < limit && source[j] === "[") {
						push(ARITH_BRACKET, j, 1);
						i = j + 1;
					} else i = j;
				} else i += 1;
		}
	}
	return finish(limit, false, false);

	function finish(end: number, terminated: boolean, demoted: boolean): NestedScan {
		const complete: Array<RawSubstitution> = [];
		for (const entry of entries) {
			if (entry.end === -1 || entry.arithmetic) continue;
			const bodyEnd = entry.end - 1;
			const opening = entry.opening;
			if (opening.kind === "processSubstitution") {
				complete.push({
					kind: "processSubstitution",
					direction: opening.direction,
					start: entry.start,
					end: entry.end,
					bodyStart: entry.bodyStart,
					bodyEnd,
				});
			} else {
				complete.push({
					kind: "commandSubstitution",
					style: opening.style,
					start: entry.start,
					end: entry.end,
					bodyStart: entry.bodyStart,
					bodyEnd,
					body:
						opening.style === "backtick"
							? backtickBody(source, entry.bodyStart, bodyEnd, opening.inDoubleQuotes)
							: source.slice(entry.bodyStart, bodyEnd),
				});
			}
		}
		// An arithmetic root that became a substitution or two subshells is
		// command text, where those quotes were real ones.
		const keepsQuoted = root === BRACE || (rootArithmetic && !demoted);
		return {
			end: Math.min(end, limit),
			terminated,
			arithmetic: rootArithmetic && !demoted,
			demoted,
			substitutions: complete,
			quoted: keepsQuoted ? quoted : [],
			closers: keepsQuoted ? closers : [],
		};
	}
};

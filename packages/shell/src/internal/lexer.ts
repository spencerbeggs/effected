// The shell-syntax engine: one forward scan over the source producing raw
// segment, word, redirection, heredoc, comment and diagnostic records.
//
// Contract: total. Nothing here throws on any input, nothing recurses on the
// input's nesting depth, and nothing is expanded or evaluated. Opaque bodies
// (`$(…)`, `${…}`, backticks, process substitutions) are skipped by the
// explicit-stack scanner in `nested.ts`. Every loop advances, so the scan is
// linear in the input length.

import { decodeAnsiC } from "./ansiC.js";
import { consumeHeredocBodies, endsWord, readHeredocDelimiter } from "./heredoc.js";
import { ARITH_BRACKET, ARITH_GROUP, ARITH_SUBST, BACKTICK, BRACE, SUBST, backtickBody, scanNested } from "./nested.js";
import type {
	RawCommandSubstitution,
	RawComment,
	RawDiagnostic,
	RawDiagnosticCode,
	RawExpansion,
	RawHeredoc,
	RawOperator,
	RawPart,
	RawRedirection,
	RawRedirectionOperator,
	RawScript,
	RawSegment,
	RawSubstitution,
	RawWord,
} from "./raw.js";
import { SHELL_RESERVED_WORDS, removeContinuations, skipContinuations } from "./raw.js";

/** Lexing a word in command position or as an argument. */
const NORMAL = 0;
/** Lexing the value of an assignment: no glob or brace expansion, tilde after `:`. */
const ASSIGNMENT_VALUE = 1;
type WordMode = typeof NORMAL | typeof ASSIGNMENT_VALUE;

const isNameStart = (c: string | undefined): boolean =>
	c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_");

const isNameChar = (c: string | undefined): boolean => isNameStart(c) || (c !== undefined && c >= "0" && c <= "9");

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

const isSpecialParameter = (c: string | undefined): boolean =>
	c === "*" || c === "@" || c === "#" || c === "?" || c === "-" || c === "$" || c === "!";

/**
 * The most diagnostics one parse records. Past it a single
 * `DiagnosticLimitReached` is added and the rest are dropped, so a megabyte
 * of `;;` costs one array of bounded size, while a script with any problem
 * still carries a diagnostic.
 */
const MAX_DIAGNOSTICS = 1000;

/**
 * Words that keep command position, from bash's `reserved_word_acceptable`.
 * `time` joins them here; `-p` and `--` after it are `FOLLOWS_TIME` states.
 */
const PRECEDES_ASSIGNMENT: ReadonlySet<string> = new Set<string>([...SHELL_RESERVED_WORDS, "time"]);

/** What the previous word of the segment means for the next one's position. */
const FOLLOWS_NOTHING = 0;
/** After `time`: `-p` and `--` keep command position (TIMEOPT, TIMEIGN). */
const FOLLOWS_TIME = 1;
/** After `time -p`: `--` keeps command position (TIMEIGN). */
const FOLLOWS_TIME_OPTION = 2;
/** After `function` or `coproc`: bash re-arms command position past the next word. */
const FOLLOWS_NAMER = 3;
/** After `for` or `select`: the next word is the name. */
const FOLLOWS_LOOP = 4;
/** After `for NAME` or `((…))`: a reserved word (`do`, `then`, `{`) re-arms command position. */
const FOLLOWS_CLOSED = 5;
/** Inside `[[ … ]]`: `]]` re-arms command position. */
const FOLLOWS_CONDITIONAL = 6;
type Follows =
	| typeof FOLLOWS_NOTHING
	| typeof FOLLOWS_TIME
	| typeof FOLLOWS_TIME_OPTION
	| typeof FOLLOWS_NAMER
	| typeof FOLLOWS_LOOP
	| typeof FOLLOWS_CLOSED
	| typeof FOLLOWS_CONDITIONAL;

/** A raw word's text when it is one bare, unescaped part, the only form of a reserved word. */
const keywordOf = (source: string, word: RawWord): string | undefined => {
	const [only, ...rest] = word.parts;
	if (only === undefined || rest.length > 0 || only.kind !== "bare") return undefined;
	return only.value === removeContinuations(source.slice(only.start, only.end)) ? only.value : undefined;
};

/** Push every command and process substitution directly inside `part`. */
const collectSubstitutions = (part: RawPart, out: Array<RawSubstitution>): void => {
	switch (part.kind) {
		case "commandSubstitution":
		case "processSubstitution":
			out.push(part);
			break;
		case "variable":
		case "arithmetic":
		case "brace":
		case "opaque":
			for (const inner of part.substitutions) out.push(inner);
			break;
		case "doubleQuoted":
			for (const expansion of part.expansions) {
				if (expansion.kind === "commandSubstitution") out.push(expansion);
				else for (const inner of expansion.substitutions) out.push(inner);
			}
			break;
		default:
			break;
	}
};

const NO_SUBSTITUTIONS: ReadonlyArray<RawSubstitution> = [];

const isTildeUserChar = (c: string | undefined): boolean => isNameChar(c) || c === "." || c === "-";

/**
 * The value of an unquoted run `source[from, to)`: a backslash escapes the
 * next character, and a backslash-newline disappears. A backslash before a
 * CRLF escapes the CR: the LF still ends the command, as in bash.
 *
 * @internal
 */
export const bareValue = (source: string, from: number, to: number): string => {
	let value = "";
	let run = from;
	let i = from;
	while (i < to) {
		if (source[i] !== "\\") {
			i += 1;
			continue;
		}
		value += source.slice(run, i);
		if (i + 1 >= to) {
			value += "\\";
			i += 1;
		} else if (source[i + 1] === "\n") {
			i += 2;
		} else {
			value += source[i + 1];
			i += 2;
		}
		run = i;
	}
	return value + source.slice(run, to);
};

interface DoubleQuotedContent {
	readonly value: string;
	readonly expansions: ReadonlyArray<RawExpansion>;
	readonly end: number;
	readonly terminated: boolean;
}

/**
 * Lex a whole script.
 *
 * @internal
 */
export const lex = (source: string): RawScript => new Lexer(source).run();

/** A pre-scanned span of a word that `lexWord` keeps as one `opaque` part. */
interface Span {
	readonly start: number;
	readonly end: number;
	readonly substitutions: ReadonlyArray<RawSubstitution>;
}

/** Brace-expansion events recorded while lexing a word's unquoted text. */
const BRACE_OPEN = 0;
const BRACE_SEPARATOR = 1;
const BRACE_CLOSE = 2;

class Lexer {
	private readonly source: string;
	private readonly length: number;
	private readonly segments: Array<RawSegment> = [];
	private readonly comments: Array<RawComment> = [];
	private readonly diagnostics: Array<RawDiagnostic> = [];
	private pending: Array<RawHeredoc> = [];
	private current: RawSegment | undefined = undefined;
	// A segment ended by `(` or `)` takes the next control operator.
	private awaiting: RawSegment | undefined = undefined;
	private depth = 0;
	// Every `[` before this offset is known to have no closing `]` in its word.
	private bracketFailUntil = -1;
	// A `((` before this offset is not tried as an arithmetic command: an
	// earlier `((` covering it turned out to be two subshells.
	private arithmeticFailUntil = -1;
	// A `<<` before this offset opens no heredoc: it sits inside parentheses
	// that may be arithmetic, where `<<` is a shift. Reading a heredoc that is
	// not there would hide the lines after it; not reading one only reports
	// its body as commands.
	private heredocOffUntil = -1;
	private diagnosticsDropped = false;
	// Reset with each segment: what the previous word means for the next one.
	private follows: Follows = FOLLOWS_NOTHING;

	constructor(source: string) {
		this.source = source;
		this.length = source.length;
	}

	run(): RawScript {
		const source = this.source;
		const n = this.length;
		let i = 0;
		while (i < n) {
			const c = source[i] as string;
			// The next token character: a backslash-newline is gone before bash
			// tokenizes, so `&\⏎&` and `(\⏎(` are one token each.
			const after = skipContinuations(source, i + 1);
			const next = source[after];
			if (c === " " || c === "\t") {
				i += 1;
				continue;
			}
			if (c === "\\" && source[i + 1] === "\n") {
				i += 2;
				continue;
			}
			if (c === "\n" || (c === "\r" && source[i + 1] === "\n")) {
				const width = c === "\n" ? 1 : 2;
				this.control("newline", i, width);
				i += width;
				if (this.pending.length > 0) i = this.consumeHeredocs(i);
				continue;
			}
			if (c === "#") {
				const newline = source.indexOf("\n", i);
				let end = newline === -1 ? n : newline;
				if (newline !== -1 && source[end - 1] === "\r") end -= 1;
				this.comments.push({ start: i, end });
				i = end;
				continue;
			}
			if (c === "&") {
				if (next === "&") {
					this.control("&&", i, after + 1 - i);
					i = after + 1;
				} else if (next === ">") {
					i = this.redirection(i, i, undefined);
				} else {
					this.control("&", i, 1);
					i += 1;
				}
				continue;
			}
			if (c === "|") {
				if (next === "|") {
					this.control("||", i, after + 1 - i);
					i = after + 1;
				} else if (next === "&") {
					this.control("|&", i, after + 1 - i);
					i = after + 1;
				} else {
					this.control("|", i, 1);
					i += 1;
				}
				continue;
			}
			if (c === ";") {
				if (next === ";") {
					const third = skipContinuations(source, after + 1);
					if (source[third] === "&") {
						this.control(";;&", i, third + 1 - i);
						i = third + 1;
					} else {
						this.control(";;", i, after + 1 - i);
						i = after + 1;
					}
				} else if (next === "&") {
					this.control(";&", i, after + 1 - i);
					i = after + 1;
				} else {
					this.control(";", i, 1);
					i += 1;
				}
				continue;
			}
			if (c === "(" && next === "(" && i >= this.arithmeticFailUntil) {
				const end = this.arithmeticCommand(i, after + 1);
				if (end !== -1) {
					i = end;
					continue;
				}
			}
			if (c === "(" || c === ")") {
				this.group(c === "(" ? 1 : -1);
				i += 1;
				continue;
			}
			if ((c === "<" || c === ">") && next !== "(") {
				i = this.redirection(i, i, undefined);
				continue;
			}
			if (isDigit(c)) {
				let j = after;
				while (j < n && isDigit(source[j])) j = skipContinuations(source, j + 1);
				const op = source[j];
				const digits = removeContinuations(source.slice(i, j));
				if (digits.length <= 9 && (op === "<" || op === ">") && source[skipContinuations(source, j + 1)] !== "(") {
					i = this.redirection(j, i, Number(digits));
					continue;
				}
			}
			i = this.word(i);
		}
		if (this.current !== undefined) this.segments.push(this.current);
		this.current = undefined;
		for (const heredoc of this.pending) {
			heredoc.start = n;
			heredoc.end = n;
			this.diagnose("UnterminatedHeredoc", heredoc.operatorStart, heredoc.operatorEnd - heredoc.operatorStart);
		}
		this.pending = [];
		return { segments: this.segments, comments: this.comments, diagnostics: this.diagnostics };
	}

	// --- segments ----------------------------------------------------------

	private segment(at: number): RawSegment {
		if (this.current === undefined) {
			this.current = {
				start: at,
				end: at,
				groupDepth: this.depth,
				commandPosition: true,
				words: [],
				assignments: [],
				redirections: [],
				operator: undefined,
			};
			this.awaiting = undefined;
			this.follows = FOLLOWS_NOTHING;
		}
		return this.current;
	}

	private control(operator: RawOperator, at: number, width: number): void {
		if (this.current !== undefined) {
			this.current.operator = operator;
			this.segments.push(this.current);
			this.current = undefined;
			this.awaiting = undefined;
		} else if (this.awaiting !== undefined) {
			this.awaiting.operator = operator;
			this.awaiting = undefined;
		} else if (operator !== "newline") {
			this.diagnose("EmptyCommand", at, width);
		}
	}

	private group(delta: 1 | -1): void {
		if (this.current !== undefined) {
			this.segments.push(this.current);
			this.awaiting = this.current;
			this.current = undefined;
		}
		this.depth = Math.max(0, this.depth + delta);
	}

	private diagnose(code: RawDiagnosticCode, offset: number, length: number): void {
		if (this.diagnostics.length < MAX_DIAGNOSTICS) {
			this.diagnostics.push({ code, offset, length });
		} else if (!this.diagnosticsDropped) {
			this.diagnosticsDropped = true;
			this.diagnostics.push({ code: "DiagnosticLimitReached", offset, length: 0 });
		}
	}

	/**
	 * Try the `((` at `at`, whose body starts at `bodyStart`, as an arithmetic
	 * command. Returns the offset after it, or -1 when it is two subshells
	 * (`((cmd) )`), which the caller then lexes as groups. An unterminated one
	 * runs to the end of the input.
	 */
	private arithmeticCommand(at: number, bodyStart: number): number {
		const n = this.length;
		const scan = scanNested(this.source, bodyStart, n, ARITH_GROUP);
		if (scan.demoted) {
			this.arithmeticFailUntil = scan.end;
			this.heredocOffUntil = Math.max(this.heredocOffUntil, scan.end);
			return -1;
		}
		const segment = this.segment(at);
		let word: RawWord;
		if (!scan.terminated) {
			this.diagnose("UnterminatedArithmetic", at, n - at);
			word = { start: at, end: n, parts: [{ kind: "opaque", start: at, end: n, substitutions: scan.substitutions }] };
		} else {
			const part: RawPart = {
				kind: "arithmetic",
				command: true,
				start: at,
				end: scan.end,
				bodyStart,
				bodyEnd: scan.end - 2,
				substitutions: scan.substitutions,
			};
			word = { start: at, end: scan.end, parts: [part] };
		}
		segment.words.push(word);
		segment.commandPosition = false;
		this.follows = FOLLOWS_CLOSED;
		segment.end = word.end;
		return word.end;
	}

	// --- words and assignments ---------------------------------------------

	private word(at: number): number {
		const segment = this.segment(at);
		if (segment.commandPosition) {
			const source = this.source;
			if (isNameStart(source[at])) {
				let j = skipContinuations(source, at + 1);
				while (isNameChar(source[j])) j = skipContinuations(source, j + 1);
				if (source[j] === "[") return this.subscriptedWord(segment, at, j);
				const equals = this.assignmentOperator(j);
				if (equals !== -1) {
					const name = removeContinuations(source.slice(at, j));
					return this.assignment(segment, at, name, source[j] === "+", equals, NO_SUBSTITUTIONS);
				}
			}
		}
		// The dispatcher only calls this on a word character, so the word is
		// never empty and the scan always advances.
		const word = this.lexWord(at, NORMAL);
		segment.words.push(word);
		this.position(segment, word);
		segment.end = word.end;
		return word.end;
	}

	/** The offset past the `=` or `+=` at `at`, or -1. */
	private assignmentOperator(at: number): number {
		const source = this.source;
		if (source[at] === "=") return at + 1;
		if (source[at] !== "+") return -1;
		const equals = skipContinuations(source, at + 1);
		return source[equals] === "=" ? equals + 1 : -1;
	}

	private assignment(
		segment: RawSegment,
		at: number,
		name: string,
		append: boolean,
		valueStart: number,
		subscript: ReadonlyArray<RawSubstitution>,
	): number {
		const value = this.lexWord(skipContinuations(this.source, valueStart), ASSIGNMENT_VALUE);
		segment.assignments.push({ start: at, end: value.end, name, append, value, subscript });
		// An assignment keeps command position, whatever its subscript holds.
		this.follows = FOLLOWS_NOTHING;
		segment.end = value.end;
		return value.end;
	}

	/**
	 * Update command position past a word, by bash's
	 * `reserved_word_acceptable`. Over-arming is safe: it only stops a `<<` from
	 * opening a heredoc, which reports the lines after it rather than hiding them.
	 */
	private position(segment: RawSegment, word: RawWord): void {
		const text = keywordOf(this.source, word);
		const armed = segment.commandPosition;
		const follows = this.follows;
		this.follows = FOLLOWS_NOTHING;
		const reserved = text !== undefined && PRECEDES_ASSIGNMENT.has(text);
		if (follows === FOLLOWS_CONDITIONAL) {
			segment.commandPosition = text === "]]";
			if (text !== "]]") this.follows = FOLLOWS_CONDITIONAL;
			return;
		}
		if (follows === FOLLOWS_LOOP) {
			segment.commandPosition = false;
			this.follows = FOLLOWS_CLOSED;
			return;
		}
		if (follows === FOLLOWS_CLOSED && reserved) {
			segment.commandPosition = true;
			return;
		}
		if ((follows === FOLLOWS_TIME || follows === FOLLOWS_TIME_OPTION) && text === "--") return;
		if (follows === FOLLOWS_TIME && text === "-p") {
			this.follows = FOLLOWS_TIME_OPTION;
			return;
		}
		if (follows === FOLLOWS_NAMER && !reserved) {
			segment.commandPosition = true;
			return;
		}
		if (armed && text === "time") this.follows = FOLLOWS_TIME;
		else if (armed && (text === "function" || text === "coproc")) this.follows = FOLLOWS_NAMER;
		else if (armed && (text === "for" || text === "select")) this.follows = FOLLOWS_LOOP;
		else if (armed && text === "[[") this.follows = FOLLOWS_CONDITIONAL;
		segment.commandPosition = armed && reserved;
	}

	/**
	 * A command-position word starting `NAME[`, whose subscript opens at `open`.
	 * The subscript is scanned as a bracket span; then an `=` or `+=` makes the
	 * word an assignment, with any substitutions in the subscript on it, and
	 * otherwise it is a word with the subscript as one `opaque` part. An
	 * unterminated subscript runs to the end of the input, as bash reads it.
	 */
	private subscriptedWord(segment: RawSegment, at: number, open: number): number {
		const source = this.source;
		const n = this.length;
		const scan = scanNested(source, open + 1, n, ARITH_BRACKET);
		if (!scan.terminated) {
			this.diagnose("UnterminatedSubscript", at, n - at);
			const word: RawWord = {
				start: at,
				end: n,
				parts: [{ kind: "opaque", start: at, end: n, substitutions: scan.substitutions }],
			};
			segment.words.push(word);
			segment.commandPosition = false;
			segment.end = n;
			return n;
		}
		const close = scan.end;
		const operator = skipContinuations(source, close);
		const equals = this.assignmentOperator(operator);
		if (equals !== -1) {
			const name = removeContinuations(source.slice(at, close));
			return this.assignment(segment, at, name, source[operator] === "+", equals, scan.substitutions);
		}
		const word = this.lexWord(at, NORMAL, {
			start: open,
			end: close,
			substitutions: scan.substitutions,
		});
		segment.words.push(word);
		this.position(segment, word);
		segment.end = word.end;
		return word.end;
	}

	private lexWord(start: number, mode: WordMode, subscript?: Span): RawWord {
		const source = this.source;
		const n = this.length;
		const parts: Array<RawPart> = [];
		const events: Array<number> = [];
		const eventKinds: Array<number> = [];
		let bareStart = -1;
		let colonAt = -2;
		let i = start;

		const flush = (at: number): void => {
			if (bareStart !== -1 && at > bareStart) {
				parts.push({ kind: "bare", start: bareStart, end: at, value: bareValue(source, bareStart, at) });
			}
			bareStart = -1;
		};
		const bare = (): void => {
			if (bareStart === -1) bareStart = i;
		};

		if (mode === ASSIGNMENT_VALUE && source[start] === "(") return this.arrayValue(start);

		while (i < n && !this.endsWordHere(i)) {
			const c = source[i] as string;
			if (subscript !== undefined && i === subscript.start) {
				flush(i);
				parts.push({ kind: "opaque", ...subscript });
				i = subscript.end;
				continue;
			}
			if (c === "\\") {
				bare();
				if (i + 1 >= n) i += 1;
				else i += 2;
				continue;
			}
			if (c === "'") {
				flush(i);
				const close = source.indexOf("'", i + 1);
				if (close === -1) {
					this.diagnose("UnterminatedSingleQuote", i, n - i);
					parts.push({ kind: "opaque", start: i, end: n, substitutions: NO_SUBSTITUTIONS });
					i = n;
					break;
				}
				parts.push({ kind: "singleQuoted", start: i, end: close + 1, value: source.slice(i + 1, close) });
				i = close + 1;
				continue;
			}
			if (c === '"') {
				flush(i);
				const part = this.doubleQuoted(i, i + 1, false);
				parts.push(part);
				i = part.end;
				if (part.kind === "opaque") break;
				continue;
			}
			if (c === "$") {
				const part = this.dollar(i, false, n);
				if (part === undefined) {
					bare();
					i += 1;
					continue;
				}
				flush(i);
				parts.push(part);
				i = part.end;
				if (part.kind === "opaque") break;
				continue;
			}
			if (c === "`") {
				flush(i);
				const part = this.backtick(i, n, false);
				parts.push(part);
				i = part.end;
				if (part.kind === "opaque") break;
				continue;
			}
			if (c === "<" || c === ">") {
				// `endsWord` let this through, so a `(` follows: process substitution.
				flush(i);
				const bodyStart = skipContinuations(source, i + 1) + 1;
				const scan = scanNested(source, bodyStart, n, SUBST);
				if (!scan.terminated) {
					this.diagnose("UnterminatedProcessSubstitution", i, n - i);
					parts.push({ kind: "opaque", start: i, end: n, substitutions: scan.substitutions });
					i = n;
					break;
				}
				parts.push({
					kind: "processSubstitution",
					direction: c,
					start: i,
					end: scan.end,
					bodyStart,
					bodyEnd: scan.end - 1,
				});
				i = scan.end;
				continue;
			}
			if (c === "~" && (i === start || (mode === ASSIGNMENT_VALUE && colonAt === i - 1))) {
				let j = i + 1;
				if (source[j] === "+" || source[j] === "-") j += 1;
				else while (j < n && isTildeUserChar(source[j])) j += 1;
				if (j >= n || source[j] === "/" || this.endsWordHere(j) || (mode === ASSIGNMENT_VALUE && source[j] === ":")) {
					flush(i);
					parts.push({ kind: "tilde", start: i, end: j, user: source.slice(i + 1, j) });
					i = j;
					continue;
				}
				bare();
				i += 1;
				continue;
			}
			if (mode === NORMAL && (c === "*" || c === "?")) {
				flush(i);
				this.glob(parts, i, i + 1);
				i += 1;
				continue;
			}
			if (mode === NORMAL && c === "[") {
				const close = this.bracketClose(i);
				if (close !== -1) {
					flush(i);
					this.glob(parts, i, close + 1);
					i = close + 1;
					continue;
				}
				bare();
				i += 1;
				continue;
			}
			if (mode === NORMAL) {
				if (c === "{") {
					events.push(i);
					eventKinds.push(BRACE_OPEN);
				} else if (c === "}") {
					events.push(i);
					eventKinds.push(BRACE_CLOSE);
				} else if (c === "," || (c === "." && source[i + 1] === ".")) {
					events.push(i);
					eventKinds.push(BRACE_SEPARATOR);
				}
			} else if (c === ":") {
				colonAt = i;
			}
			bare();
			i += 1;
		}
		flush(i);
		const end = i;
		if (events.length === 0) return { start, end, parts };
		return { start, end, parts: this.braceExpansions(parts, events, eventKinds) };
	}

	/**
	 * An array assignment value, `(…)`, from its `(` at `start`: one `opaque`
	 * part holding the substitutions of its elements, which are lexed as words
	 * so `x=($(cmd))` cannot hide `cmd`.
	 */
	private arrayValue(start: number): RawWord {
		const source = this.source;
		const n = this.length;
		const substitutions: Array<RawSubstitution> = [];
		let j = start + 1;
		for (;;) {
			while (j < n) {
				const c = source[j];
				if (c === " " || c === "\t" || c === "\n") j += 1;
				else if ((c === "\r" || c === "\\") && source[j + 1] === "\n") j += 2;
				else if (c === "#") {
					const newline = source.indexOf("\n", j);
					j = newline === -1 ? n : newline;
				} else break;
			}
			if (j >= n) {
				this.diagnose("UnterminatedArrayAssignment", start, n - start);
				return { start, end: n, parts: [{ kind: "opaque", start, end: n, substitutions }] };
			}
			if (source[j] === ")") {
				j += 1;
				return { start, end: j, parts: [{ kind: "opaque", start, end: j, substitutions }] };
			}
			if (this.endsWordHere(j)) {
				// Another metacharacter inside an array is a syntax error. bash
				// discards the rest of that line and runs the next one, so the
				// array must not read on, and nothing on the line is a heredoc.
				const newline = source.indexOf("\n", j);
				const end = newline === -1 ? n : newline;
				this.diagnose("UnterminatedArrayAssignment", start, end - start);
				return { start, end, parts: [{ kind: "opaque", start, end, substitutions }] };
			}
			const element = this.lexWord(j, NORMAL);
			for (const part of element.parts) collectSubstitutions(part, substitutions);
			j = element.end;
		}
	}

	/** `endsWord`, except that `<(` and `>(` continue a word as a process substitution. */
	private endsWordHere(i: number): boolean {
		const c = this.source[i];
		if ((c === "<" || c === ">") && this.source[skipContinuations(this.source, i + 1)] === "(") return false;
		return endsWord(this.source, i);
	}

	private glob(parts: Array<RawPart>, start: number, end: number): void {
		const last = parts[parts.length - 1];
		if (last !== undefined && last.kind === "glob" && last.end === start) {
			parts[parts.length - 1] = { kind: "glob", start: last.start, end };
		} else {
			parts.push({ kind: "glob", start, end });
		}
	}

	/**
	 * The offset of the `]` closing a bracket expression opened at `open`, or
	 * -1. A failed search is cached: any later `[` before the failure point
	 * would fail at the same point, so a run of `[` is linear, not quadratic.
	 */
	private bracketClose(open: number): number {
		if (open < this.bracketFailUntil) return -1;
		const source = this.source;
		const n = this.length;
		let j = open + 1;
		if (source[j] === "!" || source[j] === "^") j += 1;
		if (source[j] === "]") j += 1;
		while (j < n) {
			const c = source[j];
			if (c === "]") return j;
			if (endsWord(source, j) || c === "'" || c === '"' || c === "\\" || c === "$" || c === "`") break;
			j += 1;
		}
		this.bracketFailUntil = j;
		return -1;
	}

	/**
	 * Replace the spans of the word that brace expansion would rewrite with
	 * `brace` parts. Braces are matched with a stack over the recorded events,
	 * and a pair expands only when a `,` or `..` sits directly inside it.
	 * Range boundaries always fall on unquoted characters, so only `bare`
	 * parts are ever split.
	 */
	private braceExpansions(
		parts: ReadonlyArray<RawPart>,
		events: ReadonlyArray<number>,
		kinds: ReadonlyArray<number>,
	): Array<RawPart> {
		const stack: Array<number> = [];
		const separated: Array<boolean> = [];
		const ranges: Array<{ start: number; end: number }> = [];
		for (let k = 0; k < events.length; k += 1) {
			const kind = kinds[k];
			if (kind === BRACE_OPEN) {
				stack.push(events[k] as number);
				separated.push(false);
			} else if (kind === BRACE_SEPARATOR) {
				if (separated.length > 0) separated[separated.length - 1] = true;
			} else if (stack.length > 0) {
				const open = stack.pop() as number;
				if (separated.pop() === true) ranges.push({ start: open, end: (events[k] as number) + 1 });
			}
		}
		if (ranges.length === 0) return [...parts];
		ranges.sort((a, b) => a.start - b.start);
		const merged: Array<{ start: number; end: number }> = [];
		for (const range of ranges) {
			const last = merged[merged.length - 1];
			if (last !== undefined && range.start < last.end) last.end = Math.max(last.end, range.end);
			else merged.push({ ...range });
		}
		const out: Array<RawPart> = [];
		let r = 0;
		let emitted = -1;
		let inside: Array<RawSubstitution> = [];
		for (const part of parts) {
			let cursor = part.start;
			while (cursor < part.end) {
				while (r < merged.length && (merged[r] as { end: number }).end <= cursor) r += 1;
				const range = merged[r];
				if (range === undefined || range.start >= part.end) {
					out.push(this.slicePart(part, cursor, part.end));
					break;
				}
				if (range.start > cursor) out.push(this.slicePart(part, cursor, range.start));
				if (emitted !== r) {
					// The brace part stands for everything in its span, so the
					// substitutions inside it ride on it.
					inside = [];
					out.push({ kind: "brace", start: range.start, end: range.end, substitutions: inside });
					emitted = r;
				}
				collectSubstitutions(part, inside);
				cursor = range.end;
			}
		}
		return out;
	}

	private slicePart(part: RawPart, from: number, to: number): RawPart {
		if (from === part.start && to === part.end) return part;
		return { kind: "bare", start: from, end: to, value: bareValue(this.source, from, to) };
	}

	// --- quotes and expansions ---------------------------------------------

	private doubleQuoted(start: number, contentStart: number, localized: boolean): RawPart {
		const content = this.doubleQuotedContent(contentStart, this.length, true, false);
		if (!content.terminated) {
			this.diagnose("UnterminatedDoubleQuote", start, this.length - start);
			const substitutions: Array<RawSubstitution> = [];
			for (const expansion of content.expansions) collectSubstitutions(expansion, substitutions);
			return { kind: "opaque", start, end: this.length, substitutions };
		}
		return {
			kind: "doubleQuoted",
			start,
			end: content.end,
			value: content.value,
			localized,
			expansions: content.expansions,
		};
	}

	/**
	 * Lex double-quote context from `i`: `\` escapes `$`, backtick, `\` and
	 * newline (and `"` unless this is a heredoc body); `$` and backticks open
	 * expansions. `value` keeps each expansion's source text in place.
	 */
	private doubleQuotedContent(i: number, limit: number, stopAtQuote: boolean, heredoc: boolean): DoubleQuotedContent {
		const source = this.source;
		const expansions: Array<RawExpansion> = [];
		let value = "";
		let run = i;
		while (i < limit) {
			const c = source[i];
			if (stopAtQuote && c === '"') {
				return { value: value + source.slice(run, i), expansions, end: i + 1, terminated: true };
			}
			if (c === "\\") {
				if (i + 1 >= limit) {
					i += 1;
					continue;
				}
				const next = source[i + 1];
				if (next === "\n") {
					value += source.slice(run, i);
					i += 2;
					run = i;
				} else if (next === "$" || next === "`" || next === "\\" || (next === '"' && !heredoc)) {
					value += source.slice(run, i) + next;
					i += 2;
					run = i;
				} else {
					i += 2;
				}
				continue;
			}
			if (c === "$" || c === "`") {
				const part = c === "$" ? this.dollar(i, true, limit) : this.backtick(i, limit, !heredoc);
				if (part === undefined) {
					i += 1;
					continue;
				}
				if (part.kind === "opaque") {
					return { value: value + source.slice(run, limit), expansions, end: limit, terminated: false };
				}
				expansions.push(part as RawExpansion);
				i = part.end;
				continue;
			}
			i += 1;
		}
		return { value: value + source.slice(run, limit), expansions, end: limit, terminated: !stopAtQuote };
	}

	/**
	 * Lex what a `$` at `i` introduces, or `undefined` when it is a literal
	 * `$`. Inside double quotes `$'…'` and `$"…"` are not special.
	 */
	private dollar(i: number, inDoubleQuotes: boolean, limit: number): RawPart | undefined {
		const source = this.source;
		const open = skipContinuations(source, i + 1, limit);
		const next = open < limit ? source[open] : undefined;
		if (next === "(") {
			const inner = skipContinuations(source, open + 1, limit);
			const arithmetic = inner < limit && source[inner] === "(";
			const scan = arithmetic
				? scanNested(source, inner + 1, limit, ARITH_SUBST)
				: scanNested(source, open + 1, limit, SUBST);
			if (!scan.terminated) {
				this.diagnose(scan.arithmetic ? "UnterminatedArithmetic" : "UnterminatedCommandSubstitution", i, limit - i);
				return { kind: "opaque", start: i, end: limit, substitutions: scan.substitutions };
			}
			if (scan.arithmetic) {
				return {
					kind: "arithmetic",
					command: false,
					start: i,
					end: scan.end,
					bodyStart: inner + 1,
					bodyEnd: scan.end - 2,
					substitutions: scan.substitutions,
				};
			}
			return {
				kind: "commandSubstitution",
				style: "dollar",
				start: i,
				end: scan.end,
				bodyStart: open + 1,
				bodyEnd: scan.end - 1,
				body: source.slice(open + 1, scan.end - 1),
			};
		}
		if (next === "[") {
			// The legacy arithmetic expansion `$[…]`: like `$((…))`, a `<<`
			// inside it is a shift, never a heredoc.
			const scan = scanNested(source, open + 1, limit, ARITH_BRACKET);
			if (!scan.terminated) {
				this.diagnose("UnterminatedArithmetic", i, limit - i);
				return { kind: "opaque", start: i, end: limit, substitutions: scan.substitutions };
			}
			return {
				kind: "arithmetic",
				command: false,
				start: i,
				end: scan.end,
				bodyStart: open + 1,
				bodyEnd: scan.end - 1,
				substitutions: scan.substitutions,
			};
		}
		if (next === "{") {
			const scan = scanNested(source, open + 1, limit, BRACE);
			if (!scan.terminated) {
				this.diagnose("UnterminatedParameterExpansion", i, limit - i);
				return { kind: "opaque", start: i, end: limit, substitutions: scan.substitutions };
			}
			if (scan.end - 1 === open + 1) this.diagnose("EmptyParameterExpansion", i, scan.end - i);
			return {
				kind: "variable",
				braced: true,
				start: i,
				end: scan.end,
				expressionStart: open + 1,
				expressionEnd: scan.end - 1,
				substitutions: scan.substitutions,
			};
		}
		if (next === "'" && !inDoubleQuotes) return this.ansiC(i, open + 1, limit);
		if (next === '"' && !inDoubleQuotes) return this.doubleQuoted(i, open + 1, true);
		if (isNameStart(next)) {
			let j = open + 1;
			for (;;) {
				const at = skipContinuations(source, j, limit);
				if (at >= limit || !isNameChar(source[at])) break;
				j = at + 1;
			}
			return {
				kind: "variable",
				braced: false,
				start: i,
				end: j,
				expressionStart: open,
				expressionEnd: j,
				substitutions: [],
			};
		}
		if (isDigit(next) || isSpecialParameter(next)) {
			return {
				kind: "variable",
				braced: false,
				start: i,
				end: open + 1,
				expressionStart: open,
				expressionEnd: open + 1,
				substitutions: [],
			};
		}
		return undefined;
	}

	private ansiC(i: number, bodyStart: number, limit: number): RawPart {
		const source = this.source;
		let j = bodyStart;
		while (j < limit && source[j] !== "'") j += source[j] === "\\" ? 2 : 1;
		if (j >= limit) {
			this.diagnose("UnterminatedAnsiCQuote", i, limit - i);
			return { kind: "opaque", start: i, end: limit, substitutions: NO_SUBSTITUTIONS };
		}
		const decoded = decodeAnsiC(source, bodyStart, j);
		for (const bad of decoded.invalid) this.diagnose("InvalidAnsiCEscape", bad.offset, bad.length);
		return { kind: "ansiC", start: i, end: j + 1, value: decoded.value };
	}

	/**
	 * A backtick substitution at `i`. `inDoubleQuotes` says whether bash also
	 * removes the backslash before `"` in its body.
	 */
	private backtick(i: number, limit: number, inDoubleQuotes: boolean): RawCommandSubstitution | RawPart {
		const scan = scanNested(this.source, i + 1, limit, BACKTICK);
		if (!scan.terminated) {
			this.diagnose("UnterminatedBacktick", i, limit - i);
			return { kind: "opaque", start: i, end: limit, substitutions: NO_SUBSTITUTIONS };
		}
		return {
			kind: "commandSubstitution",
			style: "backtick",
			start: i,
			end: scan.end,
			bodyStart: i + 1,
			bodyEnd: scan.end - 1,
			body: backtickBody(this.source, i + 1, scan.end - 1, inDoubleQuotes),
		};
	}

	// --- redirections and heredocs -----------------------------------------

	/**
	 * Lex a redirection whose operator starts at `at` (after any fd digits,
	 * which start at `from`). Returns the offset after its target.
	 */
	private redirection(at: number, from: number, fd: number | undefined): number {
		const source = this.source;
		const n = this.length;
		const { operator, end: operatorEnd } = this.redirectionOperator(at);
		const segment = this.segment(from);
		let j = operatorEnd;
		for (;;) {
			if (source[j] === " " || source[j] === "\t") j += 1;
			else if (source[j] === "\\" && source[j + 1] === "\n") j += 2;
			else break;
		}
		const missing = (): { readonly target: RawWord; readonly end: number } => {
			this.diagnose("MissingRedirectionTarget", from, operatorEnd - from);
			// The empty target sits right after the operator, inside the segment's span.
			const here = operatorEnd;
			return {
				target: {
					start: here,
					end: here,
					parts: [{ kind: "opaque", start: here, end: here, substitutions: NO_SUBSTITUTIONS }],
				},
				end: here,
			};
		};
		let resolved: { readonly target: RawWord | RawHeredoc; readonly end: number };
		if ((operator === "<<" || operator === "<<-") && from >= this.heredocOffUntil) {
			const word = j < n && source[j] !== "#" ? readHeredocDelimiter(source, j, n) : undefined;
			if (word === undefined) {
				resolved = missing();
			} else if (word.opaque) {
				// Its delimiter cannot be known, so no body is read: the lines
				// after it stay commands, and the diagnostic says why.
				this.diagnose("ExpansionInHeredocDelimiter", from, word.end - from);
				const target = this.lexWord(j, NORMAL);
				resolved = { target, end: target.end };
			} else {
				const heredoc: RawHeredoc = {
					kind: "heredoc",
					delimiter: word.delimiter,
					quoted: word.quoted,
					stripTabs: operator === "<<-",
					operatorStart: from,
					operatorEnd: word.end,
					start: -1,
					end: -1,
					terminated: false,
					expansions: [],
				};
				this.pending.push(heredoc);
				resolved = { target: heredoc, end: word.end };
			}
		} else if (j >= n || source[j] === "#" || this.endsWordHere(j)) {
			resolved = missing();
		} else {
			const word = this.lexWord(j, NORMAL);
			resolved = { target: word, end: word.end };
		}
		const redirection: RawRedirection = { start: from, end: resolved.end, fd, operator, target: resolved.target };
		segment.redirections.push(redirection);
		segment.end = redirection.end;
		return redirection.end;
	}

	private redirectionOperator(at: number): { readonly operator: RawRedirectionOperator; readonly end: number } {
		const s = this.source;
		const c = s[at];
		const second = skipContinuations(s, at + 1);
		const third = skipContinuations(s, second + 1);
		const a = s[second];
		const b = s[third];
		const one = (operator: RawRedirectionOperator) => ({ operator, end: at + 1 });
		const two = (operator: RawRedirectionOperator) => ({ operator, end: second + 1 });
		const three = (operator: RawRedirectionOperator) => ({ operator, end: third + 1 });
		if (c === "&") return a === ">" && b === ">" ? three("&>>") : two("&>");
		if (c === ">") {
			if (a === ">") return two(">>");
			if (a === "&") return two(">&");
			if (a === "|") return two(">|");
			return one(">");
		}
		if (a === "<") {
			if (b === "<") return three("<<<");
			if (b === "-") return three("<<-");
			return two("<<");
		}
		if (a === ">") return two("<>");
		if (a === "&") return two("<&");
		return one("<");
	}

	private consumeHeredocs(p: number): number {
		const pending = this.pending;
		this.pending = [];
		const { next, bodies } = consumeHeredocBodies(this.source, p, this.length, pending);
		for (let k = 0; k < pending.length; k += 1) {
			const heredoc = pending[k] as RawHeredoc;
			const body = bodies[k] as { start: number; end: number; terminated: boolean };
			heredoc.start = body.start;
			heredoc.end = body.end;
			heredoc.terminated = body.terminated;
			if (!body.terminated) {
				this.diagnose("UnterminatedHeredoc", heredoc.operatorStart, heredoc.operatorEnd - heredoc.operatorStart);
			}
			if (!heredoc.quoted) {
				heredoc.expansions = this.doubleQuotedContent(body.start, body.end, false, true).expansions;
			}
		}
		return next;
	}
}

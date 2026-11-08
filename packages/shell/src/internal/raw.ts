// Raw carriers the engine emits. Plain records, never Schema classes: the
// engine imports no public module (the cycle firewall), and `ShellSyntax`
// materializes these into the public classes. Every offset is a UTF-16 index
// into the source string the engine scanned.

/**
 * The control operators that end a segment, `"newline"` standing for an
 * unquoted line break.
 *
 * @internal
 */
export const SHELL_OPERATORS = ["&&", "||", ";", ";;", ";&", ";;&", "|", "|&", "&", "newline"] as const;

/** @internal */
export type RawOperator = (typeof SHELL_OPERATORS)[number];

/**
 * The redirection operators. A file-descriptor prefix (`2>&1`) is recorded
 * separately as the redirection's `fd`.
 *
 * @internal
 */
export const SHELL_REDIRECTION_OPERATORS = [
	">",
	">>",
	">|",
	">&",
	"<",
	"<>",
	"<&",
	"<<",
	"<<-",
	"<<<",
	"&>",
	"&>>",
] as const;

/** @internal */
export type RawRedirectionOperator = (typeof SHELL_REDIRECTION_OPERATORS)[number];

/**
 * Every diagnostic the engine records. None of them is a failure: each one
 * rides on a script that was still produced.
 *
 * @internal
 */
export const SHELL_DIAGNOSTIC_CODES = [
	"UnterminatedSingleQuote",
	"UnterminatedDoubleQuote",
	"UnterminatedAnsiCQuote",
	"UnterminatedCommandSubstitution",
	"UnterminatedBacktick",
	"UnterminatedProcessSubstitution",
	"UnterminatedParameterExpansion",
	"UnterminatedArrayAssignment",
	"UnterminatedHeredoc",
	"EmptyParameterExpansion",
	"InvalidAnsiCEscape",
	"UnterminatedArithmetic",
	"UnterminatedSubscript",
	"ExpansionInHeredocDelimiter",
	"QuotedSubstitutionInExpansion",
	"QuotedCloserInExpansion",
	"MissingRedirectionTarget",
	"EmptyCommand",
	"DiagnosticLimitReached",
] as const;

/**
 * The words that are reserved in command position and precede or close
 * around a command rather than naming one. Shared by the lexer (an assignment
 * may follow one) and `ShellCommand` (which skips them).
 *
 * @internal
 */
export const SHELL_RESERVED_WORDS = [
	"!",
	"{",
	"}",
	"if",
	"then",
	"elif",
	"else",
	"fi",
	"do",
	"done",
	"while",
	"until",
	"esac",
	"coproc",
] as const;

/**
 * The offset past any backslash-newlines at `i`. bash removes them in
 * `shell_getc`, before it tokenizes, so every lookahead that joins two
 * characters into one token (`$[`, `((`, `<<-`, `NAME[`) reads through them.
 *
 * @internal
 */
export const skipContinuations = (source: string, i: number, limit: number = source.length): number => {
	let at = i;
	while (at + 1 < limit && source[at] === "\\" && source[at + 1] === "\n") at += 2;
	return at;
};

/**
 * `text` without its backslash-newlines. Other escapes stay as written.
 *
 * @internal
 */
export const removeContinuations = (text: string): string => {
	if (!text.includes("\\\n")) return text;
	let out = "";
	let run = 0;
	let i = 0;
	while (i < text.length) {
		if (text[i] !== "\\") {
			i += 1;
			continue;
		}
		if (text[i + 1] === "\n") {
			out += text.slice(run, i);
			run = i + 2;
		}
		i += 2;
	}
	return out + text.slice(run);
};

/** @internal */
export type RawDiagnosticCode = (typeof SHELL_DIAGNOSTIC_CODES)[number];

/** @internal */
export interface RawSpan {
	readonly start: number;
	readonly end: number;
}

/** @internal */
export interface RawBare extends RawSpan {
	readonly kind: "bare";
	readonly value: string;
}

/** @internal */
export interface RawSingleQuoted extends RawSpan {
	readonly kind: "singleQuoted";
	readonly value: string;
}

/** @internal */
export interface RawAnsiC extends RawSpan {
	readonly kind: "ansiC";
	readonly value: string;
}

/** @internal */
export interface RawCommandSubstitution extends RawSpan {
	readonly kind: "commandSubstitution";
	readonly style: "dollar" | "backtick";
	readonly bodyStart: number;
	readonly bodyEnd: number;
	/** The text the shell runs: the source slice, after backtick escape removal for `style` `"backtick"`. */
	readonly body: string;
}

/** @internal */
export interface RawProcessSubstitution extends RawSpan {
	readonly kind: "processSubstitution";
	readonly direction: "<" | ">";
	readonly bodyStart: number;
	readonly bodyEnd: number;
}

/** @internal */
export type RawSubstitution = RawCommandSubstitution | RawProcessSubstitution;

/** @internal */
export interface RawVariable extends RawSpan {
	readonly kind: "variable";
	readonly braced: boolean;
	readonly expressionStart: number;
	readonly expressionEnd: number;
	readonly substitutions: ReadonlyArray<RawSubstitution>;
}

/** @internal */
export interface RawArithmetic extends RawSpan {
	readonly kind: "arithmetic";
	/** `true` for the arithmetic command `((…))`, `false` for the expansion `$((…))` or `$[…]`. */
	readonly command: boolean;
	readonly bodyStart: number;
	readonly bodyEnd: number;
	readonly substitutions: ReadonlyArray<RawSubstitution>;
}

/** @internal */
export type RawExpansion = RawVariable | RawCommandSubstitution | RawArithmetic;

/** @internal */
export interface RawDoubleQuoted extends RawSpan {
	readonly kind: "doubleQuoted";
	readonly value: string;
	readonly localized: boolean;
	readonly expansions: ReadonlyArray<RawExpansion>;
}

/** @internal */
export interface RawGlob extends RawSpan {
	readonly kind: "glob";
}

/** @internal */
export interface RawBrace extends RawSpan {
	readonly kind: "brace";
	readonly substitutions: ReadonlyArray<RawSubstitution>;
}

/** @internal */
export interface RawTilde extends RawSpan {
	readonly kind: "tilde";
	readonly user: string;
}

/** @internal */
export interface RawOpaque extends RawSpan {
	readonly kind: "opaque";
	readonly substitutions: ReadonlyArray<RawSubstitution>;
}

/** @internal */
export type RawPart =
	| RawBare
	| RawSingleQuoted
	| RawDoubleQuoted
	| RawAnsiC
	| RawVariable
	| RawCommandSubstitution
	| RawArithmetic
	| RawProcessSubstitution
	| RawGlob
	| RawBrace
	| RawTilde
	| RawOpaque;

/** @internal */
export interface RawWord extends RawSpan {
	readonly parts: ReadonlyArray<RawPart>;
}

/** @internal */
export interface RawAssignment extends RawSpan {
	readonly name: string;
	readonly append: boolean;
	readonly value: RawWord;
	/** The command and process substitutions inside the name's subscript. */
	readonly subscript: ReadonlyArray<RawSubstitution>;
}

/**
 * A heredoc. Mutable on purpose: the engine registers it when it lexes the
 * `<<` operator and fills the body in at the next unquoted newline.
 *
 * @internal
 */
export interface RawHeredoc {
	readonly kind: "heredoc";
	readonly delimiter: string;
	readonly quoted: boolean;
	readonly stripTabs: boolean;
	/** Offset of the `<<` operator, for an unterminated-heredoc diagnostic. */
	readonly operatorStart: number;
	readonly operatorEnd: number;
	start: number;
	end: number;
	terminated: boolean;
	expansions: ReadonlyArray<RawExpansion>;
}

/** @internal */
export interface RawRedirection extends RawSpan {
	readonly fd: number | undefined;
	readonly operator: RawRedirectionOperator;
	readonly target: RawWord | RawHeredoc;
}

/**
 * A segment under construction. Mutable while the engine is inside it.
 *
 * @internal
 */
export interface RawSegment {
	start: number;
	end: number;
	readonly groupDepth: number;
	/**
	 * Whether the next word is read in command position, bash's
	 * `assignment_acceptable`: a `NAME[` starts a matched pair and a `NAME=` is
	 * an assignment.
	 */
	commandPosition: boolean;
	readonly words: Array<RawWord>;
	readonly assignments: Array<RawAssignment>;
	readonly redirections: Array<RawRedirection>;
	operator: RawOperator | undefined;
}

/** @internal */
export interface RawComment extends RawSpan {}

/** @internal */
export interface RawDiagnostic {
	readonly code: RawDiagnosticCode;
	readonly offset: number;
	readonly length: number;
}

/** @internal */
export interface RawScript {
	readonly segments: ReadonlyArray<RawSegment>;
	readonly comments: ReadonlyArray<RawComment>;
	readonly diagnostics: ReadonlyArray<RawDiagnostic>;
}

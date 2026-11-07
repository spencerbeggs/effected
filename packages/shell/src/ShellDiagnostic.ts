// The diagnostic a parse records about input it could not finish. Never a
// failure: a script is always produced, and its diagnostics say what was odd.

import { Schema } from "effect";
import { SHELL_DIAGNOSTIC_CODES } from "./internal/raw.js";

/**
 * What a {@link ShellDiagnostic} reports.
 *
 * @remarks
 * - `UnterminatedSingleQuote`, `UnterminatedDoubleQuote`,
 *   `UnterminatedAnsiCQuote`, `UnterminatedCommandSubstitution`,
 *   `UnterminatedBacktick`, `UnterminatedProcessSubstitution`,
 *   `UnterminatedParameterExpansion`, `UnterminatedArrayAssignment`: a
 *   construct ran to the end of the input. Its text became an `opaque` part
 *   from its opener to the end.
 * - `UnterminatedArithmetic`: a `((`, `$((` or `$[` arithmetic expression
 *   ran to the end of the input. Its text became an `opaque` part.
 * - `ExpansionInHeredocDelimiter`: a heredoc delimiter holds a `$(`, `$((`,
 *   `$[`, `${`, backtick, `<(` or `>(`. bash reads the word as a matched pair
 *   and rebuilds a `$( … )` from its parse, so the delimiter line cannot be
 *   known. No body is read, and the lines after it are reported as commands.
 * - `QuotedSubstitutionInExpansion`: a `$` or a backtick reaches a `${…}`,
 *   an arithmetic expression (`$((…))`, `((…))`, `$[…]`) or a subscript
 *   quoted: inside a `'…'` run, a `$'…'` run (after decoding), a `"…"` run
 *   (a literal `$`, not the `$` of an expansion such as `$HOME` or `$$`) or
 *   after a backslash, or a bare `$` stands before an escaped `(` or
 *   backtick (`$\(`), which removing the backslash turns into `$(`. bash
 *   honours that quoting only to find the closer: inside a double-quoted or
 *   heredoc `${…}`, in arithmetic and in an indexed array's key it removes
 *   the quotes and reads the text again, so the `$` joins whatever follows
 *   it: `echo "${x:-'$(cmd)'}"`, `echo "${x:-"$"(cmd)}"`,
 *   `"${x:-$'\x24(cmd)'}"` and `x=([\$\(cmd\)]=1)` each run `cmd`. Which
 *   operator and quoting keep the text literal, and what the `$` joins, are
 *   not modelled, so every such `$` is reported, whatever follows it, and no
 *   substitution part is placed for it.
 * - `QuotedCloserInExpansion`: a `'…'` or `$'…'` run inside an expansion
 *   that sits in double quotes or a heredoc body holds a `}` or `]` with no
 *   opener before it, or leaves a `"`, `${` or `$[` open (`'}'`, `'"'`,
 *   `'${'`; a balanced `'${y:-v}'` is not reported). The parse follows bash's
 *   default mode, which honours the
 *   quote while it looks for the closer. POSIX mode (`set -o posix`, or an
 *   inherited `POSIXLY_CORRECT`) takes that `'` for an ordinary character, so
 *   in `echo "${x:-'}"; cmd; echo "'}"` the first `}` closes the expansion and
 *   `cmd` runs, where the default mode runs nothing.
 * - `UnterminatedSubscript`: the `[` subscript of a command-position word
 *   starting `NAME[` has no matching `]`. bash reads that subscript as a
 *   matched pair to the end of the input, so the word became an `opaque`
 *   part to the end.
 * - `UnterminatedHeredoc`: no delimiter line ended a heredoc body; the body
 *   runs to the end of the input.
 * - `EmptyParameterExpansion`: `${}`, which bash rejects as a bad
 *   substitution.
 * - `InvalidAnsiCEscape`: a `\u` or `\U` escape in `$'…'` above U+10FFFF;
 *   it is kept as written.
 * - `MissingRedirectionTarget`: a redirection operator with no word after it.
 * - `EmptyCommand`: a control operator with no command before it, as in
 *   `&& ls`, which bash rejects as a syntax error.
 * - `DiagnosticLimitReached`: the parse recorded its limit of 1000
 *   diagnostics and dropped the rest. Always the last diagnostic when
 *   present.
 *
 * @public
 */
export const ShellDiagnosticCode = Schema.Literals(SHELL_DIAGNOSTIC_CODES);

/**
 * The union of {@link (ShellDiagnosticCode:variable)} string literals.
 *
 * @public
 */
export type ShellDiagnosticCode = typeof ShellDiagnosticCode.Type;

const MESSAGES: Readonly<Record<ShellDiagnosticCode, string>> = {
	UnterminatedSingleQuote: "single-quoted string is not closed",
	UnterminatedDoubleQuote: "double-quoted string is not closed",
	UnterminatedAnsiCQuote: "ANSI-C quoted string ($'…') is not closed",
	UnterminatedCommandSubstitution: "command substitution ($(…)) is not closed",
	UnterminatedBacktick: "backtick command substitution is not closed",
	UnterminatedProcessSubstitution: "process substitution is not closed",
	UnterminatedParameterExpansion: "braced parameter expansion is not closed",
	UnterminatedArrayAssignment: "array assignment is not closed",
	UnterminatedArithmetic: "arithmetic expression is not closed",
	UnterminatedSubscript: "array subscript ([ … ]) is not closed",
	ExpansionInHeredocDelimiter: "heredoc delimiter holds an expansion, so its body cannot be found",
	QuotedSubstitutionInExpansion:
		"a quoted or escaped $ or backtick inside an expansion may open a substitution bash still runs",
	QuotedCloserInExpansion: "a quoted run inside a double-quoted expansion holds syntax POSIX-mode bash would act on",
	UnterminatedHeredoc: "heredoc has no delimiter line",
	EmptyParameterExpansion: "parameter expansion is empty",
	InvalidAnsiCEscape: "escape names a code point above U+10FFFF",
	MissingRedirectionTarget: "redirection has no target",
	EmptyCommand: "control operator has no command before it",
	DiagnosticLimitReached: "too many diagnostics; the rest were dropped",
};

/**
 * Something a parse could not finish or found malformed, with the span it
 * concerns.
 *
 * @remarks
 * A diagnostic never replaces a result: `ShellSyntax.parse` always returns a
 * script, and records diagnostics beside it. A guard should treat a script
 * with diagnostics as input it cannot vouch for.
 *
 * `offset` and `length` are UTF-16 offsets into the parsed source, the same
 * positional core every kit format package's diagnostics carry, so the pair
 * satisfies `@effected/source`'s `SourceRange` and its `LineIndex` turns
 * `offset` into an LSP-style line and character.
 *
 * @public
 */
export class ShellDiagnostic extends Schema.Class<ShellDiagnostic>("ShellDiagnostic")({
	code: ShellDiagnosticCode,
	offset: Schema.Number,
	length: Schema.Number,
}) {
	/**
	 * A human-readable description, derived from `code` when read.
	 */
	get message(): string {
		return MESSAGES[this.code];
	}
}

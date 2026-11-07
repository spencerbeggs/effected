// A redirection: an operator, an optional file descriptor, and a target that
// is never mistaken for an argument.

import { Schema } from "effect";
import { SHELL_REDIRECTION_OPERATORS } from "./internal/raw.js";
import { ShellHeredoc } from "./ShellHeredoc.js";
import { ShellWord } from "./ShellWord.js";

/**
 * The redirection operators.
 *
 * @remarks
 * `>`, `>>`, `>|` (clobber), `>&` (duplicate output), `<`, `<>`
 * (read-write), `<&` (duplicate input), `<<` and `<<-` (heredocs), `<<<`
 * (here-string), `&>` and `&>>` (stdout and stderr together). A
 * file-descriptor prefix is not part of the operator: `2>&1` is `fd` 2,
 * operator `>&`, target `1`.
 *
 * @public
 */
export const ShellRedirectionOperator = Schema.Literals(SHELL_REDIRECTION_OPERATORS);

/**
 * The union of {@link (ShellRedirectionOperator:variable)} string literals.
 *
 * @public
 */
export type ShellRedirectionOperator = typeof ShellRedirectionOperator.Type;

/**
 * One redirection of a simple command.
 *
 * @remarks
 * `fd` is the file-descriptor prefix when one is written (`2>`), `None`
 * otherwise. `target` is a {@link ShellHeredoc} for `<<` and `<<-` and a
 * {@link ShellWord} for every other operator, discriminated on `kind`. The
 * one exception is a `<<` inside a `((` the lexer had to treat as two
 * subshells, where it may be an arithmetic shift: there it takes a word
 * target and opens no heredoc, so no line after it is hidden. A
 * redirection with nothing after it records a diagnostic, and its target is
 * an empty word holding one zero-width `opaque` part, so it has no literal.
 * `start` and `end` span the fd, the operator and the target word (a
 * heredoc's body lies elsewhere in the source).
 *
 * @public
 */
export class ShellRedirection extends Schema.Class<ShellRedirection>("ShellRedirection")({
	fd: Schema.Option(Schema.Number),
	operator: ShellRedirectionOperator,
	target: Schema.Union([ShellWord, ShellHeredoc]),
	start: Schema.Number,
	end: Schema.Number,
}) {}

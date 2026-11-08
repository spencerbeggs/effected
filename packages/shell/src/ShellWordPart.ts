// The parts a shell word is made of, each carrying its quoting provenance on a
// domain-named `kind` discriminant. Nothing here is expanded: an expansion is
// a marked part with its source span, and its body is opaque text.

import { Schema } from "effect";

/**
 * Unquoted text with no expansion in it.
 *
 * @remarks
 * `value` has backslash escapes removed and backslash-newline line
 * continuations dropped, as the shell does: `b\ c` has the value `b c`.
 *
 * @public
 */
export class ShellBarePart extends Schema.Class<ShellBarePart>("ShellBarePart")({
	kind: Schema.tag("bare"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	value: Schema.String,
}) {}

/**
 * A single-quoted string, `'…'`. Everything inside is literal.
 *
 * @public
 */
export class ShellSingleQuotedPart extends Schema.Class<ShellSingleQuotedPart>("ShellSingleQuotedPart")({
	kind: Schema.tag("singleQuoted"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	value: Schema.String,
}) {}

/**
 * An ANSI-C quoted string, `$'…'`.
 *
 * @remarks
 * `value` is decoded with bash's escape table (`\n`, `\t`, `\xHH`, `\uHHHH`,
 * `\cX`, octal and the rest). A byte escape decodes to the code point of that
 * byte, and a NUL ends the string, as in bash.
 *
 * @public
 */
export class ShellAnsiCPart extends Schema.Class<ShellAnsiCPart>("ShellAnsiCPart")({
	kind: Schema.tag("ansiC"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	value: Schema.String,
}) {}

/**
 * A command substitution: `$(…)` (`style` `"dollar"`) or a backtick pair
 * (`style` `"backtick"`).
 *
 * @remarks
 * `body` is the command text the shell runs, kept opaque, and
 * `bodyStart`/`bodyEnd` the offsets of the text between the delimiters in
 * the parsed source. To inspect the commands it would run, parse it:
 * `ShellSyntax.parse(part.body)`.
 *
 * For `$(…)` the body is exactly the source between the delimiters, so the
 * nested script's offsets are relative to `bodyStart`. For a backtick pair it
 * is that source after bash's backtick escape removal: a backslash before
 * `$`, a backtick or a backslash is dropped, and inside double quotes one
 * before `"` too. That is what makes a backtick pair nested inside another
 * one, written with escaped backticks, visible to the nested parse. Offsets
 * in a nested parse of a backtick body map back to `bodyStart` only when the
 * body holds no such escape.
 *
 * @public
 */
export class ShellCommandSubstitutionPart extends Schema.Class<ShellCommandSubstitutionPart>(
	"ShellCommandSubstitutionPart",
)({
	kind: Schema.tag("commandSubstitution"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	style: Schema.Literals(["dollar", "backtick"]),
	body: Schema.String,
	bodyStart: Schema.Number,
	bodyEnd: Schema.Number,
}) {}

/**
 * A process substitution, `<(…)` or `>(…)`.
 *
 * @remarks
 * `body` is the command text between the parentheses, kept opaque; parse it
 * with `ShellSyntax.parse(part.body)` to inspect it.
 *
 * @public
 */
export class ShellProcessSubstitutionPart extends Schema.Class<ShellProcessSubstitutionPart>(
	"ShellProcessSubstitutionPart",
)({
	kind: Schema.tag("processSubstitution"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	direction: Schema.Literals(["<", ">"]),
	body: Schema.String,
	bodyStart: Schema.Number,
	bodyEnd: Schema.Number,
}) {}

/**
 * A command or process substitution: a body of shell text a caller can parse
 * to find the commands it would run.
 *
 * @public
 */
export const ShellSubstitutionPart = Schema.Union([ShellCommandSubstitutionPart, ShellProcessSubstitutionPart]);

/**
 * The union of the substitution part classes.
 *
 * @public
 */
export type ShellSubstitutionPart = typeof ShellSubstitutionPart.Type;

/**
 * A parameter expansion: `$NAME`, a positional or special parameter (`$1`,
 * `$@`, `$?`), or a braced `${…}` (`braced` `true`).
 *
 * @remarks
 * `expression` is the text after `$`, or between the braces, kept opaque:
 * `${x:-default}` has the expression `x:-default`. `substitutions` lists the
 * command and process substitutions directly inside a braced expression, so
 * neither `${x:-$(cmd)}` nor `${x:-<(cmd)}` can hide a command from a caller
 * that inspects them.
 *
 * @public
 */
export class ShellVariablePart extends Schema.Class<ShellVariablePart>("ShellVariablePart")({
	kind: Schema.tag("variable"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	braced: Schema.Boolean,
	expression: Schema.String,
	substitutions: Schema.Array(ShellSubstitutionPart),
}) {}

/**
 * Arithmetic: the expansion `$((…))` or its legacy spelling `$[…]`, or the
 * arithmetic command `((…))` (`command` `true`), which is a whole word of its
 * segment.
 *
 * @remarks
 * `body` is the expression between the parentheses or brackets, kept opaque,
 * and `substitutions` the command and process substitutions directly inside
 * it; `raw` tells the spellings apart. Inside arithmetic `<<` is a shift,
 * never a heredoc, so neither `(( x = 1 << 2 ))` nor `echo $[1 << 2]` hides a
 * line after it. A `((` whose second parenthesis closes without a
 * `)` right after it, as in `((cmd) )`, is two subshells and is lexed as
 * groups instead.
 *
 * @public
 */
export class ShellArithmeticPart extends Schema.Class<ShellArithmeticPart>("ShellArithmeticPart")({
	kind: Schema.tag("arithmetic"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	command: Schema.Boolean,
	body: Schema.String,
	bodyStart: Schema.Number,
	bodyEnd: Schema.Number,
	substitutions: Schema.Array(ShellSubstitutionPart),
}) {}

/**
 * An expansion that can sit inside double quotes or an unquoted heredoc
 * body: a parameter, a command substitution or an arithmetic expansion.
 *
 * @public
 */
export const ShellExpansionPart = Schema.Union([ShellVariablePart, ShellCommandSubstitutionPart, ShellArithmeticPart]);

/**
 * The union of the expansion part classes.
 *
 * @public
 */
export type ShellExpansionPart = typeof ShellExpansionPart.Type;

/**
 * A double-quoted string, `"…"`, or a locale-translated `$"…"`
 * (`localized` `true`).
 *
 * @remarks
 * `value` has the double-quote escapes removed (`\"`, `\\`, `\$`, a
 * backtick, a line continuation) and keeps each expansion's source text in
 * place. `expansions` lists those expansions; a double-quoted part is
 * literal only when it has none.
 *
 * @public
 */
export class ShellDoubleQuotedPart extends Schema.Class<ShellDoubleQuotedPart>("ShellDoubleQuotedPart")({
	kind: Schema.tag("doubleQuoted"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	value: Schema.String,
	localized: Schema.Boolean,
	expansions: Schema.Array(ShellExpansionPart),
}) {}

/**
 * Unquoted pathname-expansion syntax: `*`, `?` or a bracket expression
 * `[…]`. A run of adjacent glob syntax is one part.
 *
 * @public
 */
export class ShellGlobPart extends Schema.Class<ShellGlobPart>("ShellGlobPart")({
	kind: Schema.tag("glob"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
}) {}

/**
 * A span brace expansion would rewrite, such as `{commit,}` or `{1..3}`.
 *
 * @remarks
 * Marked because the shell expands it before running the command:
 * `git {commit,}` runs `git commit`, so the word must never read as the
 * literal `{commit,}`. A brace pair is marked only when a `,` or `..` sits
 * directly inside it; `{}` and `{a}` stay bare. Quoted text and expansions
 * inside the span are part of it; `substitutions` lists the command and
 * process substitutions among them, so `{a,$(cmd)}` cannot hide `cmd`.
 *
 * @public
 */
export class ShellBracePart extends Schema.Class<ShellBracePart>("ShellBracePart")({
	kind: Schema.tag("brace"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	substitutions: Schema.Array(ShellSubstitutionPart),
}) {}

/**
 * A tilde prefix the shell would expand: `~`, `~user`, `~+` or `~-` at the
 * start of a word, or after `=` or `:` in an assignment value.
 *
 * @remarks
 * `user` is the text after the tilde (empty for a bare `~`).
 *
 * @public
 */
export class ShellTildePart extends Schema.Class<ShellTildePart>("ShellTildePart")({
	kind: Schema.tag("tilde"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	user: Schema.String,
}) {}

/**
 * Text the lexer could not classify: an unterminated quote or substitution
 * running to the end of the input, an array assignment's `(…)` value, the
 * `[ … ]` subscript of a command-position word starting `NAME[` that is not
 * an assignment (`a[1<<2]`, `a[$(cmd)]=1`), or the empty target of a
 * redirection with nothing after it.
 *
 * @remarks
 * An opaque part makes its word non-literal, so a guard cannot read it as a
 * command name. A script holding one also carries a diagnostic, except for
 * an array assignment's value and a closed subscript. `substitutions` lists
 * the complete command and process substitutions found inside it: an array
 * value's elements are lexed as words, so `x=($(cmd))` lists `cmd`, and a
 * subscript's substitutions are listed the same way.
 *
 * @public
 */
export class ShellOpaquePart extends Schema.Class<ShellOpaquePart>("ShellOpaquePart")({
	kind: Schema.tag("opaque"),
	start: Schema.Number,
	end: Schema.Number,
	raw: Schema.String,
	substitutions: Schema.Array(ShellSubstitutionPart),
}) {}

/**
 * One part of a {@link ShellWord}, discriminated on `kind`.
 *
 * @public
 */
export const ShellWordPart = Schema.Union([
	ShellBarePart,
	ShellSingleQuotedPart,
	ShellDoubleQuotedPart,
	ShellAnsiCPart,
	ShellVariablePart,
	ShellCommandSubstitutionPart,
	ShellArithmeticPart,
	ShellProcessSubstitutionPart,
	ShellGlobPart,
	ShellBracePart,
	ShellTildePart,
	ShellOpaquePart,
]);

/**
 * The union of the word part classes.
 *
 * @public
 */
export type ShellWordPart = typeof ShellWordPart.Type;

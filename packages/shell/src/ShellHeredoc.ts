// A heredoc body: the input text a `<<` or `<<-` redirection feeds a command.

import { Schema } from "effect";
import { removeContinuations } from "./internal/raw.js";
import { ShellExpansionPart } from "./ShellWordPart.js";

/**
 * `text` with the leading tabs of every line removed. A line ends at a line
 * feed only, as bash reads a heredoc line, where a multiline `^` would also
 * match after a carriage return.
 */
const stripLeadingTabs = (text: string): string =>
	text
		.split("\n")
		.map((line) => line.replace(/^\t+/, ""))
		.join("\n");

/**
 * The body of a heredoc, attached as the target of the `<<` or `<<-`
 * redirection that introduced it.
 *
 * @remarks
 * `body` is the source slice `[start, end)`: the lines after the command
 * line, up to (not including) the delimiter line. The segmenter skips it, so
 * an operator inside a heredoc body is never split on. `delimiter` is the
 * delimiter word after quote removal, and `quoted` is whether any part of
 * it was quoted, which makes the body literal. An unquoted body is subject
 * to expansion, so `expansions` lists the parameters, command substitutions
 * and arithmetic in it; a quoted body has none. `stripTabs` marks `<<-`,
 * whose leading tabs bash removes: `text` is the body with them removed, and
 * `joined` the body as bash reads it, backslash-newlines joined.
 * `terminated` is `false` when no delimiter line was found and the body runs
 * to the end of the input.
 *
 * @public
 */
export class ShellHeredoc extends Schema.Class<ShellHeredoc>("ShellHeredoc")({
	kind: Schema.tag("heredoc"),
	delimiter: Schema.String,
	quoted: Schema.Boolean,
	stripTabs: Schema.Boolean,
	body: Schema.String,
	start: Schema.Number,
	end: Schema.Number,
	terminated: Schema.Boolean,
	expansions: Schema.Array(ShellExpansionPart),
}) {
	/**
	 * The body as the command reads it: with leading tabs removed from every
	 * line for `<<-`, otherwise the body unchanged.
	 */
	get text(): string {
		return this.stripTabs ? stripLeadingTabs(this.body) : this.body;
	}

	/**
	 * The body as bash reads its lines: for an unquoted delimiter, with its
	 * backslash-newlines removed; for a quoted one, `text`.
	 *
	 * @remarks
	 * bash joins a line ending in `\⏎` to the next before it reads an
	 * unquoted body, and keeps the `\⏎` in a quoted one, which is literal.
	 * An escaped backslash before a newline (`\\⏎`) is no continuation, and
	 * other escapes stay as written, as {@link ShellWord.joined} keeps them.
	 * For `<<-` the leading tabs come off each joined line, so a continued
	 * line keeps its own (`\tA\⏎\tB` reads `A\tB`), where `text` strips
	 * each physical line. Match a pattern against this, never against `body`:
	 * `$\⏎{x}` in an unquoted body is the expansion `${x}`.
	 */
	get joined(): string {
		if (this.quoted) return this.text;
		const joined = removeContinuations(this.body);
		return this.stripTabs ? stripLeadingTabs(joined) : joined;
	}
}

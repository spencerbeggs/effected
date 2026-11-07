// A heredoc body: the input text a `<<` or `<<-` redirection feeds a command.

import { Schema } from "effect";
import { ShellExpansionPart } from "./ShellWordPart.js";

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
 * whose leading tabs bash removes: `text` is the body with them removed.
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
		return this.stripTabs ? this.body.replace(/^\t+/gm, "") : this.body;
	}
}

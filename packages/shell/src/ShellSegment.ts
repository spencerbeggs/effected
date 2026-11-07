// A segment: one simple command, split from its neighbours on the control
// operators, with its words, assignments, redirections and source span.

import { Schema } from "effect";
import { SHELL_OPERATORS } from "./internal/raw.js";
import { ShellAssignment } from "./ShellAssignment.js";
import type { ShellHeredoc } from "./ShellHeredoc.js";
import { ShellRedirection } from "./ShellRedirection.js";
import { ShellWord } from "./ShellWord.js";

/**
 * The control operators that join one segment to the next.
 *
 * @remarks
 * `&&`, `||`, `;`, `|`, `|&` (pipe stdout and stderr), `&` (background), the
 * `case` terminators `;;`, `;&` and `;;&`, and `"newline"` for an unquoted
 * line break.
 *
 * @public
 */
export const ShellOperator = Schema.Literals(SHELL_OPERATORS);

/**
 * The union of {@link (ShellOperator:variable)} string literals.
 *
 * @public
 */
export type ShellOperator = typeof ShellOperator.Type;

/**
 * One simple command of a script.
 *
 * @remarks
 * `assignments` are the leading `NAME=value` words, `words` the command name
 * and its arguments, and `redirections` every redirection wherever it sits on
 * the line. `operator` is the control operator joining this segment to the
 * next, `None` for a last segment with nothing after it.
 *
 * Parentheses end a segment without being operators: the operator a segment
 * reports is the next control operator after it, so in
 * `(cd dir; make) && git commit` the `make` segment reports `&&`.
 * `groupDepth` is the number of `(` open where the segment starts. A segment
 * with no word, assignment or redirection is never produced.
 *
 * `start` and `end` span the segment's tokens in the source, excluding its
 * operator and any heredoc body.
 *
 * @public
 */
export class ShellSegment extends Schema.Class<ShellSegment>("ShellSegment")({
	words: Schema.Array(ShellWord),
	assignments: Schema.Array(ShellAssignment),
	redirections: Schema.Array(ShellRedirection),
	operator: Schema.Option(ShellOperator),
	groupDepth: Schema.Number,
	start: Schema.Number,
	end: Schema.Number,
}) {
	/**
	 * The heredocs this segment's `<<` and `<<-` redirections introduced, in
	 * source order.
	 */
	get heredocs(): ReadonlyArray<ShellHeredoc> {
		const heredocs: Array<ShellHeredoc> = [];
		for (const redirection of this.redirections) {
			if (redirection.target.kind === "heredoc") heredocs.push(redirection.target);
		}
		return heredocs;
	}
}

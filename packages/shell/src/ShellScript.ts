// A parsed script: the source, its segments, its comments and the diagnostics
// the parse recorded, with the two questions a guard asks of it.

import { Schema } from "effect";
import { ShellCommand } from "./ShellCommand.js";
import { ShellComment } from "./ShellComment.js";
import { ShellDiagnostic } from "./ShellDiagnostic.js";
import { ShellSegment } from "./ShellSegment.js";
import type { ShellWord } from "./ShellWord.js";
import type { ShellExpansionPart, ShellSubstitutionPart } from "./ShellWordPart.js";

/**
 * The result of `ShellSyntax.parse`: a command string lexed and segmented,
 * never evaluated.
 *
 * @remarks
 * `segments` are the simple commands in source order. `comments` are the
 * `#` comments, which are never words. `diagnostics` record anything the
 * parse could not finish, such as an unterminated quote; a script with
 * diagnostics is still complete in shape, with the unfinished text held in
 * an `opaque` part. Every offset is a UTF-16 index into `source`.
 *
 * @public
 */
export class ShellScript extends Schema.Class<ShellScript>("ShellScript")({
	source: Schema.String,
	segments: Schema.Array(ShellSegment),
	comments: Schema.Array(ShellComment),
	diagnostics: Schema.Array(ShellDiagnostic),
}) {
	/**
	 * Every segment resolved to the command it runs, in source order.
	 *
	 * @remarks
	 * One entry per segment, through `ShellCommand.fromSegment`: reserved
	 * words skipped, wrappers unwrapped, the name read only when literal.
	 * Commands inside command and process substitutions are not included;
	 * reach them through {@link ShellScript.substitutions}.
	 *
	 * @example
	 * ```ts
	 * import { ShellSyntax } from "@effected/shell";
	 * import { Option } from "effect";
	 *
	 * const script = ShellSyntax.parse('git add -A && git commit -m "wip"');
	 * console.log(script.commands().map((c) => [Option.getOrUndefined(c.name), c.args.map((a) => a.raw)]));
	 * // => [ [ 'git', [ 'add', '-A' ] ], [ 'git', [ 'commit', '-m', '"wip"' ] ] ]
	 * ```
	 *
	 * @returns The resolved commands.
	 */
	commands(): ReadonlyArray<ShellCommand> {
		return this.segments.map((segment) => ShellCommand.fromSegment(segment));
	}

	/**
	 * Every command and process substitution at this level, in source order.
	 *
	 * @remarks
	 * Collected from words, assignment subscripts and values (array values included),
	 * redirection targets, double-quoted strings, braced parameter expansions,
	 * arithmetic expansions and commands, brace-expansion spans, opaque parts,
	 * and unquoted heredoc bodies, so a command cannot hide from a caller that
	 * walks them. Substitutions nested inside another substitution's body are
	 * not listed: parse the body with `ShellSyntax.parse(part.body)` and ask
	 * the nested script. The caller owns the recursion and its depth, and a
	 * guard that stops at a depth cap must refuse what is left, not drop it.
	 *
	 * @returns The substitutions, sorted by `start`.
	 */
	substitutions(): ReadonlyArray<ShellSubstitutionPart> {
		const found: Array<ShellSubstitutionPart> = [];
		const expansion = (part: ShellExpansionPart): void => {
			if (part.kind === "commandSubstitution") found.push(part);
			else for (const inner of part.substitutions) found.push(inner);
		};
		// Every kind that holds substitutions is named, so a new kind fails to
		// compile here rather than silently hiding its substitutions.
		const word = (w: ShellWord): void => {
			for (const part of w.parts) {
				switch (part.kind) {
					case "commandSubstitution":
					case "processSubstitution":
						found.push(part);
						break;
					case "variable":
					case "arithmetic":
					case "brace":
					case "opaque":
						for (const inner of part.substitutions) found.push(inner);
						break;
					case "doubleQuoted":
						for (const inner of part.expansions) expansion(inner);
						break;
					case "bare":
					case "singleQuoted":
					case "ansiC":
					case "glob":
					case "tilde":
						break;
					default: {
						const unhandled: never = part;
						void unhandled;
					}
				}
			}
		};
		for (const segment of this.segments) {
			for (const assignment of segment.assignments) {
				for (const inner of assignment.subscript) found.push(inner);
				word(assignment.value);
			}
			for (const w of segment.words) word(w);
			for (const redirection of segment.redirections) {
				const target = redirection.target;
				if (target.kind === "heredoc") for (const inner of target.expansions) expansion(inner);
				else word(target);
			}
		}
		return found.sort((a, b) => a.start - b.start);
	}
}

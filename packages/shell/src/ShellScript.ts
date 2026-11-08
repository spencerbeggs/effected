// A parsed script: the source, its segments, its comments and the diagnostics
// the parse recorded, with the questions a guard asks of it, and the walk
// through every nested substitution that `allCommands` returns.

import { Option, Schema } from "effect";
import { materialize } from "./materialize.js";
import { ShellCommand } from "./ShellCommand.js";
import { ShellComment } from "./ShellComment.js";
import { ShellDiagnostic } from "./ShellDiagnostic.js";
import { ShellSegment } from "./ShellSegment.js";
import type { ShellWord } from "./ShellWord.js";
import type { ShellExpansionPart } from "./ShellWordPart.js";
import { ShellSubstitutionPart } from "./ShellWordPart.js";

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
	 * {@link ShellScript.allCommands} reaches them at every depth.
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
	 * The default {@link ShellScript.allCommands} depth cap.
	 *
	 * @remarks
	 * 16 levels of substitution inside substitution. Real commands rarely
	 * pass 3 (a commit message heredoc inside `$(cat <<'EOF' … )` is 1). The
	 * cap also sets the walk's character budget, `maxDepth` times the source
	 * length.
	 */
	static readonly defaultMaxDepth: number = 16;

	/**
	 * The most records one {@link ShellScript.allCommands} walk holds:
	 * scripts (the top-level one included) and truncations together, 10,000.
	 *
	 * @remarks
	 * The substitution that would pass it is recorded as one more
	 * {@link ShellTruncation}, with the reason `"budget"`, and the walk
	 * stops. Real commands are far inside it: across 56,176 agent Bash tool
	 * calls the most substitutions one command held, at every depth, was 14.
	 */
	static readonly walkRecordLimit: number = 10_000;

	/**
	 * The most characters of substitution bodies one
	 * {@link ShellScript.allCommands} walk lexes, whatever `maxDepth`:
	 * 64 MiB of UTF-16 code units.
	 *
	 * @remarks
	 * A body that would pass it is recorded as a {@link ShellTruncation} with
	 * the reason `"budget"`, and the walk stops.
	 */
	static readonly walkCharacterLimit: number = 67_108_864;

	/**
	 * Every command at every depth: this script and the body of every
	 * command and process substitution in it, parsed and walked to `maxDepth`.
	 *
	 * @remarks
	 * The walk is the script plus one {@link ShellNestedScript} per distinct
	 * substitution body, breadth first: every body at depth 1 in source
	 * order, then every body at depth 2, and so on. The script is depth 0 and
	 * a body is one deeper than the script it sits in. `maxDepth` (default
	 * {@link ShellScript.defaultMaxDepth}) is the deepest body parsed: a
	 * substitution whose body would sit deeper is not parsed but recorded as a
	 * {@link ShellTruncation} with the reason `"depth"`, never dropped, so
	 * `truncated` is `true` and a guard must refuse the script, since that
	 * body may run anything. `maxDepth: 0` parses no body and truncates at
	 * every substitution.
	 *
	 * Each nested script is a full parse, with its own `diagnostics`, which a
	 * guard reads as it reads the top-level ones. Backtick bodies are parsed
	 * after bash's escape removal, as `body` holds them.
	 *
	 * The work is bounded by a budget the walk enforces, not one it derives
	 * from the shape of the input. A substitution is identified by its span in
	 * the text it was found in, so one listed both by a script and inside
	 * another listed substitution's body is parsed once, at the shallowest
	 * depth it is reached. The bodies lexed total at most `maxDepth` times the
	 * source length, at most {@link ShellScript.walkCharacterLimit} characters
	 * and at most {@link ShellScript.walkRecordLimit} records (scripts and truncations together); the body that
	 * would pass any of these is recorded as a truncation with the reason
	 * `"budget"` and the walk stops, so a guard refuses it like any other
	 * truncation. For a fixed cap the walk is linear in the input. It holds
	 * its pending substitutions on a queue, never the call stack, and never
	 * throws.
	 *
	 * `maxDepth` must be a non-negative number: anything else (`NaN`, a
	 * negative number, a string, a bigint) reads as 0, which truncates every
	 * substitution, and a fraction rounds down. An absent or `null` `maxDepth`
	 * is the default. `Infinity` lifts the depth
	 * cap but not the character and script limits.
	 *
	 * @example
	 * ```ts
	 * import { ShellSyntax } from "@effected/shell";
	 * import { Option } from "effect";
	 *
	 * const walk = ShellSyntax.parse('echo "$(git log -1 --format=$(cat fmt))"').allCommands();
	 * console.log(walk.commands().map((c) => Option.getOrUndefined(c.name)), walk.truncated);
	 * // => [ 'echo', 'git', 'cat' ] false
	 * const capped = ShellSyntax.parse("echo $(echo $(git commit))").allCommands({ maxDepth: 1 });
	 * console.log(capped.truncated, capped.truncations.map((t) => [t.reason, t.depth, t.substitution.body]));
	 * // => true [ [ 'depth', 2, 'git commit' ] ]
	 * ```
	 *
	 * @param options - `maxDepth`, the deepest substitution body to parse.
	 * @returns The walk: every script parsed and every substitution it stopped at.
	 */
	allCommands(options?: { readonly maxDepth?: number }): ShellCommandWalk {
		const requested: unknown = options?.maxDepth ?? ShellScript.defaultMaxDepth;
		// `|| 0` turns -0 into 0; every non-number and every negative is 0.
		const maxDepth = typeof requested === "number" && requested >= 0 ? Math.floor(requested) || 0 : 0;
		// `|| 0` covers `Infinity * 0` for an empty source.
		const budget = Math.min(maxDepth * this.source.length || 0, ShellScript.walkCharacterLimit);
		const scripts: Array<ShellNestedScript> = [
			ShellNestedScript.make({ depth: 0, script: this, substitution: Option.none(), parent: Option.none() }),
		];
		// Where each script's source sits: an exact slice of a frame's text at
		// `base`, or (a backtick body after escape removal) a frame of its own.
		const frames: Array<{ readonly frame: number; readonly base: number }> = [{ frame: 0, base: 0 }];
		let nextFrame = 1;
		const truncations: Array<ShellTruncation> = [];
		const queue: Array<{ readonly part: ShellSubstitutionPart; readonly depth: number; readonly parent: number }> = [];
		// Substitutions already queued, by their span in their frame. The queue
		// runs breadth first, so the first time a span is queued is its
		// shallowest depth, and a later sighting is skipped.
		const seen = new Set<string>();
		// Each queued substitution becomes one record, so the queue never
		// holds more than the record limit allows; the first one left out is
		// the budget truncation the walk ends with.
		let overflow: (typeof queue)[number] | undefined;
		const enqueue = (index: number): void => {
			const entry = scripts[index] as ShellNestedScript;
			const { frame, base } = frames[index] as { readonly frame: number; readonly base: number };
			for (const part of entry.script.substitutions()) {
				const key = `${frame}:${base + part.start}:${base + part.end}`;
				if (seen.has(key)) continue;
				if (queue.length >= ShellScript.walkRecordLimit - 1) {
					overflow ??= { part, depth: entry.depth + 1, parent: index };
					return;
				}
				seen.add(key);
				queue.push({ part, depth: entry.depth + 1, parent: index });
			}
		};
		enqueue(0);
		let lexed = 0;
		for (let head = 0; head < queue.length; head += 1) {
			const { part, depth, parent } = queue[head] as (typeof queue)[number];
			// Scripts and truncation records share one limit, so a mass of
			// substitutions past the cap ends in one budget record too.
			const full = scripts.length + truncations.length >= ShellScript.walkRecordLimit;
			if (depth > maxDepth && !full) {
				truncations.push(ShellTruncation.make({ reason: "depth", depth, substitution: part, parent }));
				continue;
			}
			if (full || lexed + part.body.length > budget) {
				truncations.push(ShellTruncation.make({ reason: "budget", depth, substitution: part, parent }));
				break;
			}
			lexed += part.body.length;
			const holder = scripts[parent] as ShellNestedScript;
			const at = frames[parent] as { readonly frame: number; readonly base: number };
			const exact = holder.script.source.slice(part.bodyStart, part.bodyEnd) === part.body;
			frames.push(exact ? { frame: at.frame, base: at.base + part.bodyStart } : { frame: nextFrame++, base: 0 });
			scripts.push(
				ShellNestedScript.make({
					depth,
					script: ShellScript.make({ source: part.body, ...materialize(part.body) }),
					substitution: Option.some(part),
					parent: Option.some(parent),
				}),
			);
			enqueue(scripts.length - 1);
		}
		if (overflow !== undefined && !truncations.some((t) => t.reason === "budget")) {
			const { part, depth, parent } = overflow;
			truncations.push(ShellTruncation.make({ reason: "budget", depth, substitution: part, parent }));
		}
		return ShellCommandWalk.make({ maxDepth, scripts, truncations });
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
	 * not listed: {@link ShellScript.allCommands} parses each body and walks
	 * them at every depth, or parse one with `ShellSyntax.parse(part.body)`
	 * and ask the nested script.
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

/**
 * One script in a {@link ShellCommandWalk}: the top-level script, or the
 * parsed body of a command or process substitution.
 *
 * @remarks
 * `depth` is 0 for the top-level script and one more than its parent's for a
 * body. `substitution` is the part whose `body` was parsed, with offsets into
 * the parent's `source`, and `parent` the parent's index in
 * `ShellCommandWalk.scripts`; both are `None` for the top-level script.
 *
 * @public
 */
export class ShellNestedScript extends Schema.Class<ShellNestedScript>("ShellNestedScript")({
	depth: Schema.Number,
	script: ShellScript,
	substitution: Schema.Option(ShellSubstitutionPart),
	parent: Schema.Option(Schema.Number),
}) {}

/**
 * A substitution {@link ShellScript.allCommands} did not parse.
 *
 * @remarks
 * `reason` is `"depth"` when its body sits deeper than `maxDepth`, and
 * `"budget"` when parsing it would pass the walk's character or script
 * budget, where the walk stops, so the substitutions after it are not
 * listed. `depth` is the depth its body would have had, `substitution` the
 * part (its offsets are into the parent's `source`), and `parent` the index
 * in `ShellCommandWalk.scripts` of the script it sits in. The body may run
 * anything, so a guard that meets one must refuse.
 *
 * @public
 */
export class ShellTruncation extends Schema.Class<ShellTruncation>("ShellTruncation")({
	reason: Schema.Literals(["depth", "budget"]),
	depth: Schema.Number,
	substitution: ShellSubstitutionPart,
	parent: Schema.Number,
}) {}

/**
 * The result of {@link ShellScript.allCommands}: every script it parsed and
 * every substitution it stopped at.
 *
 * @remarks
 * `scripts` starts with the top-level script and then holds each distinct
 * substitution body, breadth first. `truncations` lists the substitutions
 * the walk did not parse, past `maxDepth` or past its budget, in the order
 * it reached them; a guard must refuse when it is not empty, which
 * `truncated` tells.
 *
 * @public
 */
export class ShellCommandWalk extends Schema.Class<ShellCommandWalk>("ShellCommandWalk")({
	maxDepth: Schema.Number,
	scripts: Schema.Array(ShellNestedScript),
	truncations: Schema.Array(ShellTruncation),
}) {
	/**
	 * Whether the walk stopped at a substitution: `truncations` is not empty.
	 * A guard must refuse a truncated walk.
	 */
	get truncated(): boolean {
		return this.truncations.length > 0;
	}

	/**
	 * Every command of every script in the walk, in `scripts` order.
	 *
	 * @remarks
	 * `ShellScript.commands` of each script, concatenated. It does not name
	 * the commands of a truncated substitution, so read `truncated` too.
	 *
	 * @returns The commands.
	 */
	commands(): ReadonlyArray<ShellCommand> {
		return this.scripts.flatMap((entry) => entry.script.commands());
	}
}

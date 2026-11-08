// The entry point: lex and segment a command string into a ShellScript.
//
// The lexing and materializing live in `materialize.ts`, which
// `ShellScript.allCommands` shares.

import { Effect } from "effect";
import { materialize } from "./materialize.js";
import { ShellScript } from "./ShellScript.js";

/**
 * Lex and segment shell command strings. Never evaluates, never fails.
 *
 * @remarks
 * The analyzer for untrusted command text, such as a Bash tool call an
 * agent hook inspects before it runs. It answers which simple commands the
 * string would run, with which words, and where in the source each one is.
 * Nothing is expanded or executed: variables, globs, `$(…)` and backticks
 * are recorded as marked parts with their spans.
 *
 * `parse` is total: input the lexer cannot finish becomes an `opaque` part
 * plus a diagnostic on the script, never an exception, so a guard cannot
 * crash or fall open on odd input. It is the synchronous primitive, for hook
 * adapters that run as synchronous host processes; `parseEffect` is the same
 * call behind a tracing span.
 *
 * The result is deliberately not core `CommandLine`'s vocabulary, so it
 * cannot be passed straight to a spawner. Anything to execute goes through
 * `CommandLine` after validation.
 *
 * @public
 */
export class ShellSyntax {
	private constructor() {}

	/**
	 * Lex and segment `input` into a {@link ShellScript}.
	 *
	 * @remarks
	 * Total and synchronous: it returns for every string, in time linear in its
	 * length, and never throws. Nesting depth is held on explicit stacks, so a
	 * megabyte of `$(` is one pass.
	 *
	 * @example
	 * ```ts
	 * import { ShellSyntax } from "@effected/shell";
	 * import { Option } from "effect";
	 *
	 * const script = ShellSyntax.parse("cd pkg && FOO=1 git commit -m 'fix: it'");
	 * console.log(script.segments.map((s) => s.words.map((w) => Option.getOrUndefined(w.literal))));
	 * // => [ [ 'cd', 'pkg' ], [ 'git', 'commit', '-m', 'fix: it' ] ]
	 * ```
	 *
	 * @param input - The command string, as it would be handed to `bash -c`.
	 * @returns The parsed script.
	 */
	static parse(input: string): ShellScript {
		return ShellScript.make({ source: input, ...materialize(input) });
	}

	/**
	 * {@link ShellSyntax.parse} inside an `Effect`, behind the
	 * `ShellSyntax.parseEffect` span.
	 *
	 * @remarks
	 * The error channel is `never`: parsing does not fail. The span is the
	 * whole difference from `parse`.
	 *
	 * @param input - The command string.
	 * @returns An effect succeeding with the parsed script.
	 */
	static readonly parseEffect: (input: string) => Effect.Effect<ShellScript> = Effect.fn("ShellSyntax.parseEffect")(
		(input: string) => Effect.sync(() => ShellSyntax.parse(input)),
	);
}

// The entry point: lex and segment a command string into a ShellScript.
//
// Cycle firewall: the engine under `internal/` emits raw records and imports
// no public module; this module materializes them into the Schema classes.

import { Effect, Option } from "effect";
import { lex } from "./internal/lexer.js";
import type {
	RawCommandSubstitution,
	RawExpansion,
	RawHeredoc,
	RawPart,
	RawProcessSubstitution,
	RawRedirection,
	RawSegment,
	RawSubstitution,
	RawWord,
} from "./internal/raw.js";
import { ShellAssignment } from "./ShellAssignment.js";
import { ShellComment } from "./ShellComment.js";
import { ShellDiagnostic } from "./ShellDiagnostic.js";
import { ShellHeredoc } from "./ShellHeredoc.js";
import { ShellRedirection } from "./ShellRedirection.js";
import { ShellScript } from "./ShellScript.js";
import { ShellSegment } from "./ShellSegment.js";
import { ShellWord } from "./ShellWord.js";
import type { ShellExpansionPart, ShellSubstitutionPart, ShellWordPart } from "./ShellWordPart.js";
import {
	ShellAnsiCPart,
	ShellArithmeticPart,
	ShellBarePart,
	ShellBracePart,
	ShellCommandSubstitutionPart,
	ShellDoubleQuotedPart,
	ShellGlobPart,
	ShellOpaquePart,
	ShellProcessSubstitutionPart,
	ShellSingleQuotedPart,
	ShellTildePart,
	ShellVariablePart,
} from "./ShellWordPart.js";

const commandSubstitution = (source: string, raw: RawCommandSubstitution): ShellCommandSubstitutionPart =>
	ShellCommandSubstitutionPart.make({
		start: raw.start,
		end: raw.end,
		raw: source.slice(raw.start, raw.end),
		style: raw.style,
		body: raw.body,
		bodyStart: raw.bodyStart,
		bodyEnd: raw.bodyEnd,
	});

const processSubstitution = (source: string, raw: RawProcessSubstitution): ShellProcessSubstitutionPart =>
	ShellProcessSubstitutionPart.make({
		start: raw.start,
		end: raw.end,
		raw: source.slice(raw.start, raw.end),
		direction: raw.direction,
		body: source.slice(raw.bodyStart, raw.bodyEnd),
		bodyStart: raw.bodyStart,
		bodyEnd: raw.bodyEnd,
	});

const substitution = (source: string, raw: RawSubstitution): ShellSubstitutionPart =>
	raw.kind === "commandSubstitution" ? commandSubstitution(source, raw) : processSubstitution(source, raw);

const substitutions = (source: string, raws: ReadonlyArray<RawSubstitution>): Array<ShellSubstitutionPart> =>
	raws.map((inner) => substitution(source, inner));

const expansion = (source: string, raw: RawExpansion): ShellExpansionPart => {
	switch (raw.kind) {
		case "commandSubstitution":
			return commandSubstitution(source, raw);
		case "variable":
			return ShellVariablePart.make({
				start: raw.start,
				end: raw.end,
				raw: source.slice(raw.start, raw.end),
				braced: raw.braced,
				expression: source.slice(raw.expressionStart, raw.expressionEnd),
				substitutions: substitutions(source, raw.substitutions),
			});
		case "arithmetic":
			return ShellArithmeticPart.make({
				start: raw.start,
				end: raw.end,
				raw: source.slice(raw.start, raw.end),
				command: raw.command,
				body: source.slice(raw.bodyStart, raw.bodyEnd),
				bodyStart: raw.bodyStart,
				bodyEnd: raw.bodyEnd,
				substitutions: substitutions(source, raw.substitutions),
			});
	}
};

const part = (source: string, raw: RawPart): ShellWordPart => {
	const span = { start: raw.start, end: raw.end, raw: source.slice(raw.start, raw.end) };
	switch (raw.kind) {
		case "bare":
			return ShellBarePart.make({ ...span, value: raw.value });
		case "singleQuoted":
			return ShellSingleQuotedPart.make({ ...span, value: raw.value });
		case "ansiC":
			return ShellAnsiCPart.make({ ...span, value: raw.value });
		case "doubleQuoted":
			return ShellDoubleQuotedPart.make({
				...span,
				value: raw.value,
				localized: raw.localized,
				expansions: raw.expansions.map((inner) => expansion(source, inner)),
			});
		case "variable":
		case "commandSubstitution":
		case "arithmetic":
			return expansion(source, raw);
		case "processSubstitution":
			return processSubstitution(source, raw);
		case "glob":
			return ShellGlobPart.make(span);
		case "brace":
			return ShellBracePart.make({ ...span, substitutions: substitutions(source, raw.substitutions) });
		case "tilde":
			return ShellTildePart.make({ ...span, user: raw.user });
		case "opaque":
			return ShellOpaquePart.make({ ...span, substitutions: substitutions(source, raw.substitutions) });
	}
};

const word = (source: string, raw: RawWord): ShellWord =>
	ShellWord.make({
		start: raw.start,
		end: raw.end,
		raw: source.slice(raw.start, raw.end),
		parts: raw.parts.map((inner) => part(source, inner)),
	});

const heredoc = (source: string, raw: RawHeredoc): ShellHeredoc =>
	ShellHeredoc.make({
		delimiter: raw.delimiter,
		quoted: raw.quoted,
		stripTabs: raw.stripTabs,
		body: source.slice(raw.start, raw.end),
		start: raw.start,
		end: raw.end,
		terminated: raw.terminated,
		expansions: raw.expansions.map((inner) => expansion(source, inner)),
	});

const redirection = (source: string, raw: RawRedirection): ShellRedirection =>
	ShellRedirection.make({
		fd: raw.fd === undefined ? Option.none() : Option.some(raw.fd),
		operator: raw.operator,
		target: "kind" in raw.target ? heredoc(source, raw.target) : word(source, raw.target),
		start: raw.start,
		end: raw.end,
	});

const segment = (source: string, raw: RawSegment): ShellSegment =>
	ShellSegment.make({
		words: raw.words.map((inner) => word(source, inner)),
		assignments: raw.assignments.map((inner) =>
			ShellAssignment.make({
				name: inner.name,
				append: inner.append,
				value: word(source, inner.value),
				subscript: substitutions(source, inner.subscript),
				start: inner.start,
				end: inner.end,
				raw: source.slice(inner.start, inner.end),
			}),
		),
		redirections: raw.redirections.map((inner) => redirection(source, inner)),
		operator: raw.operator === undefined ? Option.none() : Option.some(raw.operator),
		groupDepth: raw.groupDepth,
		start: raw.start,
		end: raw.end,
	});

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
		const raw = lex(input);
		return ShellScript.make({
			source: input,
			segments: raw.segments.map((inner) => segment(input, inner)),
			comments: raw.comments.map((inner) =>
				ShellComment.make({ text: input.slice(inner.start + 1, inner.end), start: inner.start, end: inner.end }),
			),
			diagnostics: raw.diagnostics.map((inner) => ShellDiagnostic.make(inner)),
		});
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

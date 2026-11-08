// Materialization: lex a command string and turn the engine's raw records
// into the Schema classes. Cycle firewall: the engine under `internal/` emits
// raw records and imports no public module, and this is the only module that
// imports `internal/lexer.ts`. `ShellSyntax.parse` and
// `ShellScript.allCommands` both build their scripts from it, so neither
// imports the other.

import { Option } from "effect";
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

/** The fields of a `ShellScript` parsed from `input`, everything but `source`. */
export interface MaterializedScript {
	readonly segments: ReadonlyArray<ShellSegment>;
	readonly comments: ReadonlyArray<ShellComment>;
	readonly diagnostics: ReadonlyArray<ShellDiagnostic>;
}

/** Lex `input` and materialize its records. Total, synchronous, linear. */
export const materialize = (input: string): MaterializedScript => {
	const raw = lex(input);
	return {
		segments: raw.segments.map((inner) => segment(input, inner)),
		comments: raw.comments.map((inner) =>
			ShellComment.make({ text: input.slice(inner.start + 1, inner.end), start: inner.start, end: inner.end }),
		),
		diagnostics: raw.diagnostics.map((inner) => ShellDiagnostic.make(inner)),
	};
};

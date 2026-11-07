// A plain-data projection of a parse, the shape the fixture corpus states its
// expectations in. A word with a literal projects to that string; a word
// without one projects to its raw text and part kinds, so a fixture can never
// pass by reading an expansion as a literal.

import { Option } from "effect";
import type { ShellCommand, ShellRedirection, ShellScript, ShellSegment, ShellWord } from "../../src/index.js";

export type ProjectedWord = string | { readonly raw: string; readonly kinds: ReadonlyArray<string> };

export interface ProjectedHeredoc {
	readonly heredoc: string;
	readonly quoted: boolean;
	readonly body: string;
}

export interface ProjectedSegment {
	readonly words: ReadonlyArray<ProjectedWord>;
	readonly assignments: ReadonlyArray<readonly [string, ProjectedWord]>;
	readonly redirections: ReadonlyArray<readonly [number | null, string, ProjectedWord | ProjectedHeredoc]>;
	readonly operator: string | null;
	readonly groupDepth: number;
}

export interface ProjectedScript {
	readonly segments: ReadonlyArray<ProjectedSegment>;
	readonly comments: ReadonlyArray<string>;
	readonly diagnostics: ReadonlyArray<string>;
}

export const projectWord = (word: ShellWord): ProjectedWord =>
	Option.match(word.literal, {
		onSome: (value) => value,
		onNone: () => ({ raw: word.raw, kinds: word.parts.map((part) => part.kind) }),
	});

const projectRedirection = (
	redirection: ShellRedirection,
): readonly [number | null, string, ProjectedWord | ProjectedHeredoc] => {
	const target = redirection.target;
	return [
		Option.getOrNull(redirection.fd),
		redirection.operator,
		target.kind === "heredoc"
			? { heredoc: target.delimiter, quoted: target.quoted, body: target.body }
			: projectWord(target),
	];
};

export const projectSegment = (segment: ShellSegment): ProjectedSegment => ({
	words: segment.words.map(projectWord),
	assignments: segment.assignments.map((assignment) => [assignment.name, projectWord(assignment.value)] as const),
	redirections: segment.redirections.map(projectRedirection),
	operator: Option.getOrNull(segment.operator),
	groupDepth: segment.groupDepth,
});

export const projectScript = (script: ShellScript): ProjectedScript => ({
	segments: script.segments.map(projectSegment),
	comments: script.comments.map((comment) => comment.text),
	diagnostics: script.diagnostics.map((diagnostic) => diagnostic.code),
});

/** A command as `[name | null, ...args]`. */
export const projectCommand = (command: ShellCommand): ReadonlyArray<ProjectedWord | null> => [
	Option.getOrNull(command.name),
	...command.args.map(projectWord),
];

/** Fill a fixture's omitted keys with their defaults. */
export const normalizeExpected = (expect: {
	readonly segments: ReadonlyArray<Partial<ProjectedSegment> & { readonly words: ReadonlyArray<ProjectedWord> }>;
	readonly comments?: ReadonlyArray<string>;
	readonly diagnostics?: ReadonlyArray<string>;
}): ProjectedScript => ({
	segments: expect.segments.map((segment) => ({
		words: segment.words,
		assignments: segment.assignments ?? [],
		redirections: segment.redirections ?? [],
		operator: segment.operator ?? null,
		groupDepth: segment.groupDepth ?? 0,
	})),
	comments: expect.comments ?? [],
	diagnostics: expect.diagnostics ?? [],
});

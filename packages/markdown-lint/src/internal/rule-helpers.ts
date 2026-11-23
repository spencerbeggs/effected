// What the built-in rule ports share: a settings reader that falls back on a
// wrong-typed value, the content lines markdownlint hands its rules (after
// the front matter), line offsets, and the code-block line ranges the
// micromark tokens markdownlint reads would give, derived from the kit tree.

import type { Code } from "@effected/markdown";
import { Option } from "effect";
import type { LintContext } from "../LintContext.js";

/** Read setting `name`, or `fallback` when it is absent or fails `guard`. @internal */
export const setting = <A>(
	config: Readonly<Record<string, unknown>>,
	name: string,
	guard: (value: unknown) => value is A,
	fallback: A,
): A => {
	const value = config[name];
	return guard(value) ? value : fallback;
};

/** @internal */
export const isNumber = (value: unknown): value is number => typeof value === "number";

/** @internal */
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** @internal */
export const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

/** Add lines `start` to `end`, inclusive, to `set`. @internal */
export const addRange = (set: Set<number>, start: number, end: number): void => {
	for (let line = start; line <= end; line++) set.add(line);
};

/** The offset each line of `source` starts at; index 0 is line 1. @internal */
export const lineStarts = (source: string): Array<number> => {
	const starts = [0];
	for (const match of source.matchAll(/\r\n?|\n/g)) starts.push(match.index + match[0].length);
	return starts;
};

/** The 1-based line markdownlint's `params.lines` starts at: the first after its front matter. @internal */
export const firstContentLine = (context: LintContext): number =>
	Option.match(context.frontmatter, { onNone: () => 1, onSome: (block) => block.lineCount + 1 });

// A closed fence ends on its closing fence line: only container markers,
// indentation and at least the opener's run of its character.
const isClosingFence = (line: string, node: Code): boolean => {
	const match = /^(?:[ \t]*>)*[ \t]*(([`~])\2*)[ \t]*$/.exec(line);
	return match !== null && match[2] === node.fenceChar && (match[1] as string).length >= (node.fenceLength ?? 3);
};

/**
 * The 1-based line micromark's `codeFenced` token ends on. A closed fence
 * ends on its closing fence line; micromark ends an unclosed fence at the
 * start of the line after its last, when a line follows it.
 * @internal
 */
export const fencedEndLine = (context: LintContext, node: Code, starts: ReadonlyArray<number>): number => {
	const start = node.position.start.line;
	const end = node.position.end.line;
	const closed = end > start && isClosingFence(context.lines[end - 1] ?? "", node);
	return closed || starts[end] === undefined ? end : end + 1;
};

/**
 * The lines between a fenced code block's fences, as micromark's
 * `codeFenced` token gives them: `startLine + 1` to `endLine - 1`.
 * @internal
 */
export const fencedInterior = (
	context: LintContext,
	node: Code,
	starts: ReadonlyArray<number>,
): { readonly start: number; readonly end: number } => ({
	start: node.position.start.line + 1,
	end: fencedEndLine(context, node, starts) - 1,
});

/** Every kit code node, fenced or indented. @internal */
export const codeNodes = (context: LintContext): ReadonlyArray<Code> =>
	context.document.findAll("code") as ReadonlyArray<Code>;

/**
 * Every line of every code block, fences included, as micromark's
 * `codeFenced` and `codeIndented` tokens span them.
 * @internal
 */
export const codeBlockLines = (context: LintContext, starts: ReadonlyArray<number>): Set<number> => {
	const lines = new Set<number>();
	for (const node of codeNodes(context)) {
		const end = node.fenceChar === undefined ? node.position.end.line : fencedEndLine(context, node, starts);
		addRange(lines, node.position.start.line, end);
	}
	return lines;
};

/** Every line from each node's first to its last. @internal */
export const nodeLines = (
	nodes: Iterable<{
		readonly position: { readonly start: { readonly line: number }; readonly end: { readonly line: number } };
	}>,
): Set<number> => {
	const lines = new Set<number>();
	for (const node of nodes) addRange(lines, node.position.start.line, node.position.end.line);
	return lines;
};

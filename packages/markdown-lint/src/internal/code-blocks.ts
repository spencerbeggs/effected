// Code-block extents as micromark's `codeFenced` and `codeIndented` tokens
// give them, derived from the kit tree.

import type { Code } from "@effected/markdown";
import type { LintContext } from "../LintContext.js";
import type { LineRange } from "./lines.js";
import { addRange } from "./lines.js";

// A closed fence ends on its closing fence line: only container markers,
// indentation and at least the opener's run of its character.
const isClosingFence = (line: string, node: Code): boolean => {
	const match = /^(?:[ \t]*>)*[ \t]*(([`~])\2*)[ \t]*$/.exec(line);
	return match !== null && match[2] === node.fenceChar && (match[1] as string).length >= (node.fenceLength ?? 3);
};

/**
 * The 1-based line micromark's `codeFenced` token ends on. A closed fence
 * ends on its closing fence line. An unclosed fence ends where the kit's
 * node ends, except that micromark's token takes the next line break too,
 * ending at the start of the following line, when that line starts a new
 * container (a list item, blockquote or footnote definition), or when it is
 * the document's empty last line and no blockquote holds the fence (a list
 * item or footnote continues onto an empty line; a blockquote does not).
 * @internal
 */
export const fencedEndLine = (context: LintContext, node: Code, starts: ReadonlyArray<number>): number => {
	const start = node.position.start.line;
	const end = node.position.end.line;
	const closed = end > start && isClosingFence(context.lines[end - 1] ?? "", node);
	if (closed || starts[end] === undefined) return end;
	const next = end + 1;
	const containers = context.document.findAll(
		(candidate) =>
			candidate.type === "blockquote" || candidate.type === "listItem" || candidate.type === "footnoteDefinition",
	);
	if (containers.some((container) => container.position.start.line === next)) return next;
	const emptyLast = next === context.lines.length && context.lines[next - 1] === "";
	const quoted = containers.some(
		(container) =>
			container.type === "blockquote" &&
			container.position.start.offset <= node.position.start.offset &&
			node.position.end.offset <= container.position.end.offset,
	);
	return emptyLast && !quoted ? next : end;
};

/**
 * The lines between a fenced code block's fences, as micromark's
 * `codeFenced` token gives them: `startLine + 1` to `endLine - 1`.
 * @internal
 */
export const fencedInterior = (context: LintContext, node: Code, starts: ReadonlyArray<number>): LineRange => ({
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

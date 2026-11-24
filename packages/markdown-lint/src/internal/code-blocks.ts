// Code-block extents as micromark's `codeFenced` and `codeIndented` tokens
// give them, derived from the kit tree.

import type { Code } from "@effected/markdown";
import type { LintContext } from "../LintContext.js";
import { containerNodes, contentInContainers } from "./containers.js";
import type { LineRange } from "./lines.js";
import { addRange } from "./lines.js";
import { perReading } from "./memo.js";

// A closed fence ends on its closing fence line: only container markers,
// indentation and at least the opener's run of its character.
const isClosingFence = (line: string, node: Code): boolean => {
	const match = /^(?:[ \t]*>)*[ \t]*(([`~])\2*)[ \t]*$/.exec(line);
	return match !== null && match[2] === node.fenceChar && (match[1] as string).length >= (node.fenceLength ?? 3);
};

// The lines a container (a blockquote, list item or footnote definition) starts on.
const containerStartLines: (context: LintContext) => ReadonlySet<number> = perReading(
	(context) => new Set(containerNodes(context).map((container) => container.position.start.line)),
);

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
export const fencedEndLine = (context: LintContext, node: Code): number => {
	const start = node.position.start.line;
	const end = node.position.end.line;
	const closed = end > start && isClosingFence(context.lines[end - 1] ?? "", node);
	if (closed || end >= context.lines.length) return end;
	const next = end + 1;
	if (containerStartLines(context).has(next)) return next;
	const emptyLast = next === context.lines.length && context.lines[next - 1] === "";
	if (!emptyLast) return end;
	const quoted = containerNodes(context).some(
		(container) =>
			container.type === "blockquote" &&
			container.position.start.offset <= node.position.start.offset &&
			node.position.end.offset <= container.position.end.offset,
	);
	return quoted ? end : next;
};

/**
 * The lines between a fenced code block's fences, as micromark's
 * `codeFenced` token gives them: `startLine + 1` to `endLine - 1`.
 * @internal
 */
export const fencedInterior = (context: LintContext, node: Code): LineRange => ({
	start: node.position.start.line + 1,
	end: fencedEndLine(context, node) - 1,
});

/** Every kit code node, fenced or indented. @internal */
export const codeNodes = (context: LintContext): ReadonlyArray<Code> =>
	context.document.findAll("code") as ReadonlyArray<Code>;

/**
 * Every line of every code block, fences included, as micromark's
 * `codeFenced` and `codeIndented` tokens span them. Computed once per
 * reading and shared: copy it before adding to it.
 * @internal
 */
export const codeBlockLines: (context: LintContext) => ReadonlySet<number> = perReading((context) => {
	const lines = new Set<number>();
	for (const node of codeNodes(context)) {
		const end = node.fenceChar === undefined ? node.position.end.line : fencedEndLine(context, node);
		addRange(lines, node.position.start.line, end);
	}
	return lines;
});

/**
 * A fenced code block's indentation: the columns between its containers'
 * prefix and its opening fence, which micromark strips from each inner line
 * as a `linePrefix`.
 * @internal
 */
export const fenceIndent = (context: LintContext, node: Code): number => {
	const opener = context.lines[node.position.start.line - 1] ?? "";
	const content = contentInContainers(context, node.position.start.line) ?? opener;
	return node.position.start.column - 1 - (opener.length - content.length);
};

/** One `codeFlowValue` token: a code line's text past its prefixes, where it starts and on which line. @internal */
export interface CodeFlowValue {
	readonly lineNumber: number;
	readonly offset: number;
	readonly text: string;
}

// The length of the indentation micromark strips from a code line: up to `columns` columns of spaces and tabs.
const strippedIndent = (text: string, columns: number): number => {
	let column = 0;
	let index = 0;
	while (index < text.length && column < columns) {
		const char = text.charAt(index);
		if (char === " ") column++;
		else if (char === "\t") column += 4 - (column % 4);
		else break;
		index++;
	}
	return index;
};

/**
 * A code block's `codeFlowValue` tokens, as micromark gives them: each inner
 * line (a fenced block's lines between its fences, an indented block's every
 * line) past its containers' prefix and the block's own indentation (the
 * fence's, or four columns), when anything is left, whitespace included.
 * @internal
 */
export const codeFlowValues = (context: LintContext, node: Code): ReadonlyArray<CodeFlowValue> => {
	const fenced = node.fenceChar !== undefined;
	const range: { start: number; end: number } = fenced
		? fencedInterior(context, node)
		: { start: node.position.start.line, end: node.position.end.line };
	// An unclosed fence ending on the source's last line, no line ending after it: micromark's `codeFlowValue` holds
	// that line too, where the `codeFenced` token's interior (`fencedInterior`, what MD009 and MD010 read) does not.
	const last = context.lines.length;
	if (
		fenced &&
		node.position.end.line === last &&
		fencedEndLine(context, node) === last &&
		!(last > node.position.start.line && isClosingFence(context.lines[last - 1] ?? "", node))
	) {
		range.end = last;
	}
	const indent = fenced ? fenceIndent(context, node) : 4;
	const values: Array<CodeFlowValue> = [];
	for (let lineNumber = range.start; lineNumber <= range.end; lineNumber++) {
		const line = context.lines[lineNumber - 1] ?? "";
		const content = contentInContainers(context, lineNumber) ?? line;
		const strip = strippedIndent(content, indent);
		const text = content.slice(strip);
		if (text.length === 0) continue;
		values.push({
			lineNumber,
			offset: context.mapping.lineStart(lineNumber) + line.length - content.length + strip,
			text,
		});
	}
	return values;
};

// The container model: flow-level nodes and their container ancestors, and
// each line's text inside the blockquotes, list items and footnote
// definitions the kit places it in, read from raw lines.

import type { ListItem, MarkdownNode } from "@effected/markdown";
import type { LintContext } from "../LintContext.js";
import { perReading } from "./memo.js";

const CONTAINER_TYPES: ReadonlySet<string> = new Set(["blockquote", "listItem", "footnoteDefinition"]);

/** Whether `node` is a container: a blockquote, a list item or a footnote definition. @internal */
export const isContainer = (node: MarkdownNode): boolean => CONTAINER_TYPES.has(node.type);

/** The node types a flow-level walk descends into: the root, the containers, and lists. @internal */
export const CONTAINERS: ReadonlySet<string> = new Set(["root", "list", ...CONTAINER_TYPES]);

/**
 * Every flow-level node of one of `types` — a block in the document, a
 * blockquote, a list item or a footnote definition, never inside a
 * paragraph, heading or table, where the same node type is inline.
 * @internal
 */
export const flowNodes = (context: LintContext, types: ReadonlySet<string>): Array<MarkdownNode> =>
	flowNodesWithAncestors(context, types).map(({ node }) => node);

/**
 * The 0-based column a list item's content starts at: its first child's,
 * when that starts on the item's line; otherwise past a one-character marker
 * and its space.
 * @internal
 */
export const itemContentColumn = (item: ListItem): number => {
	const first = item.children[0] as MarkdownNode | undefined;
	return first !== undefined && first.position.start.line === item.position.start.line
		? first.position.start.column - 1
		: item.position.start.column + 1;
};

/**
 * One container's step through a line: from 0-based `at`, past the
 * containers outside it, to past this one — a blockquote's marker and its
 * optional space, or a list item's or footnote's indentation (on its first
 * line, its marker). `undefined` when the line is lazy to it: it lacks the
 * marker or the indentation.
 * @internal
 */
export const containerStep = (
	line: string,
	lineNumber: number,
	container: MarkdownNode,
	at: number,
): number | undefined => {
	if (container.type === "blockquote") {
		const marker = /^[ \t]{0,3}>[ \t]?/.exec(line.slice(at));
		return marker === null ? undefined : at + marker[0].length;
	}
	const column =
		container.type === "listItem" ? itemContentColumn(container as ListItem) : container.position.start.column - 1 + 4;
	if (lineNumber === container.position.start.line) {
		return container.type === "listItem"
			? Math.max(at, column)
			: at + (/^\[\^[^\]]*\]:[ \t]*/.exec(line.slice(at))?.[0].length ?? 0);
	}
	if (line.slice(at, column).trim() !== "") return undefined;
	return Math.min(Math.max(at, column), line.length);
};

// A line's text inside its containers, each one's step taken in turn, with the blockquote markers (and the
// indentation before each) collected as `quotes`. `text` is `undefined` for a lazy line, one that does not carry
// them all; `quotes` then holds the markers it does carry.
const containerParts = (
	line: string,
	lineNumber: number,
	chain: ReadonlyArray<MarkdownNode>,
): { readonly text: string | undefined; readonly quotes: string } => {
	let at = 0;
	let quotes = "";
	for (const container of chain) {
		const next = containerStep(line, lineNumber, container, at);
		if (next === undefined) return { text: undefined, quotes };
		if (container.type === "blockquote") quotes += line.slice(at, next);
		at = next;
	}
	return { text: line.slice(at), quotes };
};

// A line's text inside `chain`'s containers; `undefined` for a lazy line.
const contentOf = (line: string, lineNumber: number, chain: ReadonlyArray<MarkdownNode>): string | undefined =>
	containerParts(line, lineNumber, chain).text;

/**
 * Every blockquote, list item and footnote definition in the document, in
 * document order. Computed once per reading and shared: read-only.
 * @internal
 */
export const containerNodes: (context: LintContext) => ReadonlyArray<MarkdownNode> = perReading((context) =>
	context.document.findAll(isContainer),
);

// Every line's containers, outermost first, built in one pass over the containers: each is added to the lines it
// spans, in document order, then each line's are sorted by start offset as `containersAt` reads them.
const containersByLine: (context: LintContext) => ReadonlyArray<ReadonlyArray<MarkdownNode>> = perReading((context) => {
	const byLine: Array<Array<MarkdownNode>> = [];
	for (const node of containerNodes(context)) {
		for (let line = node.position.start.line; line <= node.position.end.line; line++) {
			const nodes = byLine[line];
			if (nodes === undefined) byLine[line] = [node];
			else nodes.push(node);
		}
	}
	for (const nodes of byLine) nodes?.sort((a, b) => a.position.start.offset - b.position.start.offset);
	return byLine;
});

/**
 * The containers (blockquotes, list items, footnote definitions) the kit
 * places line `lineNumber` in, outermost first. Indexed once per reading
 * and shared: read-only.
 * @internal
 */
export const containersAt = (context: LintContext, lineNumber: number): ReadonlyArray<MarkdownNode> =>
	containersByLine(context)[lineNumber] ?? [];

/**
 * markdownlint's `getBlockQuotePrefixText` for one line, from its raw text:
 * the blockquote markers its containers carry on it, with the indentation
 * before each (micromark's `blockQuotePrefix` and `linePrefix` tokens; a
 * list item's or footnote's own indentation is neither), trailing space
 * trimmed.
 * @internal
 */
export const blockQuotePrefixText = (context: LintContext, lineNumber: number): string =>
	containerParts(context.lines[lineNumber - 1] ?? "", lineNumber, containersAt(context, lineNumber)).quotes.trimEnd();

/**
 * Line `lineNumber`'s text inside the containers the kit places it in, their
 * markers and indentation removed; `undefined` for a lazy line.
 * @internal
 */
export const contentInContainers = (context: LintContext, lineNumber: number): string | undefined =>
	contentOf(context.lines[lineNumber - 1] ?? "", lineNumber, containersAt(context, lineNumber));

/**
 * Whether line `lineNumber` is lazy: it lacks a marker or the indentation
 * of one of the containers the kit places it in.
 * @internal
 */
export const isLazyLine = (context: LintContext, lineNumber: number): boolean =>
	contentInContainers(context, lineNumber) === undefined;

/**
 * Every flow-level node of one of `types` with its container ancestors
 * (blockquotes, lists, list items, footnote definitions), outermost first.
 * @internal
 */
export const flowNodesWithAncestors = (
	context: LintContext,
	types: ReadonlySet<string>,
): Array<{ readonly node: MarkdownNode; readonly ancestors: ReadonlyArray<MarkdownNode> }> => {
	const found: Array<{ readonly node: MarkdownNode; readonly ancestors: ReadonlyArray<MarkdownNode> }> = [];
	const visit = (node: MarkdownNode, ancestors: ReadonlyArray<MarkdownNode>): void => {
		if (types.has(node.type)) found.push({ node, ancestors });
		if (CONTAINERS.has(node.type) && "children" in node) {
			const inner = node.type === "root" ? ancestors : [...ancestors, node];
			for (const child of node.children as ReadonlyArray<MarkdownNode>) visit(child, inner);
		}
	};
	visit(context.document.root as MarkdownNode, []);
	return found;
};

// The container model: flow-level nodes and their container ancestors, and
// each line's text inside the blockquotes, list items and footnote
// definitions the kit places it in, read from raw lines.

import type { Code, Heading, ListItem, MarkdownNode } from "@effected/markdown";
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

/** A list item's prefix as micromark's `listItemPrefix` token gives it. @internal */
export interface ListItemPrefix {
	/** The offset of the item's marker. */
	readonly offset: number;
	/** The marker's length: one for a bullet, the digits and the delimiter for an ordered item. */
	readonly marker: number;
	/** The whitespace after the marker that the prefix holds (micromark's `listItemPrefixWhitespace`), in characters. */
	readonly whitespace: number;
}

/**
 * A list item's `listItemPrefix`, read from its line: the marker, then the
 * whitespace after it when text follows on the line. micromark counts that
 * whitespace in columns, a tab to the next multiple of four: up to four
 * columns are all the prefix's, five or more leave it the first character
 * (the rest is indented code). A marker with nothing but blanks after it has
 * no whitespace in its prefix.
 * @internal
 */
export const listItemPrefix = (context: LintContext, item: ListItem): ListItemPrefix => {
	const offset = item.position.start.offset;
	const lineNumber = item.position.start.line;
	const line = context.lines[lineNumber - 1] ?? "";
	const at = offset - context.mapping.lineStart(lineNumber);
	const marker = (/^(?:\d{1,9}[.)]|[-+*])/.exec(line.slice(at))?.[0] ?? "-").length;
	const rest = line.slice(at + marker);
	const spaces = /^[ \t]*/.exec(rest)?.[0] ?? "";
	if (spaces.length === 0 || spaces.length === rest.length) return { offset, marker, whitespace: 0 };
	let column = 0;
	for (const char of line.slice(0, at + marker)) column = char === "\t" ? column + 4 - (column % 4) : column + 1;
	const start = column;
	for (const char of spaces) column = char === "\t" ? column + 4 - (column % 4) : column + 1;
	return { offset, marker, whitespace: column - start <= 4 ? spaces.length : 1 };
};

/**
 * The 0-based column just past the last blockquote marker (and its optional
 * space) that `chain`'s containers (its lists are passed over) carry on line
 * `lineNumber`: micromark's
 * last `blockQuotePrefix` token on that line, as its `endColumn - 1`; 0 when
 * none of them is a blockquote, or the line is lazy to one.
 * @internal
 */
export const blockQuotePrefixEnd = (
	context: LintContext,
	lineNumber: number,
	chain: ReadonlyArray<MarkdownNode>,
): number => {
	const line = context.lines[lineNumber - 1] ?? "";
	let at = 0;
	let end = 0;
	for (const container of chain) {
		if (!isContainer(container)) continue;
		const next = containerStep(line, lineNumber, container, at);
		if (next === undefined) return end;
		if (container.type === "blockquote") end = next;
		at = next;
	}
	return end;
};

/**
 * The line a node's last content token ends on, as micromark's token for it
 * ends: the last line holding its text, not a line break or the blank lines
 * a block the kit closes late carries (an empty list item, an indented code
 * block). A setext heading ends on its underline.
 * @internal
 */
export const lastContentLine = (node: MarkdownNode, lines: ReadonlyArray<string>): number => {
	const children = "children" in node ? (node.children as ReadonlyArray<MarkdownNode>) : [];
	const last = children.at(-1);
	if (node.type === "heading" && (node as Heading).headingStyle === "setext") return node.position.end.line;
	if (last !== undefined) return lastContentLine(last, lines);
	let line = node.position.end.line;
	if (node.type === "code" && (node as Code).fenceChar === undefined) {
		// An indented code block's trailing blank lines are micromark's `lineEndingBlank`, not content.
		while (line > node.position.start.line && (lines[line - 1] ?? "").trim() === "") line--;
	} else if (node.position.end.column === 1 && line > node.position.start.line) {
		line--;
	}
	return line;
};

// Each node's next sibling, read once per reading.
const nextSiblings: (context: LintContext) => ReadonlyMap<MarkdownNode, MarkdownNode> = perReading((context) => {
	const next = new Map<MarkdownNode, MarkdownNode>();
	const visit = (node: MarkdownNode): void => {
		if (!("children" in node)) return;
		const children = node.children as ReadonlyArray<MarkdownNode>;
		children.forEach((child, index) => {
			const sibling = children[index + 1];
			if (sibling !== undefined) next.set(child, sibling);
			visit(child);
		});
	};
	visit(context.document.root as MarkdownNode);
	return next;
});

// A blank line that carries a blockquote's marker: nothing but markers and whitespace, at least one marker.
const quotedBlank = /^[ \t]*>[ \t>]*$/;

/**
 * The line micromark's list token ends on. In the document, as in a list
 * item, it is the list's last content line. Inside a blockquote or a
 * footnote definition micromark exits the list only once the next line's
 * container prefix is read: it ends on the line of the next block after the
 * list (its next sibling, or its enclosing items' and lists', up to the
 * blockquote or footnote) when that is a container (a list or a blockquote),
 * and otherwise past the blank lines after it that carry a blockquote marker.
 * @internal
 */
export const listTokenEndLine = (
	context: LintContext,
	list: MarkdownNode,
	ancestors: ReadonlyArray<MarkdownNode>,
): number => {
	const last = lastContentLine(list, context.lines);
	if (!ancestors.some((node) => node.type === "blockquote" || node.type === "footnoteDefinition")) return last;
	const siblings = nextSiblings(context);
	let next: MarkdownNode | undefined;
	let bound = context.lines.length;
	let node = list;
	for (let index = ancestors.length - 1; index >= 0 && next === undefined; index--) {
		const parent = ancestors[index] as MarkdownNode;
		next = siblings.get(node);
		if (parent.type === "blockquote" || parent.type === "footnoteDefinition") {
			bound = parent.position.end.line;
			break;
		}
		node = parent;
	}
	if (next !== undefined && (next.type === "list" || next.type === "blockquote")) return next.position.start.line;
	let line = last;
	if (next !== undefined) bound = next.position.start.line - 1;
	while (line < bound && quotedBlank.test(context.lines[line] ?? "")) line++;
	return line;
};

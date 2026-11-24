// The container model: flow-level nodes and their container ancestors, and
// each line's text inside the blockquotes, list items and footnote
// definitions the kit places it in, read from raw lines.

import type { ListItem, MarkdownNode } from "@effected/markdown";
import type { LintContext } from "../LintContext.js";

/** The node types a flow-level walk descends into. @internal */
export const CONTAINERS = new Set(["root", "blockquote", "list", "listItem", "footnoteDefinition"]);

/**
 * Every flow-level node of one of `types` — a block in the document, a
 * blockquote, a list item or a footnote definition, never inside a
 * paragraph, heading or table, where the same node type is inline.
 * @internal
 */
export const flowNodes = (context: LintContext, types: ReadonlySet<string>): Array<MarkdownNode> => {
	const found: Array<MarkdownNode> = [];
	const visit = (node: MarkdownNode): void => {
		if (types.has(node.type)) found.push(node);
		if (CONTAINERS.has(node.type) && "children" in node) {
			for (const child of node.children as ReadonlyArray<MarkdownNode>) visit(child);
		}
	};
	visit(context.document.root as MarkdownNode);
	return found;
};

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

// A line's text inside its containers: each blockquote's marker and its optional space, and each list item's
// or footnote's indentation, removed in turn, with the blockquote markers (and the indentation before each)
// collected as `quotes`. `text` is `undefined` for a lazy line, one that does not carry them all; `quotes` then
// holds the markers it does carry.
/** @internal */
export const containerParts = (
	line: string,
	lineNumber: number,
	chain: ReadonlyArray<MarkdownNode>,
): { readonly text: string | undefined; readonly quotes: string } => {
	let at = 0;
	let quotes = "";
	for (const container of chain) {
		if (container.type === "blockquote") {
			const marker = /^[ \t]{0,3}>[ \t]?/.exec(line.slice(at));
			if (marker === null) return { text: undefined, quotes };
			at += marker[0].length;
			quotes += marker[0];
			continue;
		}
		const column =
			container.type === "listItem"
				? itemContentColumn(container as ListItem)
				: container.position.start.column - 1 + 4;
		if (lineNumber === container.position.start.line) {
			at =
				container.type === "listItem"
					? Math.max(at, column)
					: at + (/^\[\^[^\]]*\]:[ \t]*/.exec(line.slice(at))?.[0].length ?? 0);
			continue;
		}
		if (line.slice(at, column).trim() !== "") return { text: undefined, quotes };
		at = Math.min(Math.max(at, column), line.length);
	}
	return { text: line.slice(at), quotes };
};

/** A line's text inside `chain`'s containers; `undefined` for a lazy line. @internal */
export const contentOf = (line: string, lineNumber: number, chain: ReadonlyArray<MarkdownNode>): string | undefined =>
	containerParts(line, lineNumber, chain).text;

/**
 * The containers (blockquotes, list items, footnote definitions) the kit
 * places line `lineNumber` in, outermost first.
 * @internal
 */
export const containersAt = (context: LintContext, lineNumber: number): Array<MarkdownNode> =>
	[
		...context.document.findAll(
			(node) =>
				(node.type === "blockquote" || node.type === "listItem" || node.type === "footnoteDefinition") &&
				node.position.start.line <= lineNumber &&
				lineNumber <= node.position.end.line,
		),
	].sort((a, b) => a.position.start.offset - b.position.start.offset);

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
	contentOf(context.lines[lineNumber - 1] ?? "", lineNumber, containersAt(context, lineNumber)) === undefined;

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

// MD027 `no-multiple-space-blockquote`: a port of markdownlint's
// lib/md027.mjs. markdownlint reports each `linePrefix` token whose previous
// sibling is a `blockQuotePrefix`: the whitespace past a blockquote's marker
// and its one optional space, where a block starts, a paragraph or heading
// continues, or a nested blockquote or list item follows. The kit reads it
// from each line's container prefix: the line's containers stepped in turn,
// a list item's marker, a footnote's label and an item's continuation
// indentation each a prefix token of their own. micromark has no such token
// in an indented code block, an HTML block, a fenced code block's closing
// line or a table's delimiter row, on a blank line after a list item's
// content (the item's blank continuation), and on a fenced code block's inner
// line only as much as the fence is indented.

import type { Code, MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { fenceIndent, fencedInterior, indentedEndLine } from "../internal/code-blocks.js";
import {
	containerStep,
	containersAt,
	flowNodes,
	flowNodesWithAncestors,
	lastContentLine,
} from "../internal/containers.js";
import { directiveIndentedCode } from "../internal/directives.js";
import { addRange, errorContext, firstContentLine } from "../internal/lines.js";
import { flagSettingOn } from "../internal/settings.js";
import type { LintContext } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

// How micromark reads the whitespace past a blockquote prefix, by line: `0` where it is no `linePrefix` beside the
// prefix (an indented code block, an HTML block, a table's delimiter row, a fenced code block's closing line), and
// on a fenced code block's inner line the most of it that is (the fence's own indentation; the rest is code).
const prefixLimits = (context: LintContext): ReadonlyMap<number, number> => {
	const limits = new Map<number, number>();
	for (const node of flowNodes(context, new Set(["code", "html", "table"]))) {
		const { start, end } = node.position;
		if (node.type === "table") {
			limits.set(start.line + 1, 0);
		} else if (node.type === "html" || (node as Code).fenceChar === undefined) {
			// An indented block runs on over the whitespace-only lines micromark's token takes in.
			const last = node.type === "html" ? end.line : indentedEndLine(context, node as Code);
			for (let line = start.line; line <= last; line++) limits.set(line, 0);
		} else {
			const indent = fenceIndent(context, node as Code);
			const inner = fencedInterior(context, node as Code);
			for (let line = inner.start; line <= inner.end; line++) limits.set(line, indent);
			for (let line = inner.end + 1; line <= end.line; line++) limits.set(line, 0);
		}
	}
	// After a directive line, which markdownlint's directive extension parses, micromark reads an indented line as
	// code where the kit's parser reads more paragraph.
	// A code block's own limit stands: a fence's inner line keeps its fence's indentation.
	for (const line of directiveIndentedCode(context)) if (!limits.has(line)) limits.set(line, 0);
	return limits;
};

/**
 * MD027 `no-multiple-space-blockquote`: one space follows a blockquote's
 * marker.
 *
 * @remarks
 * markdownlint's setting: `list_items` (default `true`); when falsy, list
 * items in blockquotes are not checked. The fix deletes the extra spaces.
 *
 * @public
 */
export const MD027: Lint.LintRule = LintRule.make({
	names: ["MD027", "no-multiple-space-blockquote"],
	description: "Multiple spaces after blockquote symbol",
	tags: ["blockquote", "whitespace", "indentation"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md027.md",
	check: (context, report) => {
		const includeListItems = flagSettingOn(context.config, "list_items");
		const limits = prefixLimits(context);
		// A blank quoted line after a list item's content is the item's blank continuation to micromark, its
		// whitespace no `linePrefix`, until a line with content ends the run.
		const itemBlanks = new Set<number>();
		for (const { node: item, ancestors } of flowNodesWithAncestors(context, new Set(["listItem"]))) {
			// Only inside the item's own blockquote: a line past it is a new quote's, or none's.
			const quote = ancestors.findLast((node) => node.type === "blockquote");
			if (quote === undefined) continue;
			let line = lastContentLine(item, context.lines) + 1;
			while (line <= quote.position.end.line && /^[ \t>]*$/.test(context.lines[line - 1] ?? "")) itemBlanks.add(line++);
		}
		// micromark places a continuation line's prefix tokens inside every block still open from the lines before,
		// so a list that started earlier and spans the line is an ancestor of its `linePrefix`.
		const listContinues = new Set<number>();
		for (const list of flowNodes(context, new Set(["list"]))) {
			addRange(listContinues, list.position.start.line + 1, list.position.end.line);
		}
		for (let lineNumber = firstContentLine(context); lineNumber <= context.lines.length; lineNumber++) {
			const chain = containersAt(context, lineNumber);
			if (!chain.some((container) => container.type === "blockquote")) continue;
			const line = context.lines[lineNumber - 1] as string;
			const lineStart = context.mapping.lineStart(lineNumber);
			const found = (at: number, inList: boolean, limit = Number.POSITIVE_INFINITY): void => {
				const length = Math.min(limit, (/^[ \t]+/.exec(line.slice(at))?.[0] ?? "").length);
				if (length === 0 || (!includeListItems && inList)) return;
				report(
					context.diagnostic({
						at: { offset: lineStart + at, length: 0 },
						context: errorContext(line),
						range: { offset: lineStart + at, length },
						fix: { offset: lineStart + at, length, content: "" },
					}),
				);
			};
			let at = 0;
			let afterQuote = false;
			let inList = listContinues.has(lineNumber);
			let lazy = false;
			for (const container of chain as ReadonlyArray<MarkdownNode>) {
				const opens = container.position.start.line === lineNumber;
				if (container.type === "blockquote") {
					const leading = (/^[ \t]*/.exec(line.slice(at))?.[0] ?? "").length;
					const next = containerStep(line, lineNumber, container, at);
					if (next === undefined) {
						// Lazy to this quote, the line still carries the one before it, and its whitespace after.
						if (afterQuote) found(at, inList);
						lazy = true;
						break;
					}
					if (afterQuote && leading > 0) found(at, inList);
					afterQuote = true;
				} else if (opens) {
					// A list item's marker or a footnote's label is a prefix token of its own.
					if (container.type === "listItem") inList = true;
					const marker = container.position.start.offset - lineStart;
					if (afterQuote && marker > at) found(at, inList);
					afterQuote = false;
					at = containerStep(line, lineNumber, container, at) ?? at;
					continue;
				} else {
					if (container.type === "listItem") inList = true;
					const next = containerStep(line, lineNumber, container, at);
					if (next === undefined) {
						// Lazy to this item, the line still carries the quote's prefix, and its whitespace after.
						if (afterQuote) found(at, inList);
						lazy = true;
						break;
					}
					// A continuation's indentation is a token of its own (micromark's `listItemIndent`).
					if (next > at) afterQuote = false;
					at = next;
					continue;
				}
				at = containerStep(line, lineNumber, container, at) as number;
			}
			if (!lazy && afterQuote && !itemBlanks.has(lineNumber)) found(at, inList, limits.get(lineNumber));
		}
	},
});

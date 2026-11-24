// MD032 `blanks-around-lists`: a port of markdownlint's lib/md032.mjs over
// the kit tree. markdownlint walks its top-level list tokens (lists in no
// other list) and finds a list's "visual" end as the end line of its last
// content token; the kit's lists in no other list give the same lists, and
// the last content line is read from the list's last descendant. The fix's
// blockquote prefix is read from the raw line.

import type { Code, Heading, List, MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { blockQuotePrefixText, flowNodesWithAncestors, isLazyLine } from "../internal/containers.js";
import { preferredLineEnding } from "../internal/line-endings.js";
import type { LineRange } from "../internal/lines.js";
import { contentLine, errorContext, isBlankLine } from "../internal/lines.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { LintRule } from "../LintRule.js";

// The line a node's last content token ends on: the last line holding its text, not a line break or the blank
// lines a block the kit closes late carries. A setext heading ends on its underline.
const lastContentLine = (node: MarkdownNode, lines: ReadonlyArray<string>): number => {
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

// The list's last descendant, when it is a paragraph.
const lastParagraph = (node: MarkdownNode): MarkdownNode | undefined => {
	if (node.type === "paragraph") return node;
	const last = ("children" in node ? (node.children as ReadonlyArray<MarkdownNode>) : []).at(-1);
	return last === undefined || node.type === "heading" ? undefined : lastParagraph(last);
};

// The kit reads a math block as paragraph text, so a lazy line continues the paragraph, and the list, across
// it. micromark ends the list there: a lazy math opener interrupts the paragraph (the list ends on the line
// before it), and a lazy line after a block inside the item cannot continue one (the list ends on its last line).
const mathCutLine = (
	context: Lint.LintContext,
	list: MarkdownNode,
	math: ReadonlyArray<LineRange>,
): number | undefined => {
	const paragraph = lastParagraph(list);
	if (paragraph === undefined) return undefined;
	const start = paragraph.position.start.line;
	const end = paragraph.position.end.line;
	const cuts: Array<number> = [];
	for (const block of math) {
		if (block.start > start && block.start <= end && isLazyLine(context, block.start)) cuts.push(block.start - 1);
		else if (block.start >= start && block.end < end && isLazyLine(context, block.end + 1)) cuts.push(block.end);
	}
	return cuts.length === 0 ? undefined : Math.min(...cuts);
};

/**
 * MD032 `blanks-around-lists`: lists are surrounded by blank lines.
 *
 * @remarks
 * markdownlint's rule has no settings.
 *
 * @public
 */
export const MD032: Lint.LintRule = LintRule.make({
	names: ["MD032", "blanks-around-lists"],
	description: "Lists should be surrounded by blank lines",
	tags: ["bullet", "ul", "ol", "blank_lines"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md032.md",
	check: (context, report) => {
		const lineEnding = preferredLineEnding(context.source);
		const math = mathFlowBlocks(context);
		for (const { node, ancestors } of flowNodesWithAncestors(context, new Set(["list"]))) {
			const list = node as List;
			if (ancestors.some((ancestor) => ancestor.type === "list")) continue;
			const firstLine = list.position.start.line;
			if (inMathBlock(math, firstLine)) continue;
			const firstText = context.lines[firstLine - 1] as string;
			if (!isBlankLine(contentLine(context, firstLine - 1))) {
				const offset = context.mapping.lineStart(firstLine);
				report(
					context.diagnostic({
						at: { offset, length: 0 },
						context: errorContext(firstText.trim()),
						fix: { offset, length: 0, content: `${blockQuotePrefixText(context, firstLine)}${lineEnding}` },
					}),
				);
			}
			const lastLine =
				mathCutLine(context, list as MarkdownNode, math) ?? lastContentLine(list as MarkdownNode, context.lines);
			if (!isBlankLine(contentLine(context, lastLine + 1))) {
				const lastText = context.lines[lastLine - 1] as string;
				report(
					context.diagnostic({
						at: { offset: context.mapping.lineStart(lastLine), length: 0 },
						context: errorContext(lastText.trim()),
						fix: {
							offset: context.mapping.lineStart(lastLine + 1),
							length: 0,
							content: `${blockQuotePrefixText(context, lastLine)}${lineEnding}`,
						},
					}),
				);
			}
		}
	},
});

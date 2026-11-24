// MD032 `blanks-around-lists`: a port of markdownlint's lib/md032.mjs over
// the kit tree. markdownlint walks its top-level list tokens (lists in no
// other list) and finds a list's "visual" end as the end line of its last
// content token; the kit's lists in no other list give the same lists, and
// the last content line is read from the list's last descendant. The fix's
// blockquote prefix is read from the raw line.

import type { List, MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { blockQuotePrefixText, flowNodesWithAncestors, isLazyLine, lastContentLine } from "../internal/containers.js";
import { preferredLineEnding } from "../internal/line-endings.js";
import type { LineRange } from "../internal/lines.js";
import { contentLine, errorContext, isBlankLine } from "../internal/lines.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { LintRule } from "../LintRule.js";

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
	// The earliest cut, kept as a running minimum: an item can hold more math blocks than a call takes arguments.
	let cut: number | undefined;
	for (const block of math) {
		const line =
			block.start > start && block.start <= end && isLazyLine(context, block.start)
				? block.start - 1
				: block.start >= start && block.end < end && isLazyLine(context, block.end + 1)
					? block.end
					: undefined;
		if (line !== undefined && (cut === undefined || line < cut)) cut = line;
	}
	return cut;
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
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md032.md",
	check: (context, report) => {
		const lineEnding = preferredLineEnding(context.source);
		const math = mathFlowBlocks(context);
		for (const { node, ancestors } of flowNodesWithAncestors(context, new Set(["list"]))) {
			const list = node as List;
			if (ancestors.some((ancestor) => ancestor.type === "list")) continue;
			const firstLine = list.position.start.line;
			// Strict: a list or fence starting on a math opener line holds the opener (see `inMathBlock`).
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

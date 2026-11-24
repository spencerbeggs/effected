// MD028 `no-blanks-blockquote`: a port of markdownlint's lib/md028.mjs over
// the kit tree. markdownlint reports the `lineEndingBlank` tokens between a
// `blockQuote` and a sibling `blockQuote` that follows with only blank lines
// (and list or line indentation) between; a footnote's indentation is not
// passed over. A blank line that carries a parent
// blockquote's marker has a `blockQuotePrefix` there, which ends the run, so
// every line between the two must be whitespace.

import type { MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { CONTAINERS } from "../internal/containers.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import type { LintContext } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

// Every pair of consecutive sibling blockquotes, at any container depth. In a footnote definition the second
// one's indentation is a token markdownlint does not pass over (`gfmFootnoteDefinitionIndent`), so none pairs there.
const quotePairs = (
	node: MarkdownNode,
	found: Array<readonly [MarkdownNode, MarkdownNode]>,
): Array<readonly [MarkdownNode, MarkdownNode]> => {
	if (!CONTAINERS.has(node.type) || !("children" in node)) return found;
	const children = node.children as ReadonlyArray<MarkdownNode>;
	children.forEach((child, index) => {
		const next = children[index + 1];
		if (node.type !== "footnoteDefinition" && child.type === "blockquote" && next?.type === "blockquote")
			found.push([child, next]);
		quotePairs(child, found);
	});
	return found;
};

const blank = (context: LintContext, lineNumber: number): boolean =>
	(context.lines[lineNumber - 1] ?? "").trim() === "";

/**
 * MD028 `no-blanks-blockquote`: no blank line separates two blockquotes.
 *
 * @remarks
 * No settings. Each blank line between two adjacent blockquotes is reported.
 *
 * @public
 */
export const MD028: Lint.LintRule = LintRule.make({
	names: ["MD028", "no-blanks-blockquote"],
	description: "Blank line inside blockquote",
	tags: ["blockquote", "whitespace"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md028.md",
	check: (context, report) => {
		const math = mathFlowBlocks(context);
		for (const [first, second] of quotePairs(context.root as MarkdownNode, [])) {
			// Strict: a blockquote starting on a math opener line holds the opener (see `inMathBlock`).
			if (inMathBlock(math, first.position.start.line)) continue;
			const between: Array<number> = [];
			for (let line = first.position.end.line + 1; line < second.position.start.line; line++) between.push(line);
			if (!between.every((line) => blank(context, line))) continue;
			for (const line of between) {
				report(context.diagnostic({ at: { offset: context.mapping.lineStart(line), length: 0 } }));
			}
		}
	},
});

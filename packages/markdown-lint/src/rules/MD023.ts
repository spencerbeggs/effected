// MD023 `heading-start-left`: a port of markdownlint's lib/md023.mjs over the
// kit tree. markdownlint reports a `linePrefix` token on a heading's first
// line: indentation its container does not own. This module reads it from the
// line's raw text before the heading's first column, less what the innermost
// container owns (one space after a blockquote marker, a list item's content
// indentation).

import type { ListItem, MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { flowNodesWithAncestors, itemContentColumn } from "../internal/containers.js";
import { headingNodes } from "../internal/headings.js";
import { errorContext } from "../internal/lines.js";
import { LintRule } from "../LintRule.js";

/**
 * MD023 `heading-start-left`: headings start at the beginning of their line.
 *
 * @remarks
 * No settings.
 *
 * @public
 */
export const MD023: Lint.LintRule = LintRule.make({
	names: ["MD023", "heading-start-left"],
	description: "Headings must start at the beginning of the line",
	tags: ["headings", "spaces"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md023.md",
	check: (context, report) => {
		const seen = new Set<MarkdownNode>(headingNodes(context));
		for (const { node, ancestors } of flowNodesWithAncestors(context, new Set(["heading"]))) {
			if (!seen.has(node)) continue;
			const lineNumber = node.position.start.line;
			const line = context.lines[lineNumber - 1] as string;
			const column = node.position.start.column - 1;
			let from = column;
			while (from > 0 && (line[from - 1] === " " || line[from - 1] === "\t")) from--;
			const container = ancestors.filter((each) => each.type === "blockquote" || each.type === "listItem").at(-1);
			if (container?.type === "listItem") {
				if (container.position.start.line === lineNumber) continue;
				from = Math.max(from, itemContentColumn(container as ListItem));
			} else if (container?.type === "blockquote" && line[from - 1] === ">" && from < column) {
				from++;
			}
			const length = column - from;
			if (length <= 0) continue;
			const offset = context.mapping.lineStart(lineNumber) + from;
			report(
				context.diagnostic({
					at: { offset: context.mapping.lineStart(lineNumber), length: 0 },
					context: errorContext(line, true, false),
					range: { offset, length },
					fix: { offset, length, content: "" },
				}),
			);
		}
	},
});

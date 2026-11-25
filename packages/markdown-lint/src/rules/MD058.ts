// MD058 `blanks-around-tables`: a port of markdownlint's lib/md058.mjs over
// the kit tree. markdownlint checks the line before each table's first line
// and after its last (see `tables`): one that is not blank is reported on the
// table's line, the context that line trimmed, and the fix inserts a line
// holding the table line's blockquote markers.

import type * as Lint from "@effected/markdown-lint";
import { blockQuotePrefixText } from "../internal/containers.js";
import { preferredLineEnding } from "../internal/line-endings.js";
import { contentLine, errorContext, isBlankLine } from "../internal/lines.js";
import { tables } from "../internal/tables.js";
import { LintRule } from "../LintRule.js";

/**
 * MD058 `blanks-around-tables`: a table has a blank line before and after it.
 *
 * @remarks
 * No settings. The fix inserts the blank line, inside the table's
 * blockquotes.
 *
 * @public
 */
export const MD058: Lint.LintRule = LintRule.make({
	names: ["MD058", "blanks-around-tables"],
	description: "Tables should be surrounded by blank lines",
	tags: ["table"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md058.md",
	check: (context, report) => {
		const lineEnding = preferredLineEnding(context.source);
		for (const table of tables(context)) {
			const { endLine, startLine } = table;
			if (!isBlankLine(contentLine(context, startLine - 1))) {
				const offset = context.mapping.lineStart(startLine);
				report(
					context.diagnostic({
						at: { offset, length: 0 },
						context: errorContext((context.lines[startLine - 1] ?? "").trim()),
						fix: { offset, length: 0, content: `${blockQuotePrefixText(context, startLine)}${lineEnding}` },
					}),
				);
			}
			if (!isBlankLine(contentLine(context, endLine + 1))) {
				report(
					context.diagnostic({
						at: { offset: context.mapping.lineStart(endLine), length: 0 },
						context: errorContext((context.lines[endLine - 1] ?? "").trim()),
						fix: {
							offset: context.mapping.lineStart(endLine + 1),
							length: 0,
							content: `${blockQuotePrefixText(context, endLine)}${lineEnding}`,
						},
					}),
				);
			}
		}
	},
});

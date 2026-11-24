// MD047 `single-trailing-newline`: a port of markdownlint's lib/md047.mjs.
// markdownlint reads its last content line, after the front matter; an
// empty remainder is one empty line, which is blank.

import type * as Lint from "@effected/markdown-lint";
import { preferredLineEnding } from "../internal/line-endings.js";
import { firstContentLine, isBlankLine } from "../internal/lines.js";
import { LintRule } from "../LintRule.js";

/**
 * MD047 `single-trailing-newline`: the file ends with a line break.
 *
 * @remarks
 * No settings. The fix inserts the source's most common line ending.
 *
 * @public
 */
export const MD047: Lint.LintRule = LintRule.make({
	names: ["MD047", "single-trailing-newline"],
	description: "Files should end with a single newline character",
	tags: ["blank_lines"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md047.md",
	check: (context, report) => {
		const lastLineNumber = context.lines.length;
		if (lastLineNumber < firstContentLine(context)) return;
		const lastLine = context.lines[lastLineNumber - 1] as string;
		if (isBlankLine(lastLine)) return;
		const start = context.mapping.lineStart(lastLineNumber);
		report(
			context.diagnostic({
				at: { offset: start, length: 0 },
				range: { offset: start + lastLine.length - 1, length: 1 },
				fix: { offset: start + lastLine.length, length: 0, content: preferredLineEnding(context.source) },
			}),
		);
	},
});

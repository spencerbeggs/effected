// MD018 `no-missing-space-atx`: a port of markdownlint's lib/md018.mjs. A
// line rule over the raw content lines: `#Heading` parses as a paragraph,
// so no heading node exists to read. markdownlint skips code blocks, HTML
// blocks and math blocks.

import type * as Lint from "@effected/markdown-lint";
import { atxLineRuleSkippedLines } from "../internal/headings.js";
import { errorContext, firstContentLine } from "../internal/lines.js";
import { LintRule } from "../LintRule.js";

/**
 * MD018 `no-missing-space-atx`: a space follows the hashes of an ATX heading.
 *
 * @remarks
 * No settings.
 *
 * @public
 */
export const MD018: Lint.LintRule = LintRule.make({
	names: ["MD018", "no-missing-space-atx"],
	description: "No space after hash on atx style heading",
	tags: ["headings", "atx", "spaces"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md018.md",
	check: (context, report) => {
		const ignored = atxLineRuleSkippedLines(context);
		for (let lineNumber = firstContentLine(context); lineNumber <= context.lines.length; lineNumber++) {
			const line = context.lines[lineNumber - 1] as string;
			if (ignored.has(lineNumber) || !/^#+[^# \t]/.test(line) || /#\s*$/.test(line) || line.startsWith("#️⃣")) {
				continue;
			}
			const hashes = (/^#+/.exec(line)?.[0] ?? "").length;
			const start = context.mapping.lineStart(lineNumber);
			report(
				context.diagnostic({
					at: { offset: start, length: 0 },
					context: errorContext(line.trim()),
					range: { offset: start, length: hashes + 1 },
					fix: { offset: start + hashes, length: 0, content: " " },
				}),
			);
		}
	},
});

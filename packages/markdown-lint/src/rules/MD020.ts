// MD020 `no-missing-space-closed-atx`: a port of markdownlint's
// lib/md020.mjs. A line rule over the raw content lines: `#Heading#` parses
// as a paragraph, so no heading node exists to read. markdownlint skips code
// blocks, HTML blocks and math blocks, as MD018 does.

import type * as Lint from "@effected/markdown-lint";
import { atxLineRuleSkippedLines } from "../internal/headings.js";
import { errorContext, firstContentLine } from "../internal/lines.js";
import { LintRule } from "../LintRule.js";

// markdownlint's MD020 line shape: hashes, optional space, content, optional space, an optional escaped hash, hashes.
const closedAtx = /^(#+)([ \t]*)([^# \t\\]|[^# \t][^#]*?[^# \t\\])([ \t]*)((?:\\#)?)(#+)(\s*)$/;

/**
 * MD020 `no-missing-space-closed-atx`: a space separates the text of a
 * closed ATX heading from the hashes on each side.
 *
 * @remarks
 * No settings. The fix rewrites the line with one space inside each run of
 * hashes.
 *
 * @public
 */
export const MD020: Lint.LintRule = LintRule.make({
	names: ["MD020", "no-missing-space-closed-atx"],
	description: "No space inside hashes on closed atx style heading",
	tags: ["headings", "atx_closed", "spaces"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md020.md",
	check: (context, report) => {
		const ignored = atxLineRuleSkippedLines(context);
		for (let lineNumber = firstContentLine(context); lineNumber <= context.lines.length; lineNumber++) {
			if (ignored.has(lineNumber)) continue;
			const line = context.lines[lineNumber - 1] as string;
			const match = closedAtx.exec(line);
			if (match === null) continue;
			const [
				,
				leftHash = "",
				leftSpace = "",
				content = "",
				rightSpace = "",
				rightEscape = "",
				rightHash = "",
				trailSpace = "",
			] = match;
			const left = leftSpace.length === 0;
			const right = rightSpace.length === 0 || rightEscape.length > 0;
			if (!left && !right) continue;
			const start = context.mapping.lineStart(lineNumber);
			const range = left
				? { offset: start, length: leftHash.length + 1 }
				: { offset: start + line.length - trailSpace.length - rightHash.length - 1, length: rightHash.length + 1 };
			const escaped = rightEscape.length > 0 ? `${rightEscape} ` : "";
			report(
				context.diagnostic({
					at: { offset: start, length: 0 },
					context: errorContext(line.trim(), left, right),
					range,
					fix: { offset: start, length: line.length, content: `${leftHash} ${content} ${escaped}${rightHash}` },
				}),
			);
		}
	},
});

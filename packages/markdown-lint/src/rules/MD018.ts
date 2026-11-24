// MD018 `no-missing-space-atx`: a port of markdownlint's lib/md018.mjs. A
// line rule over the raw content lines: `#Heading` parses as a paragraph,
// so no heading node exists to read. markdownlint skips code blocks, HTML
// blocks and math blocks.

import type * as Lint from "@effected/markdown-lint";
import { codeBlockLines } from "../internal/code-blocks.js";
import { flowNodes } from "../internal/containers.js";
import { errorContext, firstContentLine, lineStarts, nodeLines } from "../internal/lines.js";
import { mathFlowLines } from "../internal/math-flow.js";
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
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md018.md",
	check: (context, report) => {
		const starts = lineStarts(context.source);
		const ignored = codeBlockLines(context, starts);
		for (const line of nodeLines(flowNodes(context, new Set(["html"])))) ignored.add(line);
		for (const line of mathFlowLines(context, starts)) ignored.add(line);
		for (let lineNumber = firstContentLine(context); lineNumber <= context.lines.length; lineNumber++) {
			const line = context.lines[lineNumber - 1] as string;
			if (ignored.has(lineNumber) || !/^#+[^# \t]/.test(line) || /#\s*$/.test(line) || line.startsWith("#️⃣")) {
				continue;
			}
			const hashes = (/^#+/.exec(line)?.[0] ?? "").length;
			const start = starts[lineNumber - 1] as number;
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

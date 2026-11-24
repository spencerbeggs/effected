// MD012 `no-multiple-blanks`: a port of markdownlint's lib/md012.mjs over the
// kit tree. markdownlint counts no blank line inside a code block's token
// span, fences included; this module takes those spans from kit code nodes.

import type * as Lint from "@effected/markdown-lint";
import { codeBlockLines } from "../internal/code-blocks.js";
import { firstContentLine, lineStarts } from "../internal/lines.js";
import { isNumber, setting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

// The offset the text of the line before `lineNumber` ends at, before its terminator.
const previousEnd = (context: Lint.LintContext, starts: ReadonlyArray<number>, lineNumber: number): number =>
	(starts[lineNumber - 2] as number) + (context.lines[lineNumber - 2] as string).length;

/**
 * MD012 `no-multiple-blanks`: no more than `maximum` consecutive blank lines.
 *
 * @remarks
 * markdownlint's setting: `maximum` (default `1`). A setting of the wrong
 * type reads as its default.
 *
 * @public
 */
export const MD012: Lint.LintRule = LintRule.make({
	names: ["MD012", "no-multiple-blanks"],
	description: "Multiple consecutive blank lines",
	tags: ["whitespace", "blank_lines"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md012.md",
	check: (context, report) => {
		const maximum = setting(context.config, "maximum", isNumber, 1);
		const starts = lineStarts(context.source);
		const code = codeBlockLines(context, starts);
		const reported: Array<{ readonly lineNumber: number; readonly count: number }> = [];
		let count = 0;
		for (let lineNumber = firstContentLine(context); lineNumber <= context.lines.length; lineNumber++) {
			const line = context.lines[lineNumber - 1] as string;
			count = code.has(lineNumber) || line.trim().length > 0 ? 0 : count + 1;
			if (maximum < count) reported.push({ lineNumber, count });
		}
		// The run of reported lines that reaches the last line: those are deleted from the previous line's end
		// through their own, since a last line has no terminator to delete; every other line is deleted from its
		// start through the next line's start. Either spelling is markdownlint's whole-line delete. A run from the
		// first line to the last (a blank document under `maximum: 0`) has no previous line to start from: its
		// lines are deleted forward and the last, left empty, gets an empty edit, which maps to markdownlint's
		// delete only when it is the document's one line.
		let fromEnd = context.lines.length + 1;
		for (let index = reported.length - 1; index >= 0; index--) {
			const entry = reported[index] as { readonly lineNumber: number };
			if (entry.lineNumber !== fromEnd - 1) break;
			fromEnd = entry.lineNumber;
		}
		if (fromEnd === 1) fromEnd = context.lines.length + 1;
		for (const { lineNumber, count: blanks } of reported) {
			const start = starts[lineNumber - 1] as number;
			const end = start + (context.lines[lineNumber - 1] as string).length;
			const from = lineNumber >= fromEnd ? previousEnd(context, starts, lineNumber) : start;
			const to = lineNumber >= fromEnd ? end : (starts[lineNumber] ?? end);
			const fix = { offset: from, length: to - from, content: "" };
			report(
				context.diagnostic({
					at: { offset: start, length: 0 },
					detail: `Expected: ${maximum}; Actual: ${blanks}`,
					fix,
				}),
			);
		}
	},
});

// MD031 `blanks-around-fences`: a port of markdownlint's lib/md031.mjs over
// the kit tree. markdownlint walks its `codeFenced` tokens; the kit's fenced
// `code` nodes give the same blocks, ending where micromark's token ends
// (`fencedEndLine`), and the fences the kit reads inside a math block are
// dropped, as micromark reads those lines as math. The blank-line checks and
// the fix's blockquote prefix are read from the raw content lines.

import type { Code } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { preferredLineEnding } from "../internal/line-endings.js";
import {
	errorContext,
	fencedEndLine,
	firstContentLine,
	flowNodesWithAncestors,
	inMathBlock,
	isBlankLine,
	lineStarts,
	mathFlowBlocks,
} from "../internal/rule-helpers.js";
import { LintRule } from "../LintRule.js";

const codeFencePrefix = /^(.*?)[`~]/;

/**
 * MD031 `blanks-around-fences`: fenced code blocks are surrounded by blank
 * lines.
 *
 * @remarks
 * markdownlint's setting: `list_items` (default `true`). As in
 * markdownlint, any falsy value leaves fences inside lists out and any
 * truthy one keeps them.
 *
 * @public
 */
export const MD031: Lint.LintRule = LintRule.make({
	names: ["MD031", "blanks-around-fences"],
	description: "Fenced code blocks should be surrounded by blank lines",
	tags: ["code", "blank_lines"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md031.md",
	check: (context, report) => {
		// markdownlint's `(list_items === undefined) || !!list_items`.
		const listItems = context.config.list_items;
		const includeListItems = listItems === undefined || !!listItems;
		const starts = lineStarts(context.source);
		const lineEnding = preferredLineEnding(context.source);
		const first = firstContentLine(context);
		const last = context.lines.length;
		const math = mathFlowBlocks(context, starts);
		// markdownlint's `params.lines[lineNumber - 1]`: a content line, or undefined outside them.
		const lineAt = (lineNumber: number): string | undefined =>
			lineNumber >= first && lineNumber <= last ? context.lines[lineNumber - 1] : undefined;
		const addError = (lineNumber: number, top: boolean): void => {
			const line = lineAt(lineNumber) as string;
			const prefix = codeFencePrefix.exec(line)?.[1];
			const offset = starts[lineNumber - 1] as number;
			const fixAt = starts[lineNumber - (top ? 1 : 0)] as number;
			report(
				context.diagnostic({
					at: { offset, length: 0 },
					context: errorContext(line.trim()),
					...(prefix === undefined
						? {}
						: {
								fix: {
									offset: fixAt,
									length: 0,
									content: `${prefix.replace(/[^>]/g, " ").trim()}${lineEnding}`,
								},
							}),
				}),
			);
		};
		for (const { node, ancestors } of flowNodesWithAncestors(context, new Set(["code"]))) {
			const code = node as Code;
			if (code.fenceChar === undefined || inMathBlock(math, code.position.start.line)) continue;
			if (!includeListItems && ancestors.some((ancestor) => ancestor.type === "list")) continue;
			const startLine = code.position.start.line;
			const endLine = fencedEndLine(context, code, starts);
			if (!isBlankLine(lineAt(startLine - 1))) addError(startLine, true);
			if (!isBlankLine(lineAt(endLine + 1)) && !isBlankLine(lineAt(endLine))) addError(endLine, false);
		}
	},
});

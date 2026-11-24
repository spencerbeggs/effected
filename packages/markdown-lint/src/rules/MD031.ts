// MD031 `blanks-around-fences`: a port of markdownlint's lib/md031.mjs over
// the kit tree. markdownlint walks its `codeFenced` tokens; the kit's fenced
// `code` nodes give the same blocks, ending where micromark's token ends
// (`fencedEndLine`), and the fences the kit reads inside a math block are
// dropped, as micromark reads those lines as math. The blank-line checks and
// the fix's blockquote prefix are read from the raw content lines.

import type { Code } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { fencedEndLine } from "../internal/code-blocks.js";
import { flowNodesWithAncestors } from "../internal/containers.js";
import { preferredLineEnding } from "../internal/line-endings.js";
import { contentLine, errorContext, isBlankLine } from "../internal/lines.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { rawSetting } from "../internal/settings.js";
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
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md031.md",
	check: (context, report) => {
		// markdownlint's `(list_items === undefined) || !!list_items`.
		const listItems = rawSetting(context.config, "list_items");
		const includeListItems = listItems === undefined || !!listItems;
		const lineEnding = preferredLineEnding(context.source);
		const math = mathFlowBlocks(context);
		const addError = (lineNumber: number, top: boolean): void => {
			const line = contentLine(context, lineNumber) as string;
			const prefix = codeFencePrefix.exec(line)?.[1];
			const offset = context.mapping.lineStart(lineNumber);
			const fixAt = context.mapping.lineStart(top ? lineNumber : lineNumber + 1);
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
			// Strict: a list or fence starting on a math opener line holds the opener (see `inMathBlock`).
			if (code.fenceChar === undefined || inMathBlock(math, code.position.start.line)) continue;
			if (!includeListItems && ancestors.some((ancestor) => ancestor.type === "list")) continue;
			const startLine = code.position.start.line;
			const endLine = fencedEndLine(context, code);
			if (!isBlankLine(contentLine(context, startLine - 1))) addError(startLine, true);
			if (!isBlankLine(contentLine(context, endLine + 1)) && !isBlankLine(contentLine(context, endLine)))
				addError(endLine, false);
		}
	},
});

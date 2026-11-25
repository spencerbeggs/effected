// MD014 `commands-show-output`: a port of markdownlint's lib/md014.mjs over
// the kit tree. markdownlint reads each code block's `codeFlowValue` tokens;
// the kit reads the same lines through the shared code-block reading. The
// code blocks the kit reads inside a math block are dropped, as micromark
// reads those lines as math.

import type * as Lint from "@effected/markdown-lint";
import { codeFlowValues, codeNodes } from "../internal/code-blocks.js";
import { errorContext } from "../internal/lines.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { LintRule } from "../LintRule.js";

const dollarCommand = /^(\s*)(\$\s+)/;

/**
 * MD014 `commands-show-output`: a code block whose every line is a `$`
 * command shows no output, so the dollar signs go.
 *
 * @remarks
 * No settings. The fix deletes each line's `$` and the whitespace after it.
 *
 * @public
 */
export const MD014: Lint.LintRule = LintRule.make({
	names: ["MD014", "commands-show-output"],
	description: "Dollar signs used before commands without showing output",
	tags: ["code"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md014.md",
	check: (context, report) => {
		const math = mathFlowBlocks(context);
		for (const code of codeNodes(context)) {
			// Strict: a fence starting on a math opener line holds the opener (see `inMathBlock`).
			if (inMathBlock(math, code.position.start.line)) continue;
			const values = codeFlowValues(context, code);
			const matches = values.map((value) => ({ value, match: dollarCommand.exec(value.text) }));
			if (!matches.every(({ match }) => match !== null)) continue;
			for (const { value, match } of matches) {
				const [, leading = "", dollar = ""] = match ?? [];
				const offset = value.offset + leading.length;
				report(
					context.diagnostic({
						at: { offset: value.offset, length: 0 },
						context: errorContext(value.text),
						range: { offset, length: dollar.length },
						fix: { offset, length: dollar.length, content: "" },
					}),
				);
			}
		}
	},
});

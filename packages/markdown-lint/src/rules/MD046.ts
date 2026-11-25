// MD046 `code-block-style`: a port of markdownlint's lib/md046.mjs over the
// kit tree. markdownlint reads its `codeFenced` and `codeIndented` tokens in
// document order; the kit's code nodes give the same blocks, less the ones it
// reads inside a math block, which micromark reads as math.

import type * as Lint from "@effected/markdown-lint";
import { codeNodes } from "../internal/code-blocks.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { stringSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

/**
 * MD046 `code-block-style`: code blocks are all fenced or all indented.
 *
 * @remarks
 * markdownlint's setting: `style` (default `consistent`, the first block's
 * style; `fenced` or `indented`), read as `String(style || "consistent")`, so
 * a falsy value is the default and any other value is compared as its text.
 *
 * @public
 */
export const MD046: Lint.LintRule = LintRule.make({
	names: ["MD046", "code-block-style"],
	description: "Code block style",
	tags: ["code"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md046.md",
	check: (context, report) => {
		let expectedStyle = stringSetting(context.config, "style", "consistent");
		const math = mathFlowBlocks(context);
		for (const code of codeNodes(context)) {
			// Strict: a fence starting on a math opener line holds the opener (see `inMathBlock`).
			if (inMathBlock(math, code.position.start.line)) continue;
			const style = code.fenceChar === undefined ? "indented" : "fenced";
			if (expectedStyle === "consistent") expectedStyle = style;
			if (style === expectedStyle) continue;
			report(
				context.diagnostic({
					at: { offset: context.mapping.lineStart(code.position.start.line), length: 0 },
					detail: `Expected: ${expectedStyle}; Actual: ${style}`,
				}),
			);
		}
	},
});

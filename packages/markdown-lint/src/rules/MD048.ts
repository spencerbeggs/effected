// MD048 `code-fence-style`: a port of markdownlint's lib/md048.mjs over the
// kit tree. markdownlint reads each `codeFenced` token's opening fence
// sequence; the kit's fenced code nodes carry its character, less the fences
// the kit reads inside a math block, which micromark reads as math.

import type * as Lint from "@effected/markdown-lint";
import { codeNodes } from "../internal/code-blocks.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { stringSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

/**
 * MD048 `code-fence-style`: code fences all use backticks or all tildes.
 *
 * @remarks
 * markdownlint's setting: `style` (default `consistent`, the first fence's
 * style; `backtick` or `tilde`), read as `String(style || "consistent")`, so
 * a falsy value is the default and any other value is compared as its text.
 *
 * @public
 */
export const MD048: Lint.LintRule = LintRule.make({
	names: ["MD048", "code-fence-style"],
	description: "Code fence style",
	tags: ["code"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md048.md",
	check: (context, report) => {
		let expectedStyle = stringSetting(context.config, "style", "consistent");
		const math = mathFlowBlocks(context);
		for (const code of codeNodes(context)) {
			// Strict: a fence starting on a math opener line holds the opener (see `inMathBlock`).
			if (code.fenceChar === undefined || inMathBlock(math, code.position.start.line)) continue;
			const style = code.fenceChar === "~" ? "tilde" : "backtick";
			if (expectedStyle === "consistent") expectedStyle = style;
			if (style === expectedStyle) continue;
			report(
				context.diagnostic({
					at: { offset: code.position.start.offset, length: 0 },
					detail: `Expected: ${expectedStyle}; Actual: ${style}`,
				}),
			);
		}
	},
});

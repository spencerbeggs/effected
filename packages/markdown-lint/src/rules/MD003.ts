// MD003 `heading-style`: a port of markdownlint's lib/md003.mjs over the kit
// tree. A heading's style is `setext`, or `atx` / `atx_closed` by whether its
// source span ends in a closing sequence (micromark's second
// `atxHeadingSequence`).

import type * as Lint from "@effected/markdown-lint";
import { headingNodes, headingStyle } from "../internal/headings.js";
import { stringSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

/**
 * MD003 `heading-style`: headings share one style.
 *
 * @remarks
 * markdownlint's setting: `style` (default `consistent`; or `atx`,
 * `atx_closed`, `setext`, `setext_with_atx`, `setext_with_atx_closed`). Settings are coerced as markdownlint coerces them
 * (`"50"` reads as `50`, `0` as `false`).
 *
 * @public
 */
export const MD003: Lint.LintRule = LintRule.make({
	names: ["MD003", "heading-style"],
	description: "Heading style",
	tags: ["headings"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md003.md",
	check: (context, report) => {
		let style = stringSetting(context.config, "style", "consistent");
		for (const heading of headingNodes(context)) {
			const actual = headingStyle(context, heading);
			if (style === "consistent") style = actual;
			if (actual === style) continue;
			const h12 = heading.depth <= 2;
			const setextWithAtx = style === "setext_with_atx" && ((h12 && actual === "setext") || (!h12 && actual === "atx"));
			const setextWithAtxClosed =
				style === "setext_with_atx_closed" && ((h12 && actual === "setext") || (!h12 && actual === "atx_closed"));
			if (setextWithAtx || setextWithAtxClosed) continue;
			const expected =
				style === "setext_with_atx"
					? h12
						? "setext"
						: "atx"
					: style === "setext_with_atx_closed"
						? h12
							? "setext"
							: "atx_closed"
						: style;
			if (expected === actual) continue;
			report(
				context.diagnostic({
					at: { offset: heading.position.start.offset, length: 0 },
					detail: `Expected: ${expected}; Actual: ${actual}`,
				}),
			);
		}
	},
});

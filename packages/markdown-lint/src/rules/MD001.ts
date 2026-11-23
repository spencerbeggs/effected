// MD001 `heading-increment`: a port of markdownlint's lib/md001.mjs over the
// kit tree's headings, in document order.

import type * as Lint from "@effected/markdown-lint";
import { frontMatterHasTitle, headingNodes } from "../internal/rule-helpers.js";
import { LintRule } from "../LintRule.js";

/**
 * MD001 `heading-increment`: heading levels increment by one level at a time.
 *
 * @remarks
 * markdownlint's setting: `front_matter_title` (default
 * `^\s*"?title"?\s*[:=]`); a front matter title counts as a level-1
 * heading, and `""` turns that off. A setting of the wrong type reads as its
 * default.
 *
 * @public
 */
export const MD001: Lint.LintRule = LintRule.make({
	names: ["MD001", "heading-increment"],
	description: "Heading levels should only increment by one level at a time",
	tags: ["headings"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md001.md",
	check: (context, report) => {
		let previous = frontMatterHasTitle(context) ? 1 : Number.MAX_SAFE_INTEGER;
		for (const heading of headingNodes(context)) {
			// markdownlint reports through `addErrorDetailIf`, which is silent for a step of exactly one level.
			if (heading.depth > previous + 1) {
				report(
					context.diagnostic({
						at: { offset: heading.position.start.offset, length: 0 },
						detail: `Expected: h${previous + 1}; Actual: h${heading.depth}`,
					}),
				);
			}
			previous = heading.depth;
		}
	},
});

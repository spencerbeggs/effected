// MD024 `no-duplicate-heading`: a port of markdownlint's lib/md024.mjs over
// the kit tree. A heading's text is its content as written, read from its
// direct children's source spans (micromark's heading text token children).

import type * as Lint from "@effected/markdown-lint";
import { headingNodes, headingText } from "../internal/headings.js";
import { errorContext } from "../internal/lines.js";
import { flagSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

/**
 * MD024 `no-duplicate-heading`: no two headings have the same content.
 *
 * @remarks
 * markdownlint's setting: `siblings_only` (default `false`), which compares a
 * heading only with its siblings under the same parent heading. Settings are coerced as markdownlint coerces them
 * (`"50"` reads as `50`, `0` as `false`).
 *
 * @public
 */
export const MD024: Lint.LintRule = LintRule.make({
	names: ["MD024", "no-duplicate-heading"],
	description: "Multiple headings with the same content",
	tags: ["headings"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md024.md",
	check: (context, report) => {
		const siblingsOnly = flagSetting(context.config, "siblings_only");
		const known: Array<Array<string>> = [[], []];
		let lastLevel = 1;
		let current = known[lastLevel] as Array<string>;
		for (const heading of headingNodes(context)) {
			const text = headingText(context, heading);
			if (siblingsOnly) {
				const level = heading.depth;
				while (lastLevel < level) {
					lastLevel++;
					known[lastLevel] = [];
				}
				while (lastLevel > level) {
					known[lastLevel] = [];
					lastLevel--;
				}
				current = known[level] as Array<string>;
			}
			if (current.includes(text)) {
				report(
					context.diagnostic({
						at: { offset: heading.position.start.offset, length: 0 },
						context: errorContext(text.trim()),
					}),
				);
			} else current.push(text);
		}
	},
});

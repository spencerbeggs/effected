// MD050 `strong-style`: a port of markdownlint's MD050 (in
// lib/md049-md050.mjs) over the kit tree (see `emphasisStyleReports`).

import type * as Lint from "@effected/markdown-lint";
import { emphasisStyleReports } from "../internal/emphasis-style.js";
import { LintRule } from "../LintRule.js";

/**
 * MD050 `strong-style`: strong emphasis uses one marker, `**` or `__`.
 *
 * @remarks
 * markdownlint's setting: `style` (default `consistent`, the first strong's;
 * `asterisk` or `underscore`), read as `style || undefined`, so a falsy value
 * is the default and any other value is compared as it is. Under
 * `underscore`, an asterisk strong inside a word is left, as `__` cannot
 * emphasize there. The fix swaps both markers.
 *
 * @public
 */
export const MD050: Lint.LintRule = LintRule.make({
	names: ["MD050", "strong-style"],
	description: "Strong style",
	tags: ["emphasis"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md050.md",
	check: (context, report) => {
		for (const each of emphasisStyleReports(context, "strong", "**", "__")) report(context.diagnostic(each));
	},
});

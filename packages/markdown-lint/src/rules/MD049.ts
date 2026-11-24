// MD049 `emphasis-style`: a port of markdownlint's MD049 (in
// lib/md049-md050.mjs) over the kit tree (see `emphasisStyleReports`).

import type * as Lint from "@effected/markdown-lint";
import { emphasisStyleReports } from "../internal/emphasis-style.js";
import { LintRule } from "../LintRule.js";

/**
 * MD049 `emphasis-style`: emphasis uses one marker, `*` or `_`.
 *
 * @remarks
 * markdownlint's setting: `style` (default `consistent`, the first
 * emphasis's; `asterisk` or `underscore`), read as `style || undefined`, so a
 * falsy value is the default and any other value is compared as it is. Under
 * `underscore`, an asterisk emphasis inside a word is left, as `_` cannot
 * emphasize there. The fix swaps both markers.
 *
 * @public
 */
export const MD049: Lint.LintRule = LintRule.make({
	names: ["MD049", "emphasis-style"],
	description: "Emphasis style",
	tags: ["emphasis"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md049.md",
	check: (context, report) => {
		for (const each of emphasisStyleReports(context, "emphasis", "*", "_")) report(context.diagnostic(each));
	},
});

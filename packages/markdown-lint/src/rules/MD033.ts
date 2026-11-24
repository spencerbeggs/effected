// MD033 `no-inline-html`: a port of markdownlint's lib/md033.mjs over the kit
// tree. markdownlint reports its `htmlText` tokens that open an element:
// inline HTML, and the tags inside each HTML block, which it re-parses.
// `htmlTextTokens` reads both from the kit tree.

import type * as Lint from "@effected/markdown-lint";
import { htmlTagInfo, htmlTextRange, htmlTextTokens } from "../internal/html-text.js";
import { lowerCaseList, rawSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

/**
 * MD033 `no-inline-html`: no raw HTML.
 *
 * @remarks
 * markdownlint's settings: `allowed_elements` and `table_allowed_elements`
 * (default `[]`; element names, any case). As in markdownlint, a list that
 * is not an array allows nothing, and a falsy `table_allowed_elements`
 * reads as `allowed_elements`.
 *
 * @public
 */
export const MD033: Lint.LintRule = LintRule.make({
	names: ["MD033", "no-inline-html"],
	description: "Inline HTML",
	tags: ["html"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md033.md",
	check: (context, report) => {
		const allowed = lowerCaseList(rawSetting(context.config, "allowed_elements"));
		const tableAllowed = lowerCaseList(
			rawSetting(context.config, "table_allowed_elements") || rawSetting(context.config, "allowed_elements"),
		);
		for (const token of htmlTextTokens(context)) {
			const tag = htmlTagInfo(token.text);
			if (tag === undefined || tag.close) continue;
			if (!(token.inTable ? tableAllowed : allowed).includes(tag.name.toLowerCase())) {
				report(
					context.diagnostic({
						at: { offset: token.offset, length: 0 },
						detail: `Element: ${tag.name}`,
						range: htmlTextRange(token),
					}),
				);
			}
		}
	},
});

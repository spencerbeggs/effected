// MD026 `no-trailing-punctuation`: a port of markdownlint's lib/md026.mjs
// over the kit tree. A heading's text span runs from its first child's start
// to its last child's end, micromark's heading text token.

import type { MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { headingNodes } from "../internal/headings.js";
import { stringSettingUnlessAbsent } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

const allPunctuationNoQuestion = ".,;:!。，；：！";

// A heading that ends in an HTML entity or a GitHub emoji code ends in punctuation that is not.
const endOfLineHtmlEntity = /&(?:#\d+|#[xX][\da-fA-F]+|[a-zA-Z]{2,31}|blk\d{2}|emsp1[34]|frac\d{2}|sup\d|there4);$/;
const endOfLineGemojiCode =
	/:(?:[abmovx]|[-+]1|100|1234|(?:1st|2nd|3rd)_place_medal|8ball|clock\d{1,4}|e-mail|non-potable_water|o2|t-rex|u5272|u5408|u55b6|u6307|u6708|u6709|u6e80|u7121|u7533|u7981|u7a7a|[a-z]{2,15}2?|[a-z]{1,14}(?:_[a-z\d]{1,16})+):$/;

const escapeForRegExp = (text: string): string => text.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/**
 * MD026 `no-trailing-punctuation`: headings do not end in punctuation.
 *
 * @remarks
 * markdownlint's setting: `punctuation` (default `.,;:!。，；：！`); `""`
 * allows every character. Settings are coerced as markdownlint coerces them
 * (`"50"` reads as `50`, `0` as `false`).
 *
 * @public
 */
export const MD026: Lint.LintRule = LintRule.make({
	names: ["MD026", "no-trailing-punctuation"],
	description: "Trailing punctuation in heading",
	tags: ["headings"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md026.md",
	check: (context, report) => {
		const punctuation = stringSettingUnlessAbsent(context.config, "punctuation", allPunctuationNoQuestion);
		const trailing = new RegExp(`\\s*[${escapeForRegExp(punctuation)}]+$`);
		for (const heading of headingNodes(context)) {
			const children = heading.children as ReadonlyArray<MarkdownNode>;
			const first = children[0];
			const last = children.at(-1);
			if (first === undefined || last === undefined) continue;
			const end = last.position.end.offset;
			const text = context.source.slice(first.position.start.offset, end);
			const match = trailing.exec(text);
			if (match === null || endOfLineHtmlEntity.test(text) || endOfLineGemojiCode.test(text)) continue;
			const length = match[0].length;
			report(
				context.diagnostic({
					at: { offset: end - length, length: 0 },
					detail: `Punctuation: '${match[0]}'`,
					range: { offset: end - length, length },
					fix: { offset: end - length, length, content: "" },
				}),
			);
		}
	},
});

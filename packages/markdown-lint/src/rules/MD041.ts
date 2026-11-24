// MD041 `first-line-heading`: a port of markdownlint's lib/md041.mjs over the
// kit tree. markdownlint walks the top-level tokens after any HTML comments;
// this module walks the top-level blocks. An HTML block's tag is its first
// tag, read from its source text, as markdownlint's re-parse of the block
// finds it.

import type { Heading } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { contentBlocks, frontMatterHasTitle } from "../internal/headings.js";
import { isHtmlFlowComment } from "../internal/html-text.js";
import { errorContext } from "../internal/lines.js";
import { flagSetting, numberSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

const headingTagName = /^h[1-6]$/;

/**
 * MD041 `first-line-heading`: a document starts with a top-level heading.
 *
 * @remarks
 * markdownlint's settings: `level` (default `1`), `allow_preamble` (default
 * `false`) and `front_matter_title` (default `^\s*"?title"?\s*[:=]`; a front
 * matter title satisfies the rule, and `""` turns that off). Settings are coerced as markdownlint coerces them
 * (`"50"` reads as `50`, `0` as `false`).
 *
 * @public
 */
export const MD041: Lint.LintRule = LintRule.make({
	names: ["MD041", "first-line-heading", "first-line-h1"],
	description: "First line in a file should be a top-level heading",
	tags: ["headings"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md041.md",
	check: (context, report) => {
		const allowPreamble = flagSetting(context.config, "allow_preamble");
		const level = numberSetting(context.config, "level", 1);
		if (frontMatterHasTitle(context)) return;
		let errorLine = 0;
		for (const block of contentBlocks(context)) {
			if (isHtmlFlowComment(context, block)) continue;
			if (block.type === "heading") {
				if ((block as Heading).depth !== level) errorLine = block.position.start.line;
				break;
			}
			const html =
				block.type === "html"
					? context.source.slice(block.position.start.offset, block.position.end.offset)
					: undefined;
			const tagName = html === undefined ? undefined : /^\s*<([^!>][^/\s>]*)/.exec(html)?.[1]?.toLowerCase();
			if (tagName !== undefined && !tagName.startsWith("/") && headingTagName.test(tagName)) {
				if (tagName !== `h${level}`) errorLine = block.position.start.line;
				break;
			}
			if (!allowPreamble) {
				errorLine = block.position.start.line;
				break;
			}
		}
		if (errorLine === 0) return;
		report(
			context.diagnostic({
				at: { offset: context.mapping.lineStart(errorLine), length: 0 },
				context: errorContext(context.lines[errorLine - 1] as string),
			}),
		);
	},
});

// MD025 `single-title`: a port of markdownlint's lib/md025.mjs over the kit
// tree. Whether the first matching heading is the document's title is read
// from the top-level blocks before it, which may only be HTML comments.

import type { Link } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { contentBlocks, frontMatterHasTitle, headingNodes, headingStyle, headingText } from "../internal/headings.js";
import { isHtmlFlowComment } from "../internal/html-text.js";
import { errorContext } from "../internal/lines.js";
import { numberSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

/**
 * MD025 `single-title`: a document has one top-level heading.
 *
 * @remarks
 * markdownlint's settings: `level` (default `1`) and `front_matter_title`
 * (default `^\s*"?title"?\s*[:=]`; a front matter title counts as the
 * document's title, and `""` turns that off). A heading that is a DocFX tab
 * (`# [Name](#tab/id)`) is skipped. Settings are coerced as markdownlint coerces them
 * (`"50"` reads as `50`, `0` as `false`).
 *
 * @public
 */
export const MD025: Lint.LintRule = LintRule.make({
	names: ["MD025", "single-title", "single-h1"],
	description: "Multiple top-level headings in the same document",
	tags: ["headings"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md025.md",
	check: (context, report) => {
		const level = numberSetting(context.config, "level", 1);
		const matching = headingNodes(context).filter((heading) => {
			if (heading.depth !== level) return false;
			// markdownlint's `isDocfxTab`: an ATX heading whose text is one link to `#tab/…`.
			const [only] = heading.children;
			const docfxTab =
				headingStyle(context, heading) !== "setext" &&
				heading.children.length === 1 &&
				only?.type === "link" &&
				(only as Link).url.startsWith("#tab/");
			return !docfxTab;
		});
		const [first] = matching;
		if (first === undefined) return;
		const hasTitle = frontMatterHasTitle(context);
		let topLevel = hasTitle;
		if (!topLevel) {
			const blocks = contentBlocks(context);
			const index = blocks.indexOf(first);
			if (index !== -1) {
				topLevel = blocks.slice(0, index).every((block) => isHtmlFlowComment(context, block));
			} else {
				// markdownlint looks the heading up among the top-level tokens; a nested heading is not one, and its
				// `slice(0, -1)` then reads every top-level token but the last, which is a line break when one follows.
				const last = blocks.at(-1);
				const tail = last === undefined ? "" : context.source.slice(last.position.end.offset);
				topLevel = !/[\r\n]/.test(tail) && blocks.slice(0, -1).every((block) => isHtmlFlowComment(context, block));
			}
		}
		if (!topLevel) return;
		for (const heading of matching.slice(hasTitle ? 0 : 1)) {
			report(
				context.diagnostic({
					at: { offset: heading.position.start.offset, length: 0 },
					context: errorContext(headingText(context, heading)),
				}),
			);
		}
	},
});

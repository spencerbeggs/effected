// MD045 `no-alt-text`: a port of markdownlint's lib/md045.mjs over the kit
// tree. markdownlint reports each `image` token whose label text is empty —
// an inline image, or a reference image whose label is defined (micromark
// makes no image of any other) — and each `htmlText` token opening an `img`
// with no `alt` attribute and no `aria-hidden="true"`. The kit's `image`
// and defined `imageReference` nodes give the first, read as written, less
// any inside inline or block math; `htmlTextTokens` gives the second.

import type * as Lint from "@effected/markdown-lint";
import { htmlTagInfo, htmlTextRange, htmlTextTokens } from "../internal/html-text.js";
import { mathFlowLines } from "../internal/math-flow.js";
import { inSpans, mathTextSpans } from "../internal/math-text.js";
import { LintRule } from "../LintRule.js";

// markdownlint's `getHtmlAttributeRe("alt")` and `getHtmlAttributeRe("aria-hidden")`.
const altAttribute = /\salt\s*=\s*['"]?([^'"\s>]*)/iu;
const ariaHiddenAttribute = /\saria-hidden\s*=\s*['"]?([^'"\s>]*)/iu;

/**
 * MD045 `no-alt-text`: images have alternate text.
 *
 * @remarks
 * markdownlint's rule has no settings.
 *
 * @public
 */
export const MD045: Lint.LintRule = LintRule.make({
	names: ["MD045", "no-alt-text"],
	description: "Images should have alternate text (alt text)",
	tags: ["accessibility", "images"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md045.md",
	check: (context, report) => {
		const math = mathFlowLines(context);
		const mathText = mathTextSpans(context.document, context.source);
		for (const entry of context.document.links) {
			const node = entry.node;
			if (node.type !== "image" && !(node.type === "imageReference" && entry.url !== undefined)) continue;
			const start = node.position.start.offset;
			if (math.has(node.position.start.line) || inSpans(mathText, start)) continue;
			// The label, as written, is empty: `![]`.
			if (context.source.charAt(start + 2) !== "]") continue;
			report(context.diagnostic({ at: node, range: node.position.start.line === node.position.end.line }));
		}
		for (const token of htmlTextTokens(context)) {
			const tag = htmlTagInfo(token.text);
			if (tag === undefined || tag.close || tag.name.toLowerCase() !== "img") continue;
			if (altAttribute.test(token.text) || ariaHiddenAttribute.exec(token.text)?.[1]?.toLowerCase() === "true")
				continue;
			report(
				context.diagnostic({
					at: { offset: token.offset, length: 0 },
					range: htmlTextRange(token),
				}),
			);
		}
	},
});

// MD059 `descriptive-link-text`: a port of markdownlint's lib/md059.mjs over
// the kit tree. markdownlint reads each `link` token's `labelText` (a link
// with a label or a defined reference, not an image) and compares its source,
// normalized, with the prohibited texts, unless the label holds a code span
// or inline HTML directly. The kit reads the same from each link and link
// reference, and the links of image descriptions from source (see
// `imageLabelNodes`). Links micromark reads as math, or inside an HTML block,
// are none.

import type { MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { imageLabelNodes, inlineNodes } from "../internal/inline.js";
import { errorContext } from "../internal/lines.js";
import { labelEnd } from "../internal/math-text.js";
import { LintRule } from "../LintRule.js";

const defaultProhibitedTexts = ["click here", "here", "link", "more"];

// markdownlint's `normalize`: punctuation and runs of space as one space, lower case, trimmed.
const normalize = (text: string): string =>
	text
		.replace(/[\W_]+/g, " ")
		.replace(/\s+/g, " ")
		.toLowerCase()
		.trim();

/**
 * MD059 `descriptive-link-text`: link text says where the link goes.
 *
 * @remarks
 * markdownlint's setting: `prohibited_texts` (default `click here`, `here`,
 * `link`, `more`), compared after removing punctuation, collapsing space and
 * lowering case; read as `prohibited_texts || default`, so a falsy value is
 * the default and an empty list checks nothing. Where markdownlint throws (a
 * value that is no list, or a list holding a value that is no string), the
 * kit reads the default. A label holding a code span or inline HTML directly
 * is not checked.
 *
 * @public
 */
export const MD059: Lint.LintRule = LintRule.make({
	names: ["MD059", "descriptive-link-text"],
	description: "Link text should be descriptive",
	tags: ["accessibility", "links"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md059.md",
	check: (context, report) => {
		const setting = context.config.prohibited_texts || defaultProhibitedTexts;
		const texts =
			Array.isArray(setting) && setting.every((each): each is string => typeof each === "string")
				? setting
				: defaultProhibitedTexts;
		const prohibited = new Set(texts.map(normalize));
		if (prohibited.size === 0) return;
		const { source } = context;
		const labels: Array<readonly [number, number]> = [];
		for (const type of ["link", "linkReference"]) {
			for (const node of inlineNodes(context, type)) {
				const open = node.position.start.offset;
				// An autolink has no label.
				if (source.charAt(open) !== "[") continue;
				const children = (node as { readonly children?: ReadonlyArray<MarkdownNode> }).children ?? [];
				const coded = children.some((child) => child.type === "inlineCode" || child.type === "html");
				if (!coded) labels.push([open, labelEnd(source, open, node.position.end.offset)]);
			}
		}
		const spans = imageLabelNodes(context);
		const coded = new Set(spans.filter((span) => span.type === "linkLabelCoded").map((span) => span.start));
		for (const span of spans) {
			if (span.type === "linkLabel" && !coded.has(span.start)) labels.push([span.start, span.end - 1]);
		}
		labels.sort((a, b) => a[0] - b[0]);
		for (const [open, close] of labels) {
			const text = source.slice(open + 1, close);
			// An empty label has no `labelText`.
			if (text.length === 0 || !prohibited.has(normalize(text))) continue;
			const oneLine = context.mapping.lineNumber(open + 1) === context.mapping.lineNumber(close);
			report(
				context.diagnostic({
					at: { offset: open + 1, length: 0 },
					context: errorContext(source.slice(open, close + 1)),
					...(oneLine ? { range: { offset: open + 1, length: text.length } } : {}),
				}),
			);
		}
	},
});

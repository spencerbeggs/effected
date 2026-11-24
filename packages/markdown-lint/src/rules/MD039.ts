// MD039 `no-space-in-links`: a port of markdownlint's lib/md039.mjs over the
// kit tree. markdownlint reads each link's `label` (a link with a label or a
// defined reference, not an image) and its `labelText`, the source between the
// brackets; the kit reads the same from each link and link reference, and the
// links of image descriptions from source (see `imageLabelNodes`). Links
// micromark reads as math, or inside an HTML block, are none.

import type * as Lint from "@effected/markdown-lint";
import { imageLabelNodes, inlineNodes } from "../internal/inline.js";
import { errorContext } from "../internal/lines.js";
import { labelEnd } from "../internal/math-text.js";
import type { LintContext, LintReport } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

// markdownlint's `[^\S\r\n]` under re2, whose `\s` is ASCII (`[\t\n\f\r ]`): a no-break space is none, though
// `trimStart` and `trimEnd` trim it.
const startSpaces = /^[\t\f ]+/;
const endSpaces = /[\t\f ]+$/;

// The reports for one label: `[open, close]` its brackets.
const labelReports = (context: LintContext, open: number, close: number): ReadonlyArray<LintReport> => {
	const { source } = context;
	const text = source.slice(open + 1, close);
	const label = source.slice(open, close + 1).replace(/\s+/g, " ");
	const reports: Array<LintReport> = [];
	const lineOf = (offset: number) => context.mapping.lineNumber(offset);
	if (text.trimStart().length !== text.length) {
		const match = startSpaces.exec(text);
		// No range when the label starts with a line break: markdownlint reports the next line, which holds the text.
		const line = lineOf(open + 1) + (match === null ? 1 : 0);
		reports.push({
			at: { offset: context.mapping.lineStart(line), length: 0 },
			context: errorContext(label, true, false),
			...(match === null
				? {}
				: {
						range: { offset: open + 1, length: match[0].length },
						fix: { offset: open + 1, length: match[0].length, content: "" },
					}),
		});
	}
	if (text.trimEnd().length !== text.length) {
		const match = endSpaces.exec(text);
		// markdownlint's line before the closing bracket's is none on the first line, where it throws; the kit keeps it.
		const line = Math.max(lineOf(close) - (match === null ? 1 : 0), 1);
		const length = match?.[0].length ?? 0;
		reports.push({
			at: { offset: context.mapping.lineStart(line), length: 0 },
			context: errorContext(label, false, true),
			...(match === null
				? {}
				: { range: { offset: close - length, length }, fix: { offset: close - length, length, content: "" } }),
		});
	}
	return reports;
};

/**
 * MD039 `no-space-in-links`: no space just inside a link's brackets.
 *
 * @remarks
 * No settings. The fix deletes the spaces.
 *
 * @public
 */
export const MD039: Lint.LintRule = LintRule.make({
	names: ["MD039", "no-space-in-links"],
	description: "Spaces inside link text",
	tags: ["whitespace", "links"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md039.md",
	check: (context, report) => {
		const { source } = context;
		const labels: Array<readonly [number, number]> = [];
		for (const type of ["link", "linkReference"]) {
			for (const node of inlineNodes(context, type)) {
				const open = node.position.start.offset;
				// An autolink has no label.
				if (source.charAt(open) !== "[") continue;
				labels.push([open, labelEnd(source, open, node.position.end.offset)]);
			}
		}
		for (const span of imageLabelNodes(context)) if (span.type === "linkLabel") labels.push([span.start, span.end - 1]);
		labels.sort((a, b) => a[0] - b[0]);
		for (const [open, close] of labels)
			for (const each of labelReports(context, open, close)) report(context.diagnostic(each));
	},
});

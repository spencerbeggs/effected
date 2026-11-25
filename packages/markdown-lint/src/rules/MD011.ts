// MD011 `no-reversed-links`: a port of markdownlint's lib/md011.mjs. A line
// rule over the raw content lines: `(text)[destination]` parses as text, so
// no link node exists to read. markdownlint skips code, HTML and math blocks,
// and any match its `hasOverlap` finds touching a code span or inline math
// (it treats a token's exclusive end as inclusive, so a span that ends right
// before the match counts).

import type { MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { atxLineRuleSkippedLines } from "../internal/headings.js";
import { firstContentLine } from "../internal/lines.js";
import { mathTextSpans } from "../internal/math-text.js";
import { LintRule } from "../LintRule.js";

// markdownlint's pattern (run under re2 there): no part of it backtracks past the next paren or bracket.
const reversedLink = /(^|[^\\])\(([^()]+)\)\[([^\]^][^\]]*)\]/g;

/**
 * MD011 `no-reversed-links`: link syntax is `[text](destination)`, not
 * `(text)[destination]`.
 *
 * @remarks
 * No settings. The fix writes the link the right way round.
 *
 * @public
 */
export const MD011: Lint.LintRule = LintRule.make({
	names: ["MD011", "no-reversed-links"],
	description: "Reversed link syntax",
	tags: ["links"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md011.md",
	check: (context, report) => {
		const ignored = atxLineRuleSkippedLines(context);
		// Code spans and inline math, as `[start, end]` with markdownlint's inclusive reading of the end.
		const spans = [
			...(context.document.findAll("inlineCode") as ReadonlyArray<MarkdownNode>).map((node) => ({
				start: node.position.start.offset,
				end: node.position.end.offset,
			})),
			...mathTextSpans(context.document, context.source),
		].sort((a, b) => a.start - b.start);
		// The largest span end among the spans starting at or before each index: an overlap query is one search.
		const reach: Array<number> = [];
		for (const [index, span] of spans.entries()) reach.push(Math.max(span.end, reach[index - 1] ?? -1));
		const touches = (start: number, last: number): boolean => {
			let low = 0;
			let high = spans.length - 1;
			let found = -1;
			while (low <= high) {
				const middle = (low + high) >> 1;
				if ((spans[middle]?.start ?? 0) <= last) {
					found = middle;
					low = middle + 1;
				} else high = middle - 1;
			}
			return found >= 0 && (reach[found] ?? -1) >= start;
		};
		for (let lineNumber = firstContentLine(context); lineNumber <= context.lines.length; lineNumber++) {
			if (ignored.has(lineNumber)) continue;
			const line = context.lines[lineNumber - 1] as string;
			const lineStart = context.mapping.lineStart(lineNumber);
			for (const match of line.matchAll(reversedLink)) {
				const [whole, preChar = "", linkText = "", linkDestination = ""] = match;
				const index = match.index ?? 0;
				if (line.charAt(index + whole.length) === "(" || linkText.endsWith("\\") || linkDestination.endsWith("\\")) {
					continue;
				}
				const start = lineStart + index + preChar.length;
				const length = whole.length - preChar.length;
				const last = start + length - 1;
				if (touches(start, last)) continue;
				report(
					context.diagnostic({
						at: { offset: start, length: 0 },
						detail: whole.slice(preChar.length),
						range: { offset: start, length },
						fix: { offset: start, length, content: `[${linkText}](${linkDestination})` },
					}),
				);
			}
		}
	},
});

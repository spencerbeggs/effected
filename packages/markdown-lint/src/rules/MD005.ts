// MD005 `list-indent`: a port of markdownlint's lib/md005.mjs over the kit
// tree. markdownlint walks its `listOrdered` and `listUnordered` tokens and
// each item's `listItemPrefix`; the kit's list nodes give the same lists, each
// item starting at its marker, and the lists the kit reads inside a math
// block are dropped, as micromark reads those lines as math.

import type { List, ListItem } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { listItemPrefix } from "../internal/containers.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { LintRule } from "../LintRule.js";

/**
 * MD005 `list-indent`: the items of one list start at the same column.
 *
 * @remarks
 * No settings. An unordered item off its list's column is reported without
 * a fix (MD007 fixes it); an ordered list may instead right-align its
 * markers, and an ordered item is fixed by re-indenting it.
 *
 * @public
 */
export const MD005: Lint.LintRule = LintRule.make({
	names: ["MD005", "list-indent"],
	description: "Inconsistent indentation for list items at the same level",
	tags: ["bullet", "ul", "indentation"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md005.md",
	check: (context, report) => {
		const math = mathFlowBlocks(context);
		for (const list of context.document.findAll("list") as ReadonlyArray<List>) {
			// Strict: a list starting on a math opener line holds the opener (see `inMathBlock`).
			if (inMathBlock(math, list.position.start.line)) continue;
			const expectedIndent = list.position.start.column - 1;
			let expectedEnd = 0;
			let endMatching = false;
			for (const item of list.children as ReadonlyArray<ListItem>) {
				const prefix = listItemPrefix(context, item);
				const lineStart = context.mapping.lineStart(item.position.start.line);
				const actualIndent = item.position.start.column - 1;
				const at = { offset: prefix.offset, length: 0 };
				const range = { offset: lineStart, length: actualIndent + prefix.marker + prefix.whitespace };
				if (list.ordered !== true) {
					if (expectedIndent !== actualIndent) {
						report(context.diagnostic({ at, detail: `Expected: ${expectedIndent}; Actual: ${actualIndent}`, range }));
					}
					continue;
				}
				const actualEnd = item.position.start.column + prefix.marker - 1;
				expectedEnd ||= actualEnd;
				if (expectedIndent === actualIndent && !endMatching) continue;
				if (expectedEnd === actualEnd) {
					endMatching = true;
					continue;
				}
				const detail = endMatching
					? `Expected: (${expectedEnd}); Actual: (${actualEnd})`
					: `Expected: ${expectedIndent}; Actual: ${actualIndent}`;
				const expected = endMatching ? expectedEnd - prefix.marker : expectedIndent;
				const actual = endMatching ? actualEnd - prefix.marker : actualIndent;
				report(
					context.diagnostic({
						at,
						detail,
						range,
						fix: {
							offset: lineStart + Math.min(actual, expected),
							length: Math.max(actual - expected, 0),
							content: " ".repeat(Math.max(expected - actual, 0)),
						},
					}),
				);
			}
		}
	},
});

// MD056 `table-column-count`: a port of markdownlint's lib/md056.mjs over the
// kit tree. markdownlint counts each table row's cells (see `tables`, the raw
// line's cells, where the kit pads a short row): a row with another count
// than the table's first row is reported, too few at its last column, too
// many from the first extra cell to its end.

import type * as Lint from "@effected/markdown-lint";
import { tables } from "../internal/tables.js";
import { LintRule } from "../LintRule.js";

/**
 * MD056 `table-column-count`: every table row has as many cells as the
 * header.
 *
 * @remarks
 * No settings. No fix.
 *
 * @public
 */
export const MD056: Lint.LintRule = LintRule.make({
	names: ["MD056", "table-column-count"],
	description: "Table column count",
	tags: ["table"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md056.md",
	check: (context, report) => {
		for (const table of tables(context)) {
			let expected = 0;
			for (const row of table.rows) {
				const actual = row.cells.length;
				expected ||= actual;
				if (actual === expected) continue;
				const lineStart = context.mapping.lineStart(row.lineNumber);
				const tooFew = actual < expected;
				const from = tooFew ? row.endColumn - 1 : (row.cells[expected]?.startColumn ?? row.endColumn - 1);
				report(
					context.diagnostic({
						at: { offset: lineStart, length: 0 },
						detail: `Expected: ${expected}; Actual: ${actual}; ${tooFew ? "Too few cells, row will be missing data" : "Too many cells, extra data will be missing"}`,
						range: { offset: lineStart + from - 1, length: tooFew ? 1 : row.endColumn - from },
					}),
				);
			}
		}
	},
});

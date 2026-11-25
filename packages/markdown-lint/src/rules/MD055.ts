// MD055 `table-pipe-style`: a port of markdownlint's lib/md055.mjs over the
// kit tree. markdownlint reads each table row's first and last cell (see
// `tables`): a leading pipe is the first cell's first token past blanks, a
// trailing pipe the last cell's last. The style `consistent` (and, per table,
// `per_table`) takes the first row's; any other style expects a leading pipe
// unless it is `no_leading_or_trailing` or `trailing_only`, and a trailing
// pipe unless it is `no_leading_or_trailing` or `leading_only`.

import type * as Lint from "@effected/markdown-lint";
import { stringSetting } from "../internal/settings.js";
import type { TableCell } from "../internal/tables.js";
import { tables } from "../internal/tables.js";
import { LintRule } from "../LintRule.js";

const solid = (cell: TableCell | undefined) => cell?.tokens.filter((token) => token.type !== "whitespace") ?? [];

/**
 * MD055 `table-pipe-style`: table rows use leading and trailing pipes
 * consistently.
 *
 * @remarks
 * Setting: `style` (default `consistent`; `leading_only`, `trailing_only`,
 * `leading_and_trailing`, `no_leading_or_trailing`, or `per_table`, which
 * takes each table's first row's). No fix.
 *
 * @public
 */
export const MD055: Lint.LintRule = LintRule.make({
	names: ["MD055", "table-pipe-style"],
	description: "Table pipe style",
	tags: ["table"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md055.md",
	check: (context, report) => {
		const style = stringSetting(context.config, "style", "consistent");
		let expectedStyle = style;
		let expectedLeadingPipe = expectedStyle !== "no_leading_or_trailing" && expectedStyle !== "trailing_only";
		let expectedTrailingPipe = expectedStyle !== "no_leading_or_trailing" && expectedStyle !== "leading_only";
		for (const table of tables(context)) {
			if (style === "per_table") expectedStyle = "consistent";
			for (const row of table.rows) {
				const firstCell = row.cells[0];
				const lastCell = row.cells[row.cells.length - 1];
				if (firstCell === undefined || lastCell === undefined) continue;
				const actualLeadingPipe = solid(firstCell)[0]?.type === "tableCellDivider";
				const trailing = solid(lastCell);
				const actualTrailingPipe = trailing[trailing.length - 1]?.type === "tableCellDivider";
				const actualStyle = actualLeadingPipe
					? actualTrailingPipe
						? "leading_and_trailing"
						: "leading_only"
					: actualTrailingPipe
						? "trailing_only"
						: "no_leading_or_trailing";
				if (expectedStyle === "consistent") {
					expectedStyle = actualStyle;
					expectedLeadingPipe = actualLeadingPipe;
					expectedTrailingPipe = actualTrailingPipe;
				}
				if (expectedStyle === actualStyle) continue;
				const lineStart = context.mapping.lineStart(row.lineNumber);
				if (actualLeadingPipe !== expectedLeadingPipe) {
					report(
						context.diagnostic({
							at: { offset: lineStart, length: 0 },
							detail: `Expected: ${expectedStyle}; Actual: ${actualStyle}; ${expectedLeadingPipe ? "Missing" : "Unexpected"} leading pipe`,
							range: {
								offset: lineStart + row.startColumn - 1,
								length: firstCell.startColumn - row.startColumn + 1,
							},
						}),
					);
				}
				if (actualTrailingPipe !== expectedTrailingPipe) {
					report(
						context.diagnostic({
							at: { offset: lineStart, length: 0 },
							detail: `Expected: ${expectedStyle}; Actual: ${actualStyle}; ${expectedTrailingPipe ? "Missing" : "Unexpected"} trailing pipe`,
							range: {
								offset: lineStart + lastCell.endColumn - 2,
								length: row.endColumn - lastCell.endColumn + 1,
							},
						}),
					);
				}
			}
		}
	},
});

// MD060 `table-column-style`: a port of markdownlint's lib/md060.mjs over the
// kit tree. markdownlint reads each table row's `tableCellDivider`,
// `tableContent` and `whitespace` tokens; the kit's `table` nodes give the
// tables and their lines, and each row's tokens are read from its raw line,
// as the author wrote it (the kit pads a short row with empty cells): the
// row's text after its containers' markers and its indentation, split at each
// pipe no backslash escapes, a cell's leading and trailing blanks its
// whitespace. Widths are string-width's, as markdownlint measures them.

import type * as Lint from "@effected/markdown-lint";
import { prefixWidths } from "../internal/string-width.js";
import type { TableRow } from "../internal/tables.js";
import { tables } from "../internal/tables.js";
import { LintRule } from "../LintRule.js";

type Row = TableRow;

/** A finding as markdownlint's MD060 collects it. */
interface ErrorInfo {
	readonly lineNumber: number;
	readonly column: number;
	readonly detail: string;
	readonly fix?: { readonly editColumn: number; readonly deleteCount?: number; readonly insertText?: string };
}

// Text that could represent an unordered list item prefix: an edit making a cell one is not offered.
const unorderedListPrefix = /^[>\s]*[-+*]$/;

/**
 * MD060 `table-column-style`: table pipes are used consistently.
 *
 * @remarks
 * markdownlint's settings: `style` (default `any`; `aligned`, `compact`,
 * `tight` or `any`) and `aligned_delimiter` (default `false`). As in
 * markdownlint, a falsy `style` reads as `any`, a name it does not know
 * allows no style and reports nothing, and `aligned_delimiter` is read by
 * truthiness.
 *
 * @public
 */
export const MD060: Lint.LintRule = LintRule.make({
	names: ["MD060", "table-column-style"],
	description: "Table column style",
	tags: ["table"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md060.md",
	check: (context, report) => {
		const style = String(context.config.style || "any");
		const alignedAllowed = style === "any" || style === "aligned";
		const compactAllowed = style === "any" || style === "compact";
		const tightAllowed = style === "any" || style === "tight";
		const alignedDelimiter = !!context.config.aligned_delimiter;
		const lineText = (lineNumber: number): string => context.lines[lineNumber - 1] ?? "";

		const addError = (errors: Array<ErrorInfo>, error: ErrorInfo): void => {
			const fix = error.fix;
			const dropFix =
				fix !== undefined &&
				fix.insertText === " " &&
				unorderedListPrefix.test(lineText(error.lineNumber).slice(0, fix.editColumn - 1));
			errors.push(dropFix ? { lineNumber: error.lineNumber, column: error.column, detail: error.detail } : error);
		};

		const dividerColumns = (row: Row) => {
			const dividers = row.tokens.filter((token) => token.type === "tableCellDivider");
			const widths = prefixWidths(
				lineText(row.lineNumber),
				dividers.map((divider) => divider.startColumn - 1),
			);
			return dividers.map((divider, index) => ({ actual: divider.startColumn, effective: widths[index] as number }));
		};

		const checkAligned = (rows: ReadonlyArray<Row>, detail: string): Array<ErrorInfo> => {
			const errors: Array<ErrorInfo> = [];
			const [header, ...rest] = rows;
			if (header === undefined) return errors;
			const headerColumns = dividerColumns(header);
			for (const row of rest) {
				const remaining = new Set(headerColumns.map((column) => column.effective));
				for (const column of dividerColumns(row)) {
					if (remaining.size > 0 && !remaining.delete(column.effective)) {
						addError(errors, { lineNumber: row.lineNumber, column: column.actual, detail });
					}
				}
			}
			return errors;
		};

		for (const table of tables(context)) {
			const { rows } = table;

			const errorsIfAligned = alignedAllowed
				? checkAligned(rows, 'Table pipe does not align with header for style "aligned"')
				: [];
			const errorsIfCompact: Array<ErrorInfo> = [];
			const errorsIfTight: Array<ErrorInfo> = [];
			if ((compactAllowed || tightAllowed) && !(alignedAllowed && errorsIfAligned.length === 0)) {
				if (alignedDelimiter) {
					const errors = checkAligned(
						rows.slice(0, 2),
						'Table pipe does not align with header for option "aligned_delimiter"',
					);
					for (const error of errors) {
						errorsIfCompact.push(error);
						errorsIfTight.push(error);
					}
				}
				for (const row of rows) {
					const tokens = row.tokens;
					for (const [index, token] of tokens.entries()) {
						if (token.type !== "tableCellDivider") continue;
						const at = { lineNumber: row.lineNumber, column: token.startColumn };
						const previous = tokens[index - 1];
						if (previous !== undefined) {
							const length = previous.endColumn - previous.startColumn;
							if (previous.type === "whitespace") {
								if (length !== 1) {
									addError(errorsIfCompact, {
										...at,
										detail: 'Table pipe has extra space to the left for style "compact"',
										fix: { editColumn: previous.startColumn, deleteCount: length - 1 },
									});
								}
								addError(errorsIfTight, {
									...at,
									detail: 'Table pipe has space to the left for style "tight"',
									fix: { editColumn: previous.startColumn, deleteCount: length },
								});
							} else {
								addError(errorsIfCompact, {
									...at,
									detail: 'Table pipe is missing space to the left for style "compact"',
									fix: { editColumn: previous.endColumn, insertText: " " },
								});
							}
						}
						const next = tokens[index + 1];
						if (next !== undefined) {
							const length = next.endColumn - next.startColumn;
							if (next.type === "whitespace") {
								if (next.endColumn !== row.endColumn) {
									if (length !== 1) {
										addError(errorsIfCompact, {
											...at,
											detail: 'Table pipe has extra space to the right for style "compact"',
											fix: { editColumn: next.startColumn, deleteCount: length - 1 },
										});
									}
									addError(errorsIfTight, {
										...at,
										detail: 'Table pipe has space to the right for style "tight"',
										fix: { editColumn: next.startColumn, deleteCount: length },
									});
								}
							} else {
								addError(errorsIfCompact, {
									...at,
									detail: 'Table pipe is missing space to the right for style "compact"',
									fix: { editColumn: next.startColumn, insertText: " " },
								});
							}
						}
					}
				}
			}

			// Report the allowed style with the fewest errors, as markdownlint does.
			let errors = errorsIfAligned;
			if (compactAllowed && (!alignedAllowed || errorsIfCompact.length < errors.length)) errors = errorsIfCompact;
			if (tightAllowed && (errorsIfTight.length < errors.length || (!alignedAllowed && !compactAllowed))) {
				errors = errorsIfTight;
			}
			for (const error of errors) {
				const lineStart = context.mapping.lineStart(error.lineNumber);
				const offset = lineStart + error.column - 1;
				report(
					context.diagnostic({
						at: { offset, length: 1 },
						detail: error.detail,
						range: true,
						...(error.fix === undefined
							? {}
							: {
									fix: {
										offset: lineStart + error.fix.editColumn - 1,
										length: error.fix.deleteCount ?? 0,
										content: error.fix.insertText ?? "",
									},
								}),
					}),
				);
			}
		}
	},
});

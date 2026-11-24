// markdownlint's table tokens, read from the kit's `table` nodes and each
// row's raw line, as micromark's GFM table extension tokenizes it: a row is
// its line's text after its containers' markers and its indentation, trailing
// whitespace included; it splits at each pipe no backslash escapes (a code
// span, inline math or a link does not hide one), each cell opening at its
// pipe, the last pipe and the blanks after it closing the last cell. The kit
// pads a short row with empty cells; the raw line does not.
//
// A table micromark reads inside a container directive (`:::name` ...
// `:::`, which markdownlint's directive extension parses) ends at the
// directive's closing fence, where the kit's parser reads the fence as one
// more row.

import type { MarkdownNode } from "@effected/markdown";
import type { LintContext } from "../LintContext.js";
import { contentInContainers } from "./containers.js";
import { mathFlowLines } from "./math-flow.js";
import { perReading } from "./memo.js";

/** One token of a row: its type and its 1-based start and end columns on the line. @internal */
export interface TableToken {
	readonly type: "tableCellDivider" | "tableContent" | "whitespace";
	readonly startColumn: number;
	readonly endColumn: number;
}

/** One cell: its tokens (its own pipe first, the row's last pipe and blanks after it in the last cell). @internal */
export interface TableCell {
	readonly tokens: ReadonlyArray<TableToken>;
	readonly startColumn: number;
	readonly endColumn: number;
}

/**
 * One row: its line, tokens, cells, and its 1-based start and end (the line's end) columns. A header or body row
 * starts past its indentation; the delimiter row, which micromark gives its indentation, past its containers' markers.
 * @internal
 */
export interface TableRow {
	readonly lineNumber: number;
	readonly kind: "header" | "delimiter" | "body";
	readonly tokens: ReadonlyArray<TableToken>;
	readonly cells: ReadonlyArray<TableCell>;
	readonly startColumn: number;
	readonly endColumn: number;
}

/** One table: its first and last lines and its rows. @internal */
export interface Table {
	readonly node: MarkdownNode;
	readonly startLine: number;
	readonly endLine: number;
	readonly rows: ReadonlyArray<TableRow>;
}

/** A row's tokens, read from `text` (the row, after its containers and indentation) starting at 0-based `at`. @internal */
export const rowTokens = (text: string, at: number): Array<TableToken> => {
	const tokens: Array<TableToken> = [];
	const cell = (start: number, end: number): void => {
		if (start === end) return;
		const value = text.slice(start, end);
		const lead = (/^[ \t]*/.exec(value)?.[0] ?? "").length;
		const column = (offset: number) => at + offset + 1;
		if (lead === value.length) {
			tokens.push({ type: "whitespace", startColumn: column(start), endColumn: column(end) });
			return;
		}
		const trail = (/[ \t]*$/.exec(value)?.[0] ?? "").length;
		if (lead > 0) tokens.push({ type: "whitespace", startColumn: column(start), endColumn: column(start + lead) });
		tokens.push({ type: "tableContent", startColumn: column(start + lead), endColumn: column(end - trail) });
		if (trail > 0) tokens.push({ type: "whitespace", startColumn: column(end - trail), endColumn: column(end) });
	};
	let cellStart = 0;
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "\\") index += 2;
		else if (char === "|") {
			cell(cellStart, index);
			tokens.push({ type: "tableCellDivider", startColumn: at + index + 1, endColumn: at + index + 2 });
			index++;
			cellStart = index;
		} else index++;
	}
	cell(cellStart, Math.min(index, text.length));
	return tokens;
};

// A row's cells: each opens at its pipe, or at the row's first token; the last pipe, with only blanks after it,
// closes the last cell instead of opening one.
const rowCells = (tokens: ReadonlyArray<TableToken>): Array<TableCell> => {
	let lastDivider = -1;
	for (let index = tokens.length - 1; index >= 0; index--) {
		const token = tokens[index] as TableToken;
		if (token.type === "tableCellDivider") {
			lastDivider = index;
			break;
		}
		if (token.type !== "whitespace") break;
	}
	const cells: Array<Array<TableToken>> = [];
	for (const [index, token] of tokens.entries()) {
		const current = cells[cells.length - 1];
		const opens = token.type === "tableCellDivider" && !(index === lastDivider && current !== undefined);
		if (opens || current === undefined) cells.push([token]);
		else current.push(token);
	}
	return cells.map((cell) => ({
		tokens: cell,
		startColumn: (cell[0] as TableToken).startColumn,
		endColumn: (cell[cell.length - 1] as TableToken).endColumn,
	}));
};

// The lines that close a container directive opened before them at the document's top level: `:::` with at least
// the opening's colons, nothing after.
const directiveClosers = (lines: ReadonlyArray<string>): ReadonlySet<number> => {
	const closers = new Set<number>();
	const open: Array<number> = [];
	for (const [index, line] of lines.entries()) {
		const opener = /^ {0,3}(:{3,})[A-Za-z]/.exec(line)?.[1];
		if (opener !== undefined) {
			open.push(opener.length);
			continue;
		}
		const closer = /^ {0,3}(:{3,})[ \t]*$/.exec(line)?.[1];
		if (closer !== undefined && open.length > 0 && closer.length >= (open[open.length - 1] as number)) {
			open.pop();
			closers.add(index + 1);
		}
	}
	return closers;
};

/**
 * markdownlint's tables, each with its rows' tokens and cells, in document
 * order; a table micromark reads as math (in a math block) is none. Built
 * once per reading.
 * @internal
 */
export const tables: (context: LintContext) => ReadonlyArray<Table> = perReading((context) => {
	const math = mathFlowLines(context);
	const nodes = context.document.findAll("table") as ReadonlyArray<MarkdownNode>;
	const closers = nodes.length === 0 ? new Set<number>() : directiveClosers(context.lines);
	const found: Array<Table> = [];
	for (const node of nodes) {
		const startLine = node.position.start.line;
		// Inclusive: on a math opener line, this is the fence's meta (see `mathFlowLines`).
		if (math.has(startLine)) continue;
		const rows: Array<TableRow> = [];
		for (let lineNumber = startLine; lineNumber <= node.position.end.line; lineNumber++) {
			if (closers.has(lineNumber)) break;
			const line = context.lines[lineNumber - 1] ?? "";
			const inner = contentInContainers(context, lineNumber) ?? line;
			const text = inner.replace(/^[ \t]*/, "");
			const at = line.length - text.length;
			const tokens = rowTokens(text, at);
			const kind = lineNumber === startLine ? "header" : lineNumber === startLine + 1 ? "delimiter" : "body";
			const cells = rowCells(tokens);
			// The delimiter row holds its indentation: it and its first cell start past the containers' markers alone.
			const from = kind === "delimiter" ? line.length - inner.length : at;
			const first = cells[0];
			if (first !== undefined && kind === "delimiter") cells[0] = { ...first, startColumn: from + 1 };
			rows.push({ lineNumber, kind, tokens, cells, startColumn: from + 1, endColumn: line.length + 1 });
		}
		const last = rows[rows.length - 1];
		if (last !== undefined) found.push({ node, startLine, endLine: last.lineNumber, rows });
	}
	return found;
});

// markdownlint's table tokens, read from the kit's `table` nodes and each
// row's raw line, as micromark's GFM table extension tokenizes it: a row is
// its line's text after its containers' markers and its indentation, trailing
// whitespace included; it splits at each pipe no backslash escapes (a code
// span, inline math or a link does not hide one), each cell opening at its
// pipe, the last pipe and the blanks after it closing the last cell. The kit
// pads a short row with empty cells; the raw line does not.
//
// A table micromark reads ends before a leaf directive (`::name`), a
// container directive's opening (`:::name`) and an open container
// directive's closing fence (`:::`), which markdownlint's directive extension
// parses, in any container, where the kit's parser reads each as one more row.

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

// What markdownlint's directive extension (leaf and container directives; inline ones off) reads a line's text, past
// its containers, as: a leaf (`::name`), a container's opening (`:::name`, three colons or more) — each an optional
// `[label]` (brackets balanced) then `{attributes}` (quotes honoured), nothing after but blanks — or a closing fence
// (colons alone, `close` its count). A name opens with a letter or digit and goes on with letters, digits, `_`, `-`.
const directiveLine = (
	text: string,
): { readonly kind: "leaf" | "open" } | { readonly kind: "close"; readonly colons: number } | undefined => {
	const fence = /^ {0,3}(:{2,})/.exec(text);
	if (fence === null) return undefined;
	const colons = (fence[1] as string).length;
	let at = fence[0].length;
	if (colons >= 3 && /^[ \t]*$/.test(text.slice(at))) return { kind: "close", colons };
	while (text.charAt(at) === "\t") at++;
	const name = /^[\p{L}\p{N}][\p{L}\p{N}_-]*/u.exec(text.slice(at));
	if (name === null) return undefined;
	at += name[0].length;
	if (text.charAt(at) === "[") {
		let depth = 0;
		for (; at < text.length; at++) {
			const char = text.charAt(at);
			if (char === "\\") at++;
			else if (char === "[") depth++;
			else if (char === "]" && --depth === 0) break;
		}
		if (depth !== 0) return undefined;
		at++;
	}
	if (text.charAt(at) === "{") {
		let quote = "";
		for (at++; at < text.length; at++) {
			const char = text.charAt(at);
			if (quote !== "") {
				if (char === quote) quote = "";
			} else if (char === '"' || char === "'") quote = char;
			else if (char === "}") break;
		}
		if (at >= text.length) return undefined;
		at++;
	}
	if (!/^[ \t]*$/.test(text.slice(at))) return undefined;
	return { kind: colons === 2 ? "leaf" : "open" };
};

// The lines markdownlint's directive extension reads as a directive line a table ends before: a leaf, a container's
// opening, and the fence closing an open container (one with at least its opening's colons), each read past the
// line's containers. The open containers are tracked across the document, not per container.
const directiveEnds = (context: LintContext): ReadonlySet<number> => {
	const ends = new Set<number>();
	const open: Array<number> = [];
	for (const [index, line] of context.lines.entries()) {
		if (!line.includes("::")) continue;
		const lineNumber = index + 1;
		const directive = directiveLine(contentInContainers(context, lineNumber) ?? line);
		if (directive === undefined) continue;
		if (directive.kind === "close") {
			if (open.length > 0 && directive.colons >= (open[open.length - 1] as number)) {
				open.pop();
				ends.add(lineNumber);
			}
			continue;
		}
		if (directive.kind === "open") {
			const colons = /^ {0,3}(:+)/.exec(contentInContainers(context, lineNumber) ?? line)?.[1]?.length ?? 3;
			open.push(colons);
		}
		ends.add(lineNumber);
	}
	return ends;
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
	const ends = nodes.length === 0 ? new Set<number>() : directiveEnds(context);
	const found: Array<Table> = [];
	for (const node of nodes) {
		const startLine = node.position.start.line;
		// Inclusive: on a math opener line, this is the fence's meta (see `mathFlowLines`).
		if (math.has(startLine)) continue;
		const rows: Array<TableRow> = [];
		for (let lineNumber = startLine; lineNumber <= node.position.end.line; lineNumber++) {
			if (lineNumber > startLine + 1 && ends.has(lineNumber)) break;
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

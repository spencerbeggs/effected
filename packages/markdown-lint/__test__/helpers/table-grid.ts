// A grid of GFM tables for MD055, MD056 and MD058, which read micromark's table tokens: where a table starts and ends
// (interrupting a paragraph, ended by a lazy continuation line, a block start or a blank line in a container), its
// delimiter row (alignment colons, too few or too many cells), one-column tables with and without pipes, rows with too
// few or too many cells, escaped pipes and pipes in code spans, inline math and links, leading and trailing pipe
// styles, tabs and trailing whitespace, in a paragraph, a blockquote, a list item and a footnote definition.

import type { DifferentialInput } from "./differential.js";

const tables: ReadonlyArray<readonly [string, string]> = [
	["both pipes", "| a | b |\n| - | - |\n| c | d |"],
	["leading only", "| a | b\n| - | -\n| c | d"],
	["trailing only", "a | b |\n- | - |\nc | d |"],
	["no pipes", "a | b\n- | -\nc | d"],
	["mixed pipe styles", "| a | b |\n| - | -\nc | d |\n| e | f"],
	["alignment colons", "| a | b | c | d |\n|:-|-:|:-:|--|\n| 1 | 2 | 3 | 4 |"],
	["odd delimiter row", "| a | b |\n|:--:| -- :|"],
	["delimiter with spaces", "| a | b |\n|  ---  |  :---:  |\n| c | d |"],
	["too few body cells", "| a | b | c |\n| - | - | - |\n| d |\n| e | f |"],
	["too many body cells", "| a | b |\n| - | - |\n| c | d | e | f |"],
	["too few delimiter cells", "| a | b |\n| - |\n| c | d |"],
	["too many delimiter cells", "| a |\n| - | - |\n| c |"],
	["one column with pipes", "| a |\n| - |\n| b |"],
	["one column leading pipe", "| a\n| -\n| b"],
	["one column no pipes", "a\n-\nb"],
	["one column trailing pipe", "a |\n- |\nb |"],
	["escaped pipes", "| a \\| b | c |\n| - | - |\n| \\| | d \\|"],
	["pipe in a code span", "| `a|b` | c |\n| - | - |\n| `|` | d |"],
	["pipe in inline math", "| $a|b$ | c |\n| - | - |\n| d | e |"],
	["pipe in a link", "| [a|b](u) | c |\n| - | - |\n| [d](u|v) | e |"],
	["empty cells", "| | |\n|-|-|\n| | x |\n||\n| |"],
	["tabs", "|\ta\t|\tb\t|\n|\t-\t|\t-\t|\n|\tc\t|\td\t|"],
	["trailing whitespace", "| a | b |   \n| - | - |\t\n| c | d |  "],
	["indented", "   | a | b |\n   | - | - |\n   | c | d |"],
	["header only", "| a | b |\n| - | - |"],
	["after a paragraph", "text\n| a | b |\n| - | - |\n| c | d |"],
	["lazy continuation after", "| a | b |\n| - | - |\n| c | d |\nlazy text"],
	["block start after", "| a | b |\n| - | - |\n| c | d |\n# heading"],
	["list after", "| a | b |\n| - | - |\n| c | d |\n- item"],
	["fence after", "| a | b |\n| - | - |\n| c | d |\n```\ncode\n```"],
	["no delimiter row", "| a | b |\n| c | d |"],
	["delimiter row only", "| - | - |\n| a | b |"],
	["header not matching delimiter", "| a | b | c |\n| - | - |\n| d | e |"],
	["html after", "| a | b |\n| - | - |\n<div>x</div>"],
	["two tables", "| a | b |\n| - | - |\n\n| c |\n| - |\n| d |"],
	["long run of pipes", "| a | b |\n| - | - |\n|||||||||"],
];

const placements: ReadonlyArray<readonly [string, (table: string) => string]> = [
	["document", (table) => `Text.\n\n${table}\n\nText.\n`],
	["tight", (table) => `${table}\n`],
	["blockquote", (table) => `> Text.\n>\n${table.replace(/^/gm, "> ")}\n>\n> Text.\n`],
	["tight blockquote", (table) => `${table.replace(/^/gm, "> ")}\nText.\n`],
	["list item", (table) => `- Item\n\n${table.replace(/^/gm, "  ")}\n\n- Item\n`],
	["tight list item", (table) => `- Item\n${table.replace(/^/gm, "  ")}\n- Item\n`],
	["footnote definition", (table) => `Text[^1].\n\n[^1]: Note.\n\n${table.replace(/^/gm, "    ")}\n`],
	["CRLF", (table) => `Text.\r\n\r\n${table.replace(/\n/g, "\r\n")}\r\n\r\nText.\r\n`],
	["bare CR", (table) => `Text.\r\r${table.replace(/\n/g, "\r")}\r\rText.\r`],
];

export const tableGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const [name, table] of tables) {
		for (const [place, wrap] of placements) grid.push({ name: `${name} in ${place}`, source: wrap(table) });
	}
	return grid;
})();

// A parser-reading difference: a body row that is a lone `|` continues micromark's table, where the kit's parser,
// following cmark-gfm (a row must hold a cell to continue a table), ends the table before it.
export const lonePipeRows: ReadonlyArray<DifferentialInput> = [
	{ name: "lone pipe row", source: "| a | b |\n| - | - |\n|\n" },
	{ name: "lone pipe row before more rows", source: "| a | b |\n| - | - |\n| c | d |\n|\n| e | f |\n\ntext\n" },
];

// A grid for the `data`-token splitter (`textTokens` in src/internal/inline.ts): where micromark cuts its `data`
// tokens (marker runs it leaves bare, unmatched label openers, escapes, character references, line endings, inline
// math), in each block, container and HTML block, beside the emphasis, code-span and proper-names grids' shapes.

import { codeSpanGrid } from "./code-span-grid.js";
import type { DifferentialInput } from "./differential.js";
import { emphasisGrid, emphasisStyleGrid } from "./emphasis-grid.js";
import { properNamesGrid } from "./proper-names-grid.js";

const cuts: ReadonlyArray<readonly [string, string]> = [
	["bracket inside a word", "a[Z]b\n"],
	["bracket after a space", "x [y] z\n"],
	["unclosed bracket", "X[Y\n"],
	["closing bracket only", "a]b\n"],
	["escaped bracket", "\\[Z] q\n"],
	["undefined full reference", "[x][Z]\n"],
	["undefined shortcut", "[Z] and [x]\n"],
	["image opener", "a![b and a!b\n"],
	["named reference", "a&amp;b and a&copy;b\n"],
	["unknown reference", "a&bogus;b\n"],
	["numeric references", "a&#35;b&#x41;c\n"],
	["escapes", "a\\\\b and a\\*b and a\\_b\n"],
	["backslash before a letter", "a\\b\n"],
	["bracket in strong", "**a [b] c**\n"],
	["escape in emphasis", "*a\\*b*\n"],
	["link then bracket", "[l](u) a[b\n"],
	["hard break by spaces", "a  \nb\n"],
	["hard break by backslash", "a\\\nb\n"],
	["trailing space before a break", "a \nb\n"],
	["continuation indent", "a\n   b\n"],
	["quoted continuation", "> a\n> b c\n"],
	["listed continuation", "- a\n  b\n"],
	["strikethrough", "a~~b~~c\n"],
	["intraword markers", "my_x_var and **my_x_var**\n"],
	["math beside text", "$a$b and a$b\n"],
	["heading", "# a *b* [c #\n"],
	["table cell", "| a | b |\n| - | - |\n| x [y | z |\n"],
	["footnote", "x[^1]\n\n[^1]: y\n"],
	["link with title", '[l](u "t") w\n'],
	["inline html", "a <b> c\n"],
	["code span", "`c` d\n"],
	["autolink literal", "www.x.com y\n"],
	["html block", "<div>\nmy_x_var a[b]c\n</div>\n"],
	["html paragraph block", "<p>my_x_var</p>\n"],
	["quoted html block", "> <div>\n> my_x_var\n> </div>\n"],
	["image alt", "![a [b c](u)\n"],
	["image alt code", "![`x` y](u)\n"],
	["nested image alt", "![a ![b](j) c](i)\n"],
	["link in an image alt", "![x [a b](u) y](i)\n"],
];

export const dataTokenGrid: ReadonlyArray<DifferentialInput> = [
	...cuts.map(([name, source]) => ({ name, source })),
	...properNamesGrid,
	...emphasisGrid,
	...emphasisStyleGrid,
	...codeSpanGrid,
];

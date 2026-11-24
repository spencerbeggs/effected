// A grid of reference links, images and footnote calls for MD052, MD053 and MD054, which read markdownlint's
// reference link and image data: every reference form (full, collapsed, shortcut, chained, image, footnote, empty,
// undefined), with and without the definitions it names, in every placement (each block and container, emphasis,
// image alts, link labels, code, math, inline and block HTML, a task list item, a footnote definition, CRLF, tabs),
// beside label shapes markdownlint normalizes (case, whitespace, escapes, character references, Unicode).

import type { DifferentialInput } from "./differential.js";

const forms: ReadonlyArray<string> = [
	"[r]",
	"[r][]",
	"[t][r]",
	"[t][r][s]",
	"![r]",
	"![r][]",
	"![t][r]",
	"[^n]",
	"[t](u)",
	"[]",
	"[ ]",
	"[t][]x[r]",
	"[t] [r]",
	"[[r]]",
	"[t [r] u]",
	"[t [x](u) w]",
	"[t](u) w]",
	"[R]",
];

const definitionSets: ReadonlyArray<readonly [string, string]> = [
	["none", ""],
	["defined", "\n\n[r]: https://r.example\n[s]: <>\n[n]: #\n[^n]: note\n"],
];

const placements: ReadonlyArray<readonly [string, (text: string) => string]> = [
	["paragraph", (text) => `a ${text} b\n`],
	["heading", (text) => `# a ${text} b\n`],
	["setext heading", (text) => `a ${text}\n===\n`],
	["table cell", (text) => `| a | b |\n| - | - |\n| ${text} | c |\n`],
	["blockquote", (text) => `> a ${text}\n> b\n`],
	["list", (text) => `- a ${text}\n  - b ${text}\n`],
	["task list", (text) => `- [x] ${text}\n- [ ] b\n`],
	["footnote definition", (text) => `x[^f]\n\n[^f]: a ${text}\n`],
	["emphasis", (text) => `*a ${text}* **${text}**\n`],
	["image alt", (text) => `![a ${text} b](i)\n`],
	["link label", (text) => `[a ${text} b](u)\n`],
	["code span", (text) => `\`${text}\` c\n`],
	["inline math", (text) => `$${text}$ c\n`],
	["inline html", (text) => `<b>${text}</b> c\n`],
	["html block", (text) => `<div>\n${text}\n</div>\n`],
	["across lines", (text) => `a ${text.replace(/\]/, "\n]")}\n`],
	["CRLF", (text) => `a ${text}\r\nb\r\n`],
	["after a tab", (text) => `a\t${text}\n`],
];

export const referenceGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const form of forms) {
		for (const [defined, definitions] of definitionSets) {
			for (const [place, wrap] of placements) {
				grid.push({ name: `${form} ${defined} in ${place}`, source: `${wrap(form)}${definitions}` });
			}
		}
	}
	return grid;
})();

// Label shapes markdownlint normalizes, each with a definition under a differently written label.
export const labelShapes: ReadonlyArray<DifferentialInput> = [
	{ name: "case and whitespace", source: "[A  B] [a\tb][] [ a b ]\n\n[a b]: u\n" },
	{ name: "escaped bracket", source: "[a\\]b] [c\\]d][]\n\n[a\\]b]: u\n" },
	{ name: "escape in a shortcut", source: "[a \\* b] [x\\_y]\n\n[a \\* b]: u\n" },
	{ name: "character reference", source: "[a &amp; b] [&copy;]\n\n[a &amp; b]: u\n" },
	{ name: "unicode case", source: "[ÄÖ] [ẞ] [İ]\n\n[äö]: u\n[ss]: v\n[i̇]: w\n" },
	{ name: "no-break space", source: "[a b] [c d]\n\n[a b]: u\n[c d]: v\n" },
	{ name: "label across lines", source: "[a\nb] [c\n d][]\n\n[a b]: u\n" },
	{ name: "definition across lines", source: "[a]\n\n[a\nb]: u\n[c\n  d]: v\n" },
	{ name: "quoted definition across lines", source: "> [a\n> b]: u\n>\n> [a b] [a > b]\n" },
	{ name: "duplicates", source: "[a]\n\n[a]: u\n[A]: v\n[ a ]: w\n[^1]: x\n[^1]: y\n" },
	{ name: "duplicate in a quote", source: "> [a]: u\n\n[a]: v\n\n[a]\n" },
	{ name: "definitions in containers", source: "- [a]: u\n\n> [b]: v\n\n[^c]: w\n\n    [d]: x\n\n[a] [b] [^c] [d]\n" },
	{ name: "definition with a title", source: "[a]\n\n[a]: u \"t\"\n[b]: <u> 't'\n[c]:\n  u\n" },
	{ name: "unused definitions", source: "x\n\n[a]: u\n[b]: v\n[c]: <>\n[//]: # (comment)\n" },
	{ name: "lazy continuation", source: "[^1]\n\n[^1]: x\n[b]: u\n\n[b]\n" },
	{ name: "definition interrupting nothing", source: "text\n[a]: u\n\n[a]\n" },
	{ name: "footnote call shapes", source: "[^1] [^ 1] [^] [^1 x] ![^1]\n\n[^1]: x\n" },
	{ name: "undefined footnote", source: "[^nope] and [^nope][]\n" },
	{ name: "brackets in code and math", source: "`[a]` $[b]$ $$[c]$$ [`d`] [$e$]\n" },
	{ name: "html in a label", source: "[<b>a</b>] [a<br>b] [<i>]\n" },
	{ name: "autolink in a label", source: "[<https://x.y>] [a https://x.y]\n" },
	{ name: "nested images", source: "![a ![b] c](i) ![a [b] c][d]\n\n[d]: u\n" },
	{ name: "chains", source: "[a][b][c][d] [a][][b] [a] [] [b][ ][c]\n" },
	{ name: "collapsed after a full", source: "[a][b][] and [a][b][c][]\n" },
	{ name: "bang before", source: "!![a] \\![b] !`x`[c] ![d\n" },
	{ name: "hard breaks", source: "[a  \nb] [c\\\nd]\n" },
	{ name: "unclosed", source: "[a [b [c\n\nd] e]\n" },
	{ name: "stray closers", source: "a] [b]] [[c] d]\n" },
	{ name: "math block", source: "$$\n[a]\n$$\n\n[b]\n" },
	{ name: "front matter", source: "---\nt: [a]\n---\n[b]\n\n[c]: u\n" },
];

// Definitions whose whitespace is a tab (CommonMark §4.7 allows spaces or tabs), used and unused, beside references,
// shortcuts, a duplicate and inline links, in a blockquote and a list item.
export const tabbedDefinitions: ReadonlyArray<DifferentialInput> = [
	{ name: "tab after the destination", source: "[a] [b][a]\n\n[a]: /u\t\n[c]: /c\t\n" },
	{ name: "tab before the destination", source: "[a] [b][a]\n\n[a]:\t/u\n[c]:\t/c\n" },
	{ name: "tabs around the title", source: '[a]\n\n[a]:\t/u\t"t"\t\n[c]: /c\t(x)\n' },
	{ name: "tab before the line ending", source: "[a]\n\n[a]:\t\n/u\n[c]:\t\n/c\n" },
	{ name: "tabbed duplicate", source: "[a]\n\n[a]:\t/u\n[a]: /v\t\n" },
	{ name: "tabbed hash destination", source: "[a] [b]\n\n[a]:\t#\n[b]: #\t\n" },
	{ name: "tabbed in containers", source: "> [a]\n>\n> [a]:\t/u\t\n\n- [b]\n\n  [b]:\t/v\t\n" },
	{ name: "inline links with tabs", source: '[x](\t/u\t) [y](/u\t"t"\t) [https://u.example](\thttps://u.example\t)\n' },
];

// References and definitions after a line micromark ends a paragraph at (a math block's lines, a directive line),
// which the kit's parser reads as one paragraph: in a document, a blockquote and a list item.
export const paragraphBreakShapes: ReadonlyArray<DifferentialInput> = [
	{
		name: "reference after a math block",
		source: "Formula:\n\n$$\nE = mc^2\n$$\nSee [the paper][p] for details.\n\n[p]: https://example.com/paper\n",
	},
	{ name: "collapsed after math", source: "$$\nm\n$$\n[a][]\n" },
	{ name: "full after math", source: "$$\nm\n$$\n[a][b]\n" },
	{ name: "image after math", source: "$$\nm\n$$\n![a][]\n" },
	{ name: "shortcut after math", source: "$$\nm\n$$\n[a]\n" },
	{ name: "quoted after math", source: "> $$\n> m\n> $$\n> [a][b]\n" },
	{ name: "listed after math", source: "- $$\n  m\n  $$\n  [a][b]\n" },
	{ name: "definition after math", source: "$$\nm\n$$\n[p]: /u\n\n[p]\n" },
	{ name: "two lines after math", source: "$$\nm\n$$\ntext [a][b]\n[c][d]\n" },
	{ name: "math with meta", source: "$$ x\nm\n$$\n[a][b]\n" },
	{ name: "text before math", source: "text\n$$\nm\n$$\n[a][b]\n" },
	{ name: "reference after a leaf", source: "::leaf\n[a][b]\n" },
	{ name: "definition after a leaf", source: "::leaf\n[r]: /u\n" },
	{ name: "definition in a container directive", source: ":::note\n[r]: /u\n:::\n" },
	{ name: "label after a leaf mid-paragraph", source: "text\n::note[label]\n" },
	{ name: "directive grammar edges", source: '::1note[label]\n\n::é[label]\n\n::note[label]{a="}"}\n' },
	{ name: "reference after a fence", source: "```\n[a]\n```\n[b][c]\n" },
];

// Definitions directly above a table's header row, which the parser reclaims into a paragraph it then reads
// definitions from, as cmark-gfm and micromark do.
export const definitionsAboveTables: ReadonlyArray<DifferentialInput> = [
	{ name: "one definition", source: "[t]: https://example.com\n| a | b |\n| - | - |\n| [x][t] | d |\n" },
	{ name: "two definitions", source: "[t]: https://example.com\n[u]: /u\n| a | b |\n| - | - |\n| [x][t] | d |\n" },
	{ name: "a definition, then text", source: "[a]: /a\ntext\n| a |\n| - |\n" },
	{ name: "in a blockquote", source: "> [t]: /t\n> | a |\n> | - |\n> | [x][t] |\n" },
];

// Setext headings whose text holds a reference (and, after math, an ATX heading and table cells), in every block position micromark reads one: alone, after a math
// block, a directive leaf, a container directive's opening, a table and text, at the top level, in a blockquote and in
// a list item, with the definition for `a` (and `b`) at the document's end.
export const setextReferenceShapes: ReadonlyArray<DifferentialInput> = (() => {
	const befores: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
		["alone", []],
		["after math", ["$$", "m", "$$"]],
		["after a leaf", ["::leaf"]],
		["in a container directive", [":::note"]],
		["after a table", ["| t |", "| - |"]],
		["after text and a blank", ["text", ""]],
	];
	const headings: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
		["collapsed, ===", ["[a][]", "==="]],
		["shortcut in text, ---", ["See [a]", "---"]],
		["full on a second line", ["x", "[x][b]", "==="]],
		["image", ["![a][]", "---"]],
	];
	const containers: ReadonlyArray<readonly [string, (index: number) => string]> = [
		["top level", () => ""],
		["blockquote", () => "> "],
		["list item", (index) => (index === 0 ? "- " : "  ")],
	];
	const shapes: Array<DifferentialInput> = [];
	for (const [beforeName, before] of befores) {
		for (const [headingName, heading] of headings) {
			for (const [containerName, prefix] of containers) {
				const lines = [...before, ...heading].map((line, index) => `${prefix(index)}${line}`.trimEnd());
				shapes.push({
					name: `${headingName} ${beforeName}, ${containerName}`,
					source: `${lines.join("\n")}\n\n[a]: /a\n[b]: /b\n`,
				});
			}
		}
	}
	// The other blocks whose text holds a reference, after a math block: an ATX heading and a table's cells.
	shapes.push(
		{ name: "ATX heading after math", source: "$$\nm\n$$\n# [a][]\n\n[a]: /a\n" },
		{ name: "table cell after math", source: "$$\nm\n$$\n| [a][] |\n| - |\n| ![b][] |\n\n[a]: /a\n[b]: /b\n" },
		{ name: "quoted table cell after math", source: "> $$\n> m\n> $$\n> | [a][] |\n> | - |\n\n[a]: /a\n" },
	);
	return shapes;
})();

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

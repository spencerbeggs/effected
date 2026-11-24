// A grid for MD044, which matches names over the text micromark tokenizes as data, code and HTML: every case
// variant of a name in every place a name sits (each kind of block and inline construct, the parts of a link and
// image, footnotes, code, HTML, math, front matter, definitions), names with punctuation, overlapping names, and
// names inside links, URLs and autolinks. A test pins the grid whole against markdownlint under `PROPER_NAMES`.

import type { DifferentialInput } from "./differential.js";

/** The names setting the grid is read under. */
export const PROPER_NAMES: ReadonlyArray<string> = ["JavaScript", "GitHub", "GitHub Actions", "Node.js", "C++", ".NET"];

const variants = [
	"javascript",
	"JAVASCRIPT",
	"JavaScript",
	"Javascripts",
	"_javascript_",
	"javascript's",
	"my_javascript_var",
];

export const properNamesGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const variant of variants) grid.push({ name: `variant ${variant}`, source: `Use ${variant} here.\n` });
	const places: ReadonlyArray<readonly [string, string]> = [
		["heading", "# javascript and github\n"],
		["setext heading", "javascript\n==========\n"],
		["closed heading", "## javascript ##\n"],
		["table", "| javascript | b |\n| - | - |\n| github | node.js |\n"],
		["blockquote", "> javascript\n> > github\n"],
		["list", "- javascript\n  - github\n"],
		["emphasis", "*javascript* and **github** and _node.js_\n"],
		["intraword emphasis", "**my_javascript_var** and x**javascript**y\n"],
		["strikethrough", "~~javascript~~ and x~~github~~\n"],
		["link text", "[javascript](https://x.y) and [github][r]\n\n[r]: https://u.v\n"],
		["link url and title", '[x](https://javascript.com "github") and [y](<github>)\n'],
		["reference label", "[x][javascript]\n\n[javascript]: https://u.v\n"],
		["definition", '[github]: https://javascript.com "node.js"\n'],
		["image", '![javascript](https://github.com "node.js")\n'],
		["image alt across lines", "![a\njavascript](u)\n"],
		["literal autolinks", "www.javascript.com and https://github.com/x and me@github.com\n"],
		["angle autolinks", "<https://javascript.com> and <me@github.com>\n"],
		["autolink in link text", "[www.javascript.com](u) and `www.github.com`\n"],
		["code span", "`javascript` and `` github ``\n"],
		["code span across lines", "`a\njavascript`\n"],
		["fenced code", "```javascript\nvar javascript\n```\n"],
		["indented code", "text\n\n    javascript\n"],
		["inline html", '<a title="javascript">github</a>\n'],
		["html block", "<div>\njavascript <b>github</b>\n</div>\n"],
		["html block tag attribute", '<div title="javascript">\n</div>\n'],
		["html comment block", "<!-- javascript\ngithub -->\n"],
		["html comment inline", "a <!-- javascript --> b\n"],
		["footnote", "x[^javascript]\n\n[^javascript]: github\n"],
		["inline math", "$javascript$ and github\n"],
		["math in a heading", "# $javascript$\n"],
		["math across a break", "$a\njavascript$ x\n"],
		["math block", "$$\njavascript\n$$\n"],
		["front matter", "---\ntitle: javascript\n---\ngithub\n"],
		["escaped", "\\_javascript and \\*github\\*\n"],
		["entity", "&amp;javascript and github&amp;\n"],
		["punctuated names", "node.js and nodexjs and c++ and .net and x.net\n"],
		["overlapping names", "github actions and github-actions and GitHub Actions\n"],
		["many on a line", "javascript github javascript github JavaScript\n"],
		["across lines", "java\nscript and github\n"],
		["hard break", "javascript  \ngithub\n"],
		["CRLF", "javascript\r\ngithub\r\n"],
	];
	for (const [name, source] of places) grid.push({ name, source });
	return grid;
})();

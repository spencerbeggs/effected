// A grid of link and image styles for MD054: every style (autolink, inline, full, collapsed, shortcut, and an inline
// link whose text is its URL), with titles, angle and empty destinations, brackets and parentheses its fix escapes,
// escapes it removes, references to definitions in angle brackets, links in image labels and images in link labels,
// and links across lines, in a paragraph, a blockquote, a list, a table cell and a heading.

import type { DifferentialInput } from "./differential.js";

const styles: ReadonlyArray<string> = [
	"<https://a.example/x>",
	"<a@b.example>",
	"<x:y>",
	"[https://a.example](https://a.example)",
	'[https://a.example](https://a.example "t")',
	"![https://a.example](https://a.example)",
	"[text](https://a.example/p)",
	"[text](relative/p)",
	"[text](<https://a.example/s p>)",
	"[text](<>)",
	"[text]()",
	"[text](https://a.example/(x))",
	"[te[x]t](https://a.example)",
	"[te\\]xt](u\\(x\\))",
	"[text](https://a.example/a\\_b)",
	"[a\\_b](https://a.example/a\\_b)",
	"[text][r]",
	"[r][]",
	"[r]",
	"![r]",
	"![alt][r]",
	"[text][s]",
	"[s]",
	"[text][p]",
	"[p]",
	"![a [b](https://b.example) c](i.png)",
	"[![i](i.png)](https://a.example)",
	"[a\nb](https://a.example)",
	"[a][\nr]",
	"[](https://a.example)",
];

const placements: ReadonlyArray<readonly [string, (text: string) => string]> = [
	["paragraph", (text) => `a ${text} b\n`],
	["blockquote", (text) => `> a ${text}\n`],
	["list", (text) => `- a ${text}\n`],
	["table cell", (text) => `| a |\n| - |\n| ${text.replace(/\n/g, " ")} |\n`],
	["heading", (text) => `# a ${text.replace(/\n/g, " ")}\n`],
];

const definitions = '\n[r]: https://r.example "title"\n[s]: <https://s.example>\n[p]: https://p.example/(x)\n';

export const linkStyleGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const style of styles) {
		for (const [place, wrap] of placements) {
			grid.push({ name: `${style} in ${place}`, source: `${wrap(style)}${definitions}` });
		}
	}
	return grid;
})();

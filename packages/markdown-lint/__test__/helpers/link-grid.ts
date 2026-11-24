// A grid of links for the link rules (MD011, MD039, MD042, MD059, MD034): every link kind (inline with each
// destination and title form, full, collapsed and shortcut references defined and not, autolinks, literal autolinks,
// images and image references, nested images) in every placement (paragraph, heading, table cell, blockquote, list,
// HTML block, image alt, inline and block math, code span and block). A rule's test adds its own shapes beside it.

import type { DifferentialInput } from "./differential.js";

const kinds: ReadonlyArray<readonly [string, string]> = [
	["inline", "[text](https://u.v)"],
	["inline with title", '[text](https://u.v "title")'],
	["inline angle destination", "[text](<https://u.v>)"],
	["inline empty destination", "[text]()"],
	["inline empty angle destination", "[text](<>)"],
	["inline hash destination", "[text](#)"],
	["inline fragment", "[text](#frag)"],
	["padded label", "[ text ](https://u.v)"],
	["empty label", "[](https://u.v)"],
	["full reference", "[text][ref]"],
	["full reference, case", "[text][REF]"],
	["full reference, spaced label", "[text][ ref  x ]"],
	["collapsed reference", "[ref][]"],
	["shortcut reference", "[ref]"],
	["undefined full", "[text][nope]"],
	["undefined shortcut", "[nope]"],
	["empty-destination reference", "[text][empty]"],
	["hash reference", "[text][hash]"],
	["autolink", "<https://u.v>"],
	["email autolink", "<me@u.v>"],
	["literal url", "https://u.v/x"],
	["literal www", "www.u.v"],
	["literal email", "me@u.v"],
	["image", "![alt](https://u.v/i.png)"],
	["image reference", "![alt][ref]"],
	["image in a link", "[![alt](i.png)](https://u.v)"],
	["reversed", "(text)[https://u.v]"],
	["click here", "[click here](https://u.v)"],
	["link text", "[link](https://u.v)"],
];

const definitions = "\n[ref]: https://r.s\n[ref  x]: https://r.s\n[empty]: <>\n[hash]: #\n";

const placements: ReadonlyArray<readonly [string, (link: string) => string]> = [
	["paragraph", (link) => `a ${link} b\n`],
	["heading", (link) => `# a ${link} b\n`],
	["table cell", (link) => `| a | b |\n| - | - |\n| ${link} | c |\n`],
	["blockquote", (link) => `> a ${link} b\n`],
	["list", (link) => `- a ${link} b\n`],
	["html block", (link) => `<div>\na ${link} b\n</div>\n`],
	["image alt", (link) => `![a ${link} b](i.png)\n`],
	["inline math", (link) => `$a ${link} b$ c\n`],
	["code span", (link) => `\`${link}\` c\n`],
	["code block", (link) => `\`\`\`\n${link}\n\`\`\`\n`],
];

export const linkGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const [kind, link] of kinds) {
		for (const [place, wrap] of placements) {
			grid.push({ name: `${kind} in ${place}`, source: `${wrap(link)}${definitions}` });
		}
	}
	return grid;
})();

// Unclosed fences ending the source with no final line ending, whose last line micromark reads as code: plain, in a
// list item and a blockquote, with backticks and tildes, with trailing spaces and tabs in the code.
export const unclosedFenceEnds: ReadonlyArray<import("./differential.js").DifferentialInput> = [
	{ name: "unclosed backtick fence", source: "```\njavascript" },
	{ name: "unclosed tilde fence", source: "~~~\njavascript" },
	{ name: "unclosed fence in a list item", source: "- ```\n  javascript" },
	{ name: "unclosed fence in a blockquote", source: "> ```\n> javascript" },
	{ name: "unclosed fence, trailing whitespace", source: "```\n\tjavascript  " },
	{ name: "unclosed fence, command", source: "```sh\n$ ls" },
	{ name: "unclosed fence, two lines", source: "```\njavascript\njavascript" },
];

// Lists whose last item ends in a link whose destination or title wraps onto the next line: the paragraph, and the
// list, end on that line, not where the link's text ends.
export const wrappedLinkEnds: ReadonlyArray<import("./differential.js").DifferentialInput> = [
	{ name: "wrapped title", source: '- item with [link](https://example.com/a\n  "wrapped title")\n\ntext\n' },
	{ name: "wrapped empty resource", source: "- [a](/u\n  )\n\ntext\n" },
	{ name: "wrapped destination", source: "- [link](\n  https://example.com/a)\n\ntext\n" },
	{ name: "wrapped title in a blockquote", source: '> - [a](/u\n>   "t")\n>\n> text\n' },
	{ name: "wrapped title in an ordered list", source: '1. [a](/u\n   "t")\n2. [b](/v\n   "t")\n\ntext\n' },
	{ name: "wrapped reference", source: "- [a][\n  r]\n\ntext\n\n[r]: /u\n" },
	{ name: "image with a wrapped title", source: '- ![a](/u\n  "t")\n\ntext\n' },
	{ name: "wrapped title, then a line", source: '- [a](/u\n  "t")\ntext\n' },
];

// Whitespace-only lines after an indented code block: micromark's `codeIndented` token takes in each of four columns
// or more, and the blank lines before one, where the kit's node ends at its last line of text.
export const indentedCodeTails: ReadonlyArray<import("./differential.js").DifferentialInput> = [
	{ name: "four spaces after", source: "# H\n\n    code\n    \n# G\n" },
	{ name: "two spaces after", source: "# H\n\n    code\n  \n# G\n" },
	{ name: "a tab after", source: "# H\n\n    code\n\t\n# G\n" },
	{ name: "six spaces after", source: "# H\n\n    code\n      \n# G\n" },
	{ name: "blank, then four spaces", source: "# H\n\n    code\n\n    \n# G\n" },
	{ name: "two runs", source: "# H\n\n    code\n    \n    \n\n\n# G\n" },
	{ name: "in a list item", source: "- a\n\n      code\n      \n- b\n" },
	{ name: "in a blockquote", source: ">     code\n>     \n> text\n" },
	{ name: "at the end", source: "    code\n    \n    " },
];

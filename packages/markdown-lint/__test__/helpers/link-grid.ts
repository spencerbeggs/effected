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

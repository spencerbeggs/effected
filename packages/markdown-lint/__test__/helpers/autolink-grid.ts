// A grid of literal autolinks for MD034, which reports micromark's GFM `literalAutolink` tokens: every scheme,
// `www.` and email shape (trailing punctuation, parentheses, entities, underscores, case), in every placement (each
// block and container, emphasis, inline HTML wrappers and attributes, an HTML block, link labels, image alts, code,
// math, footnotes, undefined references, angle brackets).

import type { DifferentialInput } from "./differential.js";

const shapes: ReadonlyArray<string> = [
	"https://example.com",
	"http://a.b/c?d=e#f",
	"www.example.com",
	"www.example.com/path",
	"WWW.example.com",
	"Www.example.com/x",
	"ftp://x.y",
	"mailto:a@b.co",
	"xmpp:a@b.co/x",
	"a@b.co",
	"a.b-c_d@e.f.gh",
	"https://x.com.",
	"https://x.com)",
	"(https://x.com)",
	"https://x.com/a_(b)",
	"www.x.com/a?b=c&amp;",
	"https://x.com*",
	"https://x",
	"www.x",
	"x@y",
	"a@b.c-",
	"www.a_b.com",
	"www.a.b_c.com",
	"https://a.b/<c",
	"https://user:pw@a.b:8080/x",
];

const placements: ReadonlyArray<readonly [string, (url: string) => string]> = [
	["paragraph", (url) => `a ${url} b\n`],
	["heading", (url) => `# a ${url} b\n`],
	["table cell", (url) => `| a | b |\n| - | - |\n| ${url} | c |\n`],
	["blockquote", (url) => `> a ${url} b\n`],
	["list", (url) => `- a ${url} b\n`],
	["emphasis", (url) => `*${url}* and **${url}**\n`],
	["angle brackets", (url) => `<${url}>\n`],
	["inside an html element", (url) => `<a href="x">${url}</a> and <b>${url}</b> ${url}\n`],
	["in an html attribute", (url) => `<a href="${url}">x</a>\n`],
	["after an unclosed html tag", (url) => `<b>${url}\n`],
	["beside a self-closing tag", (url) => `<br/>${url} <br>\n`],
	["html block", (url) => `<div>\n${url}\n</div>\n`],
	["link label", (url) => `[${url}](u) and [x](${url})\n`],
	["image alt", (url) => `![${url}](i)\n`],
	["code span", (url) => `\`${url}\` c\n`],
	["inline math", (url) => `$${url}$ c\n`],
	["footnote", (url) => `x[^1]\n\n[^1]: ${url}\n`],
	["undefined reference", (url) => `[${url}] and [x][${url}]\n`],
];

export const autolinkGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const url of shapes) {
		for (const [place, wrap] of placements) grid.push({ name: `${url} in ${place}`, source: wrap(url) });
	}
	return grid;
})();

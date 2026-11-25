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

// micromark tokenizes a literal as it reads the text, before emphasis and brackets resolve, where cmark-gfm (the
// kit's parser) links in a pass after them: email addresses beside `_`, `/`, escapes and a second `@`, in placements
// where emphasis or a link would claim their edges.
const addresses: ReadonlyArray<string> = [
	"_a@b.co_",
	"_a@b.co",
	"_a@b.co._",
	"__a@b.co__",
	"_mailto:a@b.co_",
	"_x a@b.co_",
	"a_b@c.co",
	"a@b.co_",
	"a@b.co_x",
	"a@b_c.co",
	"x_a@b.co_ y",
	"foo@bar.baz@q.co",
	"a@b.co@c.co",
	"a@b.co@c.co@d.ef",
	"x@y.z@w",
	"x/a@b.co",
	"a\\_b@c.de",
	"a@.b.co",
	"a@b-.co",
	"-@b.co",
	"a.@b.co",
	"é_a@b.co",
	"1_a@b.co",
	"www.a@b.co",
	"https://a@b.co",
	"a@b.c1",
	"mailto:a@b.co@c.de",
	"_a@b.co_@c.de",
];

const addressPlacements: ReadonlyArray<readonly [string, (text: string) => string]> = [
	["paragraph", (text) => `${text}\n`],
	["mid-text", (text) => `x ${text} y\n`],
	["emphasis", (text) => `*${text}*\n`],
	["strong", (text) => `**${text}** z\n`],
	["underscore strong", (text) => `__${text}__ z\n`],
	["heading", (text) => `## ${text}\n`],
	["list", (text) => `- ${text}\n`],
	["blockquote", (text) => `> ${text}\n`],
	["table cell", (text) => `| a |\n| - |\n| ${text} |\n`],
	["after a code span", (text) => `\`c\`${text}\n`],
	["link destination", (text) => `[x](${text})\n`],
	["inside an html element", (text) => `<b>${text}</b> ${text}\n`],
];

export const addressGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const text of addresses) {
		for (const [place, wrap] of addressPlacements) grid.push({ name: `${text} in ${place}`, source: wrap(text) });
	}
	return grid;
})();

// Inline math around a bracket: micromark reads the math, so a `[` inside it opens nothing and a `]` closes nothing,
// where the kit's parser, reading no math, sees the bracket.
const mathTargets: ReadonlyArray<string> = ["https://a.com", "www.a.com", "WWW.a.com", "a@b.co", "_a@b.co"];

const mathPlacements: ReadonlyArray<readonly [string, (text: string) => string]> = [
	["after a bracket in math", (text) => `$[$ ${text}\n`],
	["after a bracket in display math", (text) => `$$[$$ ${text}\n`],
	["after a bracket in math and a span", (text) => `a $[$ [x] ${text}\n`],
	["after a closer in math", (text) => `[x $]$ ${text}\n`],
	["after math in a span", (text) => `[$x$] ${text}\n`],
	["in emphasis after a bracket in math", (text) => `$[$ *${text}*\n`],
	["after an escaped bracket in math", (text) => `$\\[$ ${text}\n`],
	["a block after a bracket in math", (text) => `$[$ x\n\n${text}\n`],
	["after an image opener in math", (text) => `$![$ ${text}\n`],
	["in an html element after a bracket in math", (text) => `$[$ <b>${text}</b> ${text}\n`],
	["in a table cell after a bracket in math", (text) => `| $[$ ${text} | b |\n| - | - |\n| $[$ ${text} | c |\n`],
	["on the next line after a bracket in math", (text) => `$[$ x\n${text}\n`],
	["after two math brackets", (text) => `$[$ $[$ x ${text}\n`],
	["inside a span after a bracket in math", (text) => `$[$ [${text}]\n`],
];

export const mathBracketGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const text of mathTargets) {
		for (const [place, wrap] of mathPlacements) grid.push({ name: `${text} ${place}`, source: wrap(text) });
	}
	return grid;
})();

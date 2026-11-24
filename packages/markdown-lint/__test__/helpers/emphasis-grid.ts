// A grid of emphasis-marker shapes for the emphasis rules (MD037, MD049, MD050), which read the markers micromark
// leaves bare or pairs into emphasis: every marker kind by the spaces beside it, then the places a marker sits (a
// heading, a table cell, containers, a link label, inside other emphasis, beside code, HTML, strikethrough and math,
// intraword, escaped, across lines). A test pins the grid whole against markdownlint.

import type { DifferentialInput } from "./differential.js";

const markers = ["*", "**", "***", "_", "__", "___"];
const spacings: ReadonlyArray<readonly [string, string, string]> = [
	["none", "", ""],
	["start", " ", ""],
	["end", "", " "],
	["both", " ", " "],
	["two", "  ", "  "],
	["tab", "\t", "\t"],
];

export const emphasisGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const marker of markers) {
		for (const [name, lead, trail] of spacings) {
			const span = `${marker}${lead}text${trail}${marker}`;
			grid.push({ name: `${marker} ${name}`, source: `a ${span} b\n` });
			grid.push({ name: `${marker} ${name}, line start`, source: `${span} b\n` });
			grid.push({ name: `${marker} ${name}, two words`, source: `a ${marker}${lead}two words${trail}${marker} b\n` });
		}
	}
	const places: ReadonlyArray<readonly [string, string]> = [
		["heading", "# a * b * c\n"],
		["setext heading", "a ** b ** c\n===\n"],
		["table cell", "| a | b |\n| - | - |\n| * x * | _y _ |\n"],
		["blockquote", "> a * b * c\n"],
		["list item", "- a __ b __ c\n"],
		["link label", "[a * b * c](u)\n"],
		["image alt", "![a * b *](u)\n"],
		["inside strong", "**a * b * c**\n"],
		["inside emphasis", "_a ** b ** c_\n"],
		["beside emphasis", "*a* * b * *c*\n"],
		["strikethrough", "~~a * b * c~~\n"],
		["intraword underscore", "snake_case_name and _ x _\n"],
		["intraword star", "a*b*c and a * b*c\n"],
		["code span", "`*` a * b * `*`\n"],
		["code span inside", "a * `b` * c\n"],
		["inline html", "a <b>* x *</b> c\n"],
		["html block", "<div>\na * b * c\n</div>\n"],
		["inline math", "$a * b * c$\n"],
		["inline math beside", "$x$ * y * $z$\n"],
		["double-dollar math", "$$a ** b ** c$$\n"],
		["math in quote", "> $a * b * c$\n"],
		["math in table", "| a |\n| - |\n| $a * b *$ |\n"],
		["math in heading", "# $a * b * c$\n"],
		["math across a break", "$a * b\nc * d$\n"],
		["math block", "$$\na * b * c\n$$\n"],
		["escaped", "a \\* b * c *\n"],
		["entity", "a &#42; b * c *\n"],
		["across lines", "a * b\nc * d\n"],
		["three markers", "a * b * c * d\n"],
		["mixed kinds", "a * b _ c * d _ e\n"],
		["four stars", "a **** b **** c\n"],
		["autolink literal", "www.a_b_c.com and * x *\n"],
		["undefined reference", "[a * b * c][undef]\n"],
		["undefined shortcut", "[* x *]\n"],
		["code block", "```\na * b * c\n```\n"],
		["front matter", "---\ntitle: x\n---\na * b * c\n"],
		["long line", `a * ${"word ".repeat(10)}* b\n`],
		["CRLF", "a * b * c\r\n** d **\r\n"],
	];
	for (const [name, source] of places) grid.push({ name, source });
	return grid;
})();

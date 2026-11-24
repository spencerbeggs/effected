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

/**
 * A grid for the emphasis-style rules (MD049, MD050): emphasis and strong in each marker, nested, intraword and in
 * each place, each input opening with a first span that sets the `consistent` style.
 */
export const emphasisStyleGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	const spans = [
		"*a*",
		"_a_",
		"**a**",
		"__a__",
		"***a***",
		"___a___",
		"*__a__*",
		"_**a**_",
		"**_a_**",
		"__*a*__",
		"*a **b** c*",
		"_a __b__ c_",
	];
	for (const first of ["*x*", "_x_", "**x**", "__x__"]) {
		for (const span of spans) grid.push({ name: `${first} then ${span}`, source: `${first} and ${span} end\n` });
	}
	const places: ReadonlyArray<readonly [string, string]> = [
		["intraword star", "a*b*c and a**b**c\n"],
		["intraword star at one side", "a*b* and *b*c and **b**c\n"],
		["intraword underscore", "snake_case_name and a__b__c\n"],
		["star after a word", "x_y_ *z* _w_\n"],
		["heading", "# *a* and _b_ and **c** and __d__\n"],
		["table cell", "| a | b |\n| - | - |\n| *x* | _y_ |\n| **x** | __y__ |\n"],
		["blockquote", "> *a* _b_ **c** __d__\n"],
		["list item", "- *a*\n- _b_\n- **c**\n- __d__\n"],
		["link label", "[*a* and _b_](u) **c** __d__\n"],
		["image alt", "![*a* _b_](u)\n"],
		["image alt, strong", "![**a** and __b__](u)\n"],
		["image alt across lines", "![*a\nb* _c_](u)\n"],
		["quoted image alt across lines", "> ![_a\n> b_ *c*](u)\n"],
		["reference image", "![*a* _b_][r]\n\n[r]: u\n"],
		["math in image alt", "![$*a*$ _b_](u)\n"],
		["image in a link", "[![*a*](u) _b_](v)\n"],
		["undefined reference", "[*a* _b_][undef] **c** __d__\n"],
		["strikethrough", "~~*a*~~ and ~~_b_~~ and ~~**c**~~ __d__\n"],
		["strikethrough crossing", "*a ~~b* c~~ and _d_\n"],
		["code span", "`*a*` _b_ *c*\n"],
		["inline html", "<b>*a*</b> _b_\n"],
		["html block", "<div>\n*a* _b_\n</div>\n\n_c_\n"],
		["inline math", "$*a*$ _b_ *c*\n"],
		["double-dollar math", "$$**a**$$ __b__ **c**\n"],
		["math in quote", "> $*a*$ _b_\n"],
		["math in table", "| a |\n| - |\n| $*a*$ _b_ |\n"],
		["math in heading", "# $*a*$ _b_\n"],
		["math across a break", "$*a\nb*$ _c_ *d*\n"],
		["math block", "$$\n*a*\n$$\n\n_b_\n"],
		["escaped", "\\*a\\* _b_ *c*\n"],
		["across lines", "*a\nb* and _c\nd_\n"],
		["front matter", "---\ntitle: x\n---\n*a* _b_\n"],
		["CRLF", "*a*\r\n_b_\r\n**c**\r\n__d__\r\n"],
	];
	for (const [name, source] of places) grid.push({ name, source });
	return grid;
})();

// A grid of heading fragments for MD051, which builds each heading's fragment as GitHub does: heading texts (case,
// punctuation, emoji, non-ASCII letters and digits, combining marks, code, emphasis, links and images, character
// references, escapes, math, inline HTML, strikethrough, custom anchors, setext headings across lines, repeats) each
// linked to as written, in another case, with a repeat's suffix and not at all, beside HTML anchors (inline and in
// blocks, `id` and `name`), `#top`, line fragments, definitions, images in links and links in image labels.

import type { DifferentialInput } from "./differential.js";

const headings: ReadonlyArray<readonly [heading: string, fragment: string]> = [
	["# Heading", "heading"],
	["# Heading One Two", "heading-one-two"],
	["# Héading Ünïcode", "héading-ünïcode"],
	["# Emoji 😀 face", "emoji--face"],
	["# Punct!? .,;: 'q' \"d\" (p) [b] {c}", "punct--q-d-p-b-c"],
	["# a_b-c d", "a_b-c-d"],
	["# `code` span", "code-span"],
	["# `` co`de `` two", "code-two"],
	["# *emph* and **strong**", "emph-and-strong"],
	["# [link](u) text", "link-text"],
	["# [ref][r] text", "ref-text"],
	["# ![img](i) after", "-after"],
	["# A &amp; B &#35; C", "a--b--c"],
	["# Escaped \\# \\* hash", "escaped--hash"],
	["# Math $x^2$ here", "math-x2-here"],
	["# Tab\there", "tabhere"],
	["# Multiple   spaces", "multiple---spaces"],
	["# Closed ###", "closed"],
	["# <b>html</b> heading", "html-heading"],
	["# ~~strike~~ through", "strike-through"],
	["# Heading {#custom-id}", "heading-custom-id"],
	["# UPPER Case", "upper-case"],
	["# 日本語 テキスト", "日本語-テキスト"],
	["# ١٢٣ digits", "١٢٣-digits"],
	["# Ω and µ", "ω-and-µ"],
	["# á combining", "á-combining"],
	["# See https://x.example here", "see--here"],
	["# Mail a@b.example", "mail-"],
	["# Footnote[^1] call", "footnote-call"],
	["Setext\n===", "setext"],
	["Setext multi\nline here\n---", "setext-multiline-here"],
	["# Dup\n\n# Dup\n\n# Dup", "dup-2"],
	["# Dup 1\n\n# Dup\n\n# Dup", "dup-1"],
	["# 1\n\n# 1", "1-1"],
	["#", "x"],
];

const forms: ReadonlyArray<readonly [string, (fragment: string) => string]> = [
	["as written", (fragment) => `[x](#${fragment})`],
	["in another case", (fragment) => `[x](#${fragment.toUpperCase()})`],
	["with a suffix", (fragment) => `[x](#${fragment}-1)`],
	["missing", () => "[x](#missing-fragment)"],
	["in angle brackets with a title", (fragment) => `[x](<#${fragment}> "t")`],
	["as a definition", (fragment) => `[x][d]\n\n[d]: #${fragment.toUpperCase()}`],
	["in an image in a link", (fragment) => `[![i](#${fragment.toUpperCase()})](#missing)`],
	["in a quote", (fragment) => `> [x](#${fragment.toUpperCase()})`],
];

export const fragmentGrid: ReadonlyArray<DifferentialInput> = (() => {
	const grid: Array<DifferentialInput> = [];
	for (const [heading, fragment] of headings) {
		for (const [form, link] of forms) {
			grid.push({ name: `${JSON.stringify(heading)} linked ${form}`, source: `${heading}\n\n${link(fragment)}\n` });
		}
	}
	return grid;
})();

// Anchors and fragments beyond headings.
export const anchorShapes: ReadonlyArray<DifferentialInput> = [
	{
		name: "top and line fragments",
		source: "# H\n\n[a](#top) [b](#TOP) [c](#L20) [d](#L19C5-L21C11) [e](#l20) [f](#L1-)\n",
	},
	{ name: "empty and bare fragments", source: "# H\n\n[a](#) [b](#h) [c](h#h) [d](./x#h) [e](#%68)\n" },
	{
		name: "inline anchors",
		source:
			'<a name="n1"></a> <a id="i1"></a> <span id=\'s1\'>x</span> <b name="b1">y</b>\n\n[a](#n1) [b](#i1) [c](#s1) [d](#b1) [e](#N1)\n',
	},
	{ name: "block anchors", source: '<div id="d1">\n<a name="n2"></a>\n</div>\n\n[a](#d1) [b](#n2) [c](#D1)\n' },
	{
		name: "anchor attributes",
		source: '<p data-id="x" ID="up" id=unquoted>z</p>\n\n[a](#x) [b](#up) [c](#unquoted)\n',
	},
	{ name: "comment block", source: '<!-- <a id="c1"></a> -->\n\n[a](#c1)\n' },
	{
		name: "escapes and references in a fragment",
		source: "# a_b & c\n\n[a](#a\\_b--c) [b](#a&#95;b--c) [c](#a_b--c)\n",
	},
	{ name: "encoded fragment", source: "# Héading\n\n[a](#héading) [b](#h%C3%A9ading) [c](#HÉADING)\n" },
	{ name: "link across lines", source: "# H\n\n[a\nb](#missing) [c\nd](#H)\n" },
	{ name: "definition across lines", source: '# H\n\n[d]\n\n[d]:\n  #H\n[e]: #missing\n  "t"\n' },
	{ name: "duplicate definitions", source: "# H\n\n[d]\n\n[d]: #H\n[d]: #missing\n" },
	{ name: "link in an image label", source: "# H\n\n![a [b](#H) c](i) [![a [b](#H)](i)](#h)\n" },
	{ name: "docfx tabs", source: '# [Linux](#tab/linux)\n\n# [Windows](#tab/windows) x\n\n## [Mac](#tab/mac "t")\n' },
	{
		name: "custom anchors",
		source:
			"# Head {#my-id} and {#second_id}\n\n# Other {#my-id}\n\n[a](#my-id) [b](#second_id) [c](#MY-ID) [d](#bad-)\n",
	},
	{ name: "fragments in math and code", source: "# H\n\n$[a](#missing)$ `[b](#missing)`\n" },
	{ name: "fragment in html block", source: "<div>\n\n[a](#missing)\n\n</div>\n" },
	{ name: "fragment in a footnote", source: "# H\n\nx[^1]\n\n[^1]: [a](#h) [b](#nope)\n" },
	{ name: "headings in containers", source: "> # Quoted\n\n- # Listed\n\n[a](#quoted) [b](#listed) [c](#QUOTED)\n" },
	{ name: "CRLF", source: "# H\r\n\r\n[a](#h) [b](#H) [c](#x)\r\n" },
];

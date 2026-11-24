// MD033 `no-inline-html`, held to markdownlint's own MD033 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import type { Code, Html, MarkdownNode } from "@effected/markdown";
import { Option } from "effect";
import { rereadHtmlBlock } from "../../src/internal/html-reread.js";
import { MD033 } from "../../src/rules/MD033.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";

const extra = [
	{ name: "inline tags", source: "Text <b>bold</b> and <BR> and <img src='a.png'>\n" },
	{ name: "html block", source: "<div>\n<p>text <span>x</span></p>\n</div>\n" },
	{ name: "html block, indented lines", source: "<div>\n    <p>indented</p>\n</div>\n" },
	{
		name: "html block with a blank line",
		source: "<details>\n<summary>S</summary>\n\nBody <sub>2</sub>\n\n</details>\n",
	},
	{ name: "comment block", source: "<!-- a comment -->\n\ntext\n" },
	{ name: "inline comment", source: "text <!-- c --> more\n" },
	{ name: "processing instruction", source: "text <?php echo 1; ?> more\n" },
	{ name: "declaration and cdata", source: "text <!DOCTYPE html> and <![CDATA[x]]>\n" },
	{ name: "autolink is not html", source: "see <https://example.com> and <a@b.co>\n" },
	{ name: "escaped tag", source: "text \\<b> not html\n" },
	{ name: "code span", source: "text `<b>` and <i>x</i>\n" },
	{ name: "fenced code", source: "```html\n<div>\n```\n" },
	{ name: "indented code", source: "para\n\n    <div>\n" },
	{ name: "multi-line tag", source: "text <a\nhref='x'>link</a>\n" },
	{ name: "table", source: "| a | b |\n| - | - |\n| <br> | <b>x</b> |\n\n<br>\n" },
	{ name: "blockquote", source: "> <div>\n> <b>x</b>\n> </div>\n\n> text <i>y</i>\n" },
	{ name: "list item html block", source: "- <div>\n  <b>x</b>\n  </div>\n" },
	{ name: "heading", source: "# Title <small>sub</small>\n" },
	{ name: "self-closing", source: "text <br/> and <hr />\n" },
	{ name: "custom element", source: "<my-element attr>x</my-element>\n" },
	{ name: "front matter", source: "---\ntitle: <b>x</b>\n---\n<b>y</b>\n" },
	{ name: "no final newline", source: "<b>x</b>" },
	{ name: "html in math", source: "$$\n<b>x</b>\n$$\n\n<i>y</i>\n" },
	{ name: "unclosed html block at the end", source: "<div>\ntext <b>x</b>" },
	{ name: "html block type 7", source: "<custom>\n<b>x</b>\n\ntext\n" },
	{ name: "script block", source: "<script>\nvar a = '<b>';\n</script>\n" },
	{ name: "table interrupting an html block", source: "<div>\n| <b>a</b> | b |\n| - | - |\n</div>\n" },
	{ name: "table rows in an html block", source: "<div>\n| <b>a</b> | b |\n| - | - |\n| <i>c</i> | d |\n</div>\n" },
	{ name: "html block holding markdown blocks", source: "<div>\n# <b>x</b>\n- <i>y</i>\n> <u>z</u>\n</div>\n" },
	{ name: "html block in a list, past a blank line", source: "- <div>\n  <b>x</b>\n\n  <i>y</i>\n" },
	{ name: "html block, tab-indented line", source: "<div>\n\t<b>x</b>\n</div>\n" },
	{ name: "html block with a code span", source: "<div>\n`<b>`\n</div>\n" },
	{ name: "comment then a tag in an html block", source: "<div>\n<!-- c --> <b>x</b>\n</div>\n" },
	{ name: "inline math", source: "text $<b>$ and $$<i>$$\n" },
	{ name: "inline math, mismatched runs", source: "a $$<b>$ c$$ d <i>\n" },
	{ name: "inline math after a code span", source: "`$`<b>$</b>\n" },
	{ name: "inline math after an escape", source: "\\$<b>$ x\n" },
	{ name: "inline math over a line break", source: "$<b>\nnext$ <i>\n" },
	{ name: "inline math in a link", source: "[$<b>$](u) [a](u$<i>$)\n" },
	{ name: "inline math in an html block", source: "<div>\n$<b>$ <i>\n</div>\n" },
	{ name: "inline math over a code span", source: "$a `<b>$` <i>\n" },
	{ name: "inline math in a table", source: "| a |\n| - |\n| $<b>$ |\n" },
	{
		name: "allowed set from this repository",
		source: "a<br>b <details><summary>s</summary></details> <img src=x> <sup>1</sup><sub>2</sub> <span>no</span>\n",
	},
	{ name: "review: tilde fence in html block", source: "<div>\n~~~\n<b>x</b>\n~~~\n</div>\n" },
	{ name: "review: backtick fence in html block", source: "<div>\n```\n<b>x</b>\n```\n</div>\n" },
	{ name: "review: indented-4 line in pre block", source: "<pre>\n\n    <b>x</b>\n</pre>\n" },
	{ name: "review: blockquote html block later line", source: "> <div>\n> <b>x</b>\n> </div>\n" },
	{ name: "review: list item html block", source: "- <div>\n  <span>x</span>\n  </div>\n" },
	{ name: "review: comment inside block then tag", source: "<div>\n<!-- c --> <b>x</b>\n</div>\n" },
	{ name: "review: self closing", source: "<div>\n<br/>\n<img src=a />\n</div>\n" },
	{ name: "review: attr with gt", source: "<div title=\"a>b\">\n<span title='>'>x</span>\n</div>\n" },
	{ name: "review: nested tags across lines", source: '<div>\n<span\nclass="a">x</span>\n</div>\n' },
	{ name: "review: img after heading line in block", source: "<div>\n# <b>h</b>\n</div>\n" },
	{ name: "review: setext in html block", source: "<div>\n<b>x</b>\n===\n</div>\n" },
	{ name: "review: code span across fence-like lines", source: "<div>\n`a\n<b>x</b>\n`\n</div>\n" },
	{ name: "review: html block type7 with code span", source: "<span>\n`<b>` <i>y</i>\n</span>\n" },
	{ name: "review: script block with tags", source: "<script>\nvar a = '<b>';\n</script>\n" },
	{ name: "review: pre block blank lines", source: "<pre>\na\n\n<b>x</b>\n</pre>\n" },
	{ name: "review: html block, table rows", source: "<div>\n| a | <b>x</b> |\n| - | - |\n</div>\n" },
	{ name: "review: html block, link ref def", source: "<div>\n[a]: <b>\n</div>\n" },
	{ name: "review: html block, autolink", source: "<div>\n<http://x.y/<b>>\n</div>\n" },
	{ name: "review: html block, list then lazy", source: "<div>\n- a\n<b>x</b>\n</div>\n" },
	{ name: "review: html block tab line", source: "<div>\n\t<b>x</b>\n</div>\n" },
	{ name: "review: html block math", source: "<div>\n$$\n<b>x</b>\n$$\n</div>\n" },
	{ name: "review: html block blank then indented", source: "<pre>\n\n\t<b>x</b>\n</pre>\n" },
	{ name: "review: fence 3 closed by 4", source: "<div>\n```\n<b>x</b>\n````\n</div>\n" },
	{ name: "review: unclosed fence in block", source: "<div>\n```\n<b>x</b>\n</div>\n" },
	{ name: "review: heading ends code span", source: "<div>\n# `a\n<b>x</b>`\n</div>\n" },
	{ name: "review: blank-separated pre, code span pairs across blank", source: "<pre>\n`a\n\n<b>x</b>`\n</pre>\n" },
	{ name: "review: thematic break splits span", source: "<div>\n`a\n***\n<b>x</b>`\n</div>\n" },
	{ name: "review: list item splits span", source: "<div>\n`a\n- <b>x</b>`\n</div>\n" },
	{ name: "review: blockquote splits span", source: "<div>\n`a\n> <b>x</b>`\n</div>\n" },
	{ name: "review: inline math $", source: "a $<b>x</b>$ c\n" },
	{ name: "review: inline math $$", source: "a $$<b>x</b>$$ c\n" },
	{ name: "review: $ with space after", source: "a $ <b>x</b> $ c\n" },
	{ name: "review: escaped dollar", source: "a \\$<b>x</b>$ c\n" },
	{ name: "review: $ across lines", source: "a $x\n<b>y</b>$ c\n" },
	{ name: "review: $ in code then html", source: "`$` <b>x</b> $\n" },
	{ name: "review: $ in link text", source: "[a $](u) <b>x</b> $\n" },
	{ name: "review: $ in link dest", source: "[a](u$) <b>x</b> $\n" },
	{ name: "review: $ in link title", source: '[a](u "$") <b>x</b> $\n' },
	{ name: "review: $ unmatched size", source: "$$a$ <b>x</b> $\n" },
	{ name: "review: $ in emphasis", source: "*$* <b>x</b> $\n" },
	{ name: "review: $ in table cell", source: "| a | b |\n| - | - |\n| $x | <b>y</b>$ |\n" },
	{ name: "review: $ in autolink", source: "<http://a$b> <b>x</b> $\n" },
	{ name: "review: $ html attr", source: '<a title="$"> <b>x</b> $\n' },
	{ name: "review: $ in setext heading", source: "a $\n<b>x</b> $\n===\n" },
	{ name: "review: $ in link ref", source: "[a $][r] <b>x</b> $\n\n[r]: u\n" },
	{ name: "review: $ in undefined ref", source: "[a $][zz] <b>x</b> $\n" },
	{ name: "review: block in quote+list", source: "> - <div>\n>   <b>x</b>\n" },
	{ name: "review: $ in image alt", source: "![$](a.png) <b>x</b> $\n" },
	{ name: "review: $ in footnote call", source: "x[^a$] <b>y</b> $\n\n[^a$]: z\n" },
	{ name: "$ in a nested image label", source: "![a [$] b](u) <b>x</b> $\n" },
	{ name: "$ in an image destination", source: "![x](u$) <b>y</b> $\n" },
	{ name: "$ after an escaped bracket in an image label", source: "![\\]$](u) <b>x</b> $\n" },
	{ name: "$ in an image reference", source: "![x][r$] <b>y</b> $\n\n[r$]: /u\n" },
	{ name: "$ in a reference image label", source: "![$][r] <b>y</b> $\n\n[r]: /u\n" },
	{
		name: "review: indented ladder 12",
		source:
			"<pre>\n\n    <b>x</b>\n\n        <b>x</b>\n\n            <b>x</b>\n\n                <b>x</b>\n\n                    <b>x</b>\n\n                        <b>x</b>\n\n                            <b>x</b>\n\n                                <b>x</b>\n\n                                    <b>x</b>\n\n                                        <b>x</b>\n\n                                            <b>x</b>\n\n                                                <b>x</b>\n</pre>\n",
	},
	{
		name: "review: indented ladder 6",
		source:
			"<pre>\n\n    <b>x</b>\n\n        <b>x</b>\n\n            <b>x</b>\n\n                <b>x</b>\n\n                    <b>x</b>\n\n                        <b>x</b>\n</pre>\n",
	},
];

const run = runRule(MD033);

describe("MD033 no-inline-html", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD033, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint reads each list as `Array.isArray(list) ? list.map((x) => String(x).toLowerCase()) : []`, and
	// `table_allowed_elements || allowed_elements` for tables: a falsy table list falls back to `allowed_elements`,
	// a truthy one that is not an array allows nothing in a table.
	for (const [settings, expected] of [
		[{ allowed_elements: ["br", "details", "summary", "img", "sup", "sub"] }, 314],
		[{ allowed_elements: ["BR", "B"] }, 256],
		[{ allowed_elements: ["br"], table_allowed_elements: ["b"] }, 324],
		[{ table_allowed_elements: ["br"] }, 333],
		[{ allowed_elements: ["br"], table_allowed_elements: "" }, 326],
		[{ allowed_elements: ["br"], table_allowed_elements: "br" }, 331],
		[{ allowed_elements: [] }, 338],
		[{ allowed_elements: "br" }, 338],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD033, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				assert.strictEqual(result.oracleFindings, expected);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads a list that is not an array as empty, and a falsy table list as allowed_elements", () => {
		for (const { source } of extra) {
			for (const settings of [{ allowed_elements: "br" }, { allowed_elements: { br: true } }]) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
			assert.deepStrictEqual(
				run(source, { allowed_elements: ["br"], table_allowed_elements: 0 }),
				run(source, { allowed_elements: ["br"] }),
			);
		}
	});

	// Adversarial HTML blocks of thousands of lines: each re-read settles in a few parses, well inside the cap, and fast.
	const spaces = (count: number) => " ".repeat(count);
	for (const [name, lines, passes] of [
		[
			"alternating HTML and indented lines",
			Array.from({ length: 3000 }, (_, index) => (index % 2 === 0 ? "<div>" : "    <b>x</b>")),
			2,
		],
		[
			"blank-separated HTML, code and list items",
			Array.from(
				{ length: 3500 },
				(_, index) => ["<div>", "", "    x", "", "- <p>", "  ", "      y"][index % 7] as string,
			),
			3,
		],
		[
			"table rows and closing tags",
			Array.from({ length: 3000 }, (_, index) =>
				index % 3 === 0 ? "| a | <b>x</b> |" : index % 3 === 1 ? "| - | - |" : "</div>",
			),
			3,
		],
		[
			"an ever-deeper indented ladder in a pre block",
			[
				"<pre>",
				"",
				...Array.from({ length: 2000 }, (_, index) => [`${spaces(4 * ((index % 50) + 1))}<b>x</b>`, ""]).flat(),
				"</pre>",
			],
			2,
		],
		[
			"blockquotes nested ever deeper",
			Array.from({ length: 1000 }, (_, index) => `${">".repeat((index % 40) + 1)} <div> <b>x</b>`),
			3,
		],
		[
			"list items nested ever deeper",
			Array.from({ length: 1000 }, (_, index) => [
				`${spaces(2 * (index % 40))}- <div>`,
				`${spaces(2 * (index % 40) + 2)}<b>x</b>`,
			]).flat(),
			4,
		],
	] as const) {
		it(`settles the re-read of ${name} quickly`, () => {
			const started = Date.now();
			const reread = rereadHtmlBlock(lines, 1);
			assert.isBelow(Date.now() - started, 5_000);
			assert.isTrue(reread.settled);
			assert.isFalse(reread.swept);
			assert.isAtMost(reread.passes, passes);
			assert.isAbove(run(lines.join("\n")).length, 0);
		});
	}

	// Past the cap, the terminal sweep reads every line left: forced here with a cap of one, on blocks that need more.
	it("collects every tag through the terminal sweep when the cap is reached", () => {
		const flowParents = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);
		for (const source of [
			"<pre>\n\n    <b>1</b>\n\n        <b>2</b>\n\n            <b>3</b>\n</pre>",
			"> <div> <b>1</b>\n>> <div> <b>2</b>\n>>> <div> <b>3</b>",
			"- <div>\n  <b>1</b>\n  - <div>\n    <b>2</b>\n    - <div>\n      <b>3</b>",
		]) {
			const lines = source.split("\n");
			assert.isAbove(rereadHtmlBlock(lines, 1).passes, 1, source);
			const reread = rereadHtmlBlock(lines, 1, { maxPasses: 1 });
			assert.isTrue(reread.swept, source);
			assert.isFalse(reread.settled, source);
			assert.strictEqual(reread.passes, 2, source);
			const document = reread.document;
			assert.isDefined(document, source);
			// No line is left read as an HTML block or code, and every tag is inline HTML.
			const blocks: Array<string> = [];
			const inline: Array<string> = [];
			const visit = (node: MarkdownNode): void => {
				for (const child of ("children" in node ? node.children : []) as ReadonlyArray<MarkdownNode>) {
					if (child.type === "html") (flowParents.has(node.type) ? blocks : inline).push((child as Html).value);
					if (child.type === "code" && (child as Code).fenceChar === undefined) blocks.push((child as Code).value);
					visit(child);
				}
			};
			if (document !== undefined) visit(document.root as MarkdownNode);
			assert.deepStrictEqual(blocks, [], source);
			for (const tag of ["<b>", "</b>"]) assert.strictEqual(inline.filter((value) => value === tag).length, 3, source);
		}
	});

	it("reports an inline element with its name and the tag as its range", () => {
		const findings = run("Text <span class='x'>y</span>\n");
		assert.deepStrictEqual(
			findings.map((finding) => [
				finding.lineNumber,
				Option.getOrNull(finding.detail),
				Option.getOrNull(finding.range),
			]),
			[[1, "Element: span", [6, 16]]],
		);
	});

	it("reads a math opener line's meta as math, as markdownlint does, and the same text off one as markup", () => {
		// `$$$` closes the block but no inline math, so only the block-level exclusion can drop the opener's meta;
		// markdownlint 0.42.1 reports nothing for the first input. The second, with no opener, is still reported.
		assert.deepStrictEqual(run("$$ <b>x</b>\nx\n$$$\n"), []);
		assert.strictEqual(run("x <b>x</b>\nx\n$$$\n").length, 1);
	});

	// markdownlint coerces its settings (`Number(x ?? d)`, `!!x`, `String(x || d)`), so a non-canonical value
	// means to the kit what it means there.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD033,
				[
					{ allowed_elements: "b" },
					{ allowed_elements: ["B", 5] },
					{ allowed_elements: null },
					{ table_allowed_elements: "" },
					{ table_allowed_elements: [] },
					{ table_allowed_elements: "br" },
				],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Recorded divergence "a tab after spaces before a math fence in a container": the kit's fence patterns read
	// spaces only, where micromark expands the tab to its column. Here three spaces and a tab indent the fence past three columns, so micromark reads no math and markdownlint reports the HTML; the kit reads math.
	it(
		"reads a tab before a math fence in a blockquote unlike markdownlint",
		() => {
			const result = settingsDifferential(
				MD033,
				[{}],
				[{ name: "tab before a math fence", source: "> a\n>   \t$$\n> <b>x</b>\n> $$\n" }],
			);
			assert.strictEqual(result.divergences.length, 1);
			assert.match(result.divergences[0]?.reason ?? "", /^missing finding 1: markdownlint/);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD033 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 338;

// MD033 `no-inline-html`, held to markdownlint's own MD033 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { HTML_REREAD_MAX_PASSES, rereadHtmlBlock } from "../../src/internal/rule-helpers.js";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD033 } from "../../src/rules/MD033.js";
import { differential } from "../helpers/differential.js";

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
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD033], { config: { default: false, MD033: settings ?? true } });

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
	for (const [settings, changes] of [
		[{ allowed_elements: ["br", "details", "summary", "img", "sup", "sub"] }, true],
		[{ allowed_elements: ["BR", "B"] }, true],
		[{ allowed_elements: ["br"], table_allowed_elements: ["b"] }, true],
		[{ table_allowed_elements: ["br"] }, true],
		[{ allowed_elements: ["br"], table_allowed_elements: "" }, true],
		[{ allowed_elements: ["br"], table_allowed_elements: "br" }, true],
		[{ allowed_elements: [] }, false],
		[{ allowed_elements: "br" }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD033, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
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

	it("settles the re-read of a hostile HTML block within its bound, quickly", () => {
		// Thousands of lines that each open an HTML block or indented code, with and without blank lines between.
		const hostile = [
			Array.from({ length: 3000 }, (_, index) => (index % 2 === 0 ? "<div>" : "    <b>x</b>")),
			Array.from(
				{ length: 3500 },
				(_, index) => ["<div>", "", "    x", "", "- <p>", "  ", "      y"][index % 7] as string,
			),
			Array.from({ length: 3000 }, (_, index) =>
				index % 3 === 0 ? "| a | <b>x</b> |" : index % 3 === 1 ? "| - | - |" : "</div>",
			),
		];
		for (const lines of hostile) {
			const started = Date.now();
			const reread = rereadHtmlBlock(lines, 1);
			assert.isTrue(reread.settled);
			assert.isAtMost(reread.passes, HTML_REREAD_MAX_PASSES);
			const findings = run(lines.join("\n"));
			assert.isAbove(findings.length, 0);
			assert.isBelow(Date.now() - started, 5_000);
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
});

// markdownlint's MD033 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 318;

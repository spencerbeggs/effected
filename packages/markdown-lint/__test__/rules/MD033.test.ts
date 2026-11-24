// MD033 `no-inline-html`, held to markdownlint's own MD033 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
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
const ORACLE_FINDINGS_DEFAULT = 252;

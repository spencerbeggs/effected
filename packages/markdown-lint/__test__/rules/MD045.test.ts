// MD045 `no-alt-text`, held to markdownlint's own MD045 over the upstream
// fixture corpus (LF and CRLF) and over hand-written inputs.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD045 } from "../../src/rules/MD045.js";
import { differential } from "../helpers/differential.js";

const extra = [
	{ name: "inline images", source: "![](a.png) ![alt](b.png) ![ ](c.png)\n" },
	{ name: "reference images", source: "![][r] ![r] ![x][r] ![][nope]\n\n[r]: /u.png\n" },
	{ name: "image in a link", source: "[![](a.png)](https://example.com)\n" },
	{ name: "multi-line image", source: '![](a\n"title") and ![\nx](y)\n' },
	{ name: "escaped image", source: "\\![](a.png) !\\[](b.png)\n" },
	{ name: "image in a code span", source: "`![](a.png)`\n" },
	{ name: "image in fenced code", source: "```\n![](a.png)\n```\n" },
	{ name: "image in a blockquote and a list", source: "> ![](a.png)\n\n- ![](b.png)\n" },
	{ name: "image in a table", source: "| a |\n| - |\n| ![](a.png) |\n" },
	{ name: "image in a heading", source: "# ![](a.png)\n" },
	{ name: "image in inline math", source: "$![](a.png)$ ![](b.png)\n" },
	{ name: "image in math", source: "$$\n![](a.png)\n$$\n" },
	{ name: "html images", source: 'Text <img src="a.png"> <img src="b.png" alt=""> <IMG SRC="c.png" ALT="c">\n' },
	{ name: "aria-hidden", source: '<img src="a.png" aria-hidden="true"> <img src="b.png" aria-hidden="false">\n' },
	{ name: "aria-hidden spellings", source: "<img src=a aria-hidden=TRUE> <img src=b aria-hidden = 'true'>\n" },
	{ name: "html block images", source: '<p>\n<img src="a.png">\n<img src="b.png" alt="b">\n</p>\n' },
	{ name: "html block, markdown image", source: "<div>\n![](a.png)\n</div>\n" },
	{ name: "multi-line html image", source: '<img\nsrc="a.png">\n\ntext <img\nsrc="b.png">\n' },
	{ name: "closing img", source: "</img> <img/>\n" },
	{ name: "img in a comment", source: '<!-- <img src="a.png"> -->\n' },
	{ name: "img in inline math", source: '$<img src="a.png">$\n' },
	{ name: "front matter", source: "---\nimage: ![](x)\n---\n![](a.png)\n" },
	{ name: "no final newline", source: "![](a.png)" },
	{ name: "alt in another attribute", source: '<img data-alt="x" src="a.png"> <img src="alt=x">\n' },
	{ name: "footnote", source: "[^1]: ![](a.png)\n\nText[^1]\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string) => MarkdownLint.lint(source, [MD045], { config: { default: false, MD045: true } });

describe("MD045 no-alt-text", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD045, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports an image with no alternate text, with the image as its range", () => {
		const findings = run('Text ![](a.png) and <img src="b.png">\n');
		assert.deepStrictEqual(
			findings.map((finding) => [finding.lineNumber, Option.getOrNull(finding.range)]),
			[
				[1, [6, 10]],
				[1, [21, 17]],
			],
		);
	});
});

// markdownlint's MD045 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 52;

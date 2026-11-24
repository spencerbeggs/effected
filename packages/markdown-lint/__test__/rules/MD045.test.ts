// MD045 `no-alt-text`, held to markdownlint's own MD045 over the upstream
// fixture corpus (LF and CRLF) and over hand-written inputs.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD045 } from "../../src/rules/MD045.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";

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
	{ name: "review: md image in html block", source: "<div>\n![](a.png)\n</div>\n" },
	{ name: "review: img no alt in html block", source: '<div>\n<img src="a.png">\n</div>\n' },
	{ name: "review: img in heading in block MD045", source: "<div>\n# `a\n<img src=x>`\n</div>\n" },
	{ name: "review: MD045 image in math", source: "a $![](x)$ b\n" },
	{ name: "review: full ref empty label", source: "![][r]\n\n[r]: u\n" },
	{ name: "review: collapsed ref", source: "![r][]\n\n[r]: u\n" },
	{ name: "review: image in link", source: "[![](a)](b)\n" },
	{ name: "review: image label whitespace", source: "![ ](a)\n" },
	{ name: "review: image label escaped", source: "![\\]](a)\n" },
	{ name: "review: multi-line image", source: "![\n](a)\n" },
	{ name: "review: img uppercase in table", source: "| a |\n| - |\n| <IMG src=x> |\n" },
	{ name: "review: img alt in other attr", source: '<img data-alt="x" src=y>\n' },
	{ name: "review: img aria-hidden quoted", source: "<img aria-hidden='TRUE' src=y>\n" },
	{ name: "review: img multiline in para", source: "a <img\nsrc=y> b\n" },
	{ name: "review: block in list item lines", source: "- <div>\n  <img src=x>\n  </div>\n" },
	{ name: "review: block in quote lines", source: "> <div>\n> <img src=x>\n" },
	{ name: "review: $ in image alt", source: "![$](a.png) ![](b.png) $\n" },
	{
		name: "review: indented ladder 12 MD045",
		source:
			"<pre>\n\n    <img src=a>\n\n        <img src=a>\n\n            <img src=a>\n\n                <img src=a>\n\n                    <img src=a>\n\n                        <img src=a>\n\n                            <img src=a>\n\n                                <img src=a>\n\n                                    <img src=a>\n\n                                        <img src=a>\n\n                                            <img src=a>\n\n                                                <img src=a>\n</pre>\n",
	},
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const run = runRule(MD045);

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
const ORACLE_FINDINGS_DEFAULT = 73;

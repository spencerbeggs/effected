// MD031 `blanks-around-fences`, held to markdownlint's own MD031 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD031 } from "../../src/rules/MD031.js";
import { differential } from "../helpers/differential.js";

const extra = [
	{ name: "tight fence", source: "text\n```js\ncode\n```\ntext\n" },
	{ name: "tilde fence", source: "text\n~~~\ncode\n~~~\ntext\n" },
	{ name: "first and last line", source: "```\ncode\n```" },
	{ name: "no final newline after text", source: "```\ncode\n```\ntext" },
	{ name: "unclosed at the end", source: "text\n```\ncode\n" },
	{ name: "unclosed in a blockquote, lazy after", source: "> ```\n> code\nlazy\nmore\n" },
	{ name: "unclosed in a list item", source: "- ```\n  code\n- next\n" },
	{ name: "blockquote", source: "> text\n> ```\n> code\n> ```\n> text\n" },
	{ name: "nested blockquote", source: "> > text\n> > ```\n> > code\n> > ```\n> > text\n" },
	{ name: "list item", source: "- item\n  ```\n  code\n  ```\n  more\n" },
	{ name: "blockquote in a list", source: "- > text\n  > ```\n  > code\n  > ```\n  > more\n" },
	{ name: "list in a blockquote", source: "> - item\n>   ```\n>   code\n>   ```\n>   more\n" },
	{ name: "front matter above", source: "---\ntitle: x\n---\n```\ncode\n```\n" },
	{ name: "comment line above", source: "text\n<!-- c -->\n```\ncode\n```\n" },
	{ name: "tab-indented list fence", source: "-\ttext\n\t```\n\tcode\n\t```\n\tmore\n" },
	{ name: "indented fence", source: "text\n   ```\n   code\n   ```\ntext\n" },
	{ name: "fence in math", source: "$$\n```\nx\n```\n$$\n\ntext\n```\ny\n```\n" },
	{ name: "fence in html", source: "<div>\ntext\n```\nx\n```\n</div>\n" },
	{ name: "adjacent fences", source: "```\na\n```\n```\nb\n```\n" },
	{ name: "footnote", source: "[^1]: note\n    ```\n    code\n    ```\n    more\n\nText[^1]\n" },
	{ name: "long context", source: `text\n\`\`\`${"x".repeat(40)}\ncode\n\`\`\`\ntext\n` },
	{ name: "heading around", source: "# H\n```\ncode\n```\n# I\n" },
	{ name: "unclosed in a list, then a sibling item", source: "- ```\n  code\n- next\n" },
	{ name: "unclosed in a list, then an outdented fence", source: "1. Text\n   ```shell\n   fence\n  ```\n" },
	{ name: "unclosed in a list, then a blank and text", source: "- ```\n  code\n\n\nx\n" },
	{ name: "unclosed in a list at the end", source: "- ```\n  code\n" },
	{ name: "unclosed in a blockquote at the end", source: "> ```\n> code\n" },
	{ name: "unclosed in a blockquote, blank quoted lines", source: "> ```\n> code\n>\n> \nx\n" },
	{ name: "unclosed in a list, then a blockquote", source: "- ```\n  code\n> q\n" },
	{ name: "unclosed in a list, then a thematic break", source: "- ```\n  code\n* * *\n" },
	{ name: "unclosed in a list in a blockquote, then a nested quote", source: "> - ```\n>   code\n> > x\n" },
	{ name: "unclosed in a footnote, then another", source: "[^1]: ```\n    code\n[^2]: x\n\nText[^1][^2]\n" },
	{ name: "unclosed in a quote in a list at the end", source: "- > ```\n  > code\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD031], { config: { default: false, MD031: settings ?? true } });

describe("MD031 blanks-around-fences", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD031, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint reads `list_items` as `list_items === undefined || !!list_items`: any falsy value leaves list
	// items out, any truthy one keeps them.
	for (const [settings, changes] of [
		[{ list_items: false }, true],
		[{ list_items: 0 }, true],
		[{ list_items: "" }, true],
		[{ list_items: null }, true],
		[{ list_items: true }, false],
		[{ list_items: "no" }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD031, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads a falsy list_items as false and a truthy one as true", () => {
		for (const { source } of extra) {
			for (const settings of [{ list_items: 0 }, { list_items: "" }, { list_items: null }]) {
				assert.deepStrictEqual(run(source, settings), run(source, { list_items: false }), JSON.stringify(settings));
			}
			for (const settings of [{ list_items: "no" }, { list_items: 1 }, { list_items: {} }]) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

	it("reports a fence with no blank line around it, with fixes that insert them", () => {
		const source = "> text\n> ```\n> code\n> ```\n> more\n";
		const findings = run(source);
		assert.deepStrictEqual(
			findings.map((finding) => [
				finding.lineNumber,
				Option.getOrNull(finding.context),
				Option.getOrNull(Option.map(finding.fixInfo, (fix) => ({ ...fix }))),
			]),
			[
				[2, "> ```", { editColumn: 1, insertText: ">\n" }],
				[4, "> ```", { lineNumber: 5, editColumn: 1, insertText: ">\n" }],
			],
		);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings), "> text\n>\n> ```\n> code\n> ```\n>\n> more\n");
	});
});

// markdownlint's MD031 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 180;

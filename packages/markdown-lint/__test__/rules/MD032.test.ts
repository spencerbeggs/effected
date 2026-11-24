// MD032 `blanks-around-lists`, held to markdownlint's own MD032 over the
// upstream fixture corpus (LF and CRLF) and over hand-written inputs.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD032 } from "../../src/rules/MD032.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";
import { oracleLint } from "../helpers/markdownlint-oracle.js";
import { directiveBlockGrid, directiveListEnds } from "../helpers/table-grid.js";

const extra = [
	{ name: "tight list", source: "text\n- a\n- b\ntext\n" },
	{ name: "ordered list", source: "text\n1. a\n2. b\n\ntext\n" },
	{ name: "first and last line, no final newline", source: "- a\n- b" },
	{ name: "lazy continuation", source: "text\n\n- a\nlazy\n# H\n" },
	{ name: "nested list", source: "text\n- a\n  - b\n    - c\ntext\n" },
	{ name: "blockquote", source: "> text\n> - a\n> - b\n> text\n" },
	{ name: "nested blockquote", source: "> > text\n> > - a\n> > text\n" },
	{ name: "indented blockquote", source: "  > text\n  > - a\n  > text\n" },
	{ name: "list in a list item's blockquote", source: "- a\n\n  > text\n  > - b\n  > text\n" },
	{ name: "front matter above", source: "---\ntitle: x\n---\n- a\n" },
	{ name: "comment line above", source: "text\n<!-- c -->\n- a\n<!-- d -->\n" },
	{ name: "tab after the marker", source: "text\n-\ta\n-\tb\ntext\n" },
	{ name: "ending in a fence", source: "- a\n\n  ```\n  code\n  ```\ntext\n" },
	{ name: "ending in an unclosed fence", source: "- a\n\n  ```\n  code\ntext\n" },
	{ name: "ending in indented code", source: "- a\n\n      code\n\ntext\n" },
	{ name: "ending in an html block", source: "- a\n\n  <div>\n  x\n\ntext\n" },
	{ name: "ending in a table", source: "- a\n\n  | a |\n  | - |\n  | b |\ntext\n" },
	{ name: "empty item last", source: "- a\n-\ntext\n" },
	{ name: "empty item only", source: "text\n-\n" },
	{ name: "ending in a heading", source: "- # H\ntext\n" },
	{ name: "ending in a blank item line", source: "- a\n\n\n- b\n\ntext\n" },
	{ name: "footnote", source: "[^1]: note\n    - a\n    - b\n    more\n\nText[^1]\n" },
	{ name: "list in math", source: "$$\n- a\n$$\ntext\n" },
	{ name: "list in html", source: "<div>\n- a\n</div>\n" },
	{ name: "two lists", source: "- a\n+ b\n" },
	{ name: "after a heading", source: "# H\n- a\n# I\n" },
	{ name: "after a thematic break", source: "***\n- a\n***\n" },
	{ name: "footnote blockquote, label line", source: "[^1]: > - a\n    > text\n\nT[^1]\n" },
	{ name: "footnote blockquote, indented", source: "[^1]:\n    > - a\n    > text\n\nT[^1]\n" },
	{ name: "footnote blockquote, indented five", source: "[^1]:\n     > - a\n     > text\n\nT[^1]\n" },
	{ name: "footnote in a blockquote", source: "> [^1]:\n>     > - a\n>     > text\n" },
	{ name: "blockquote in a list item", source: "- x\n\n  > text\n  > - a\n  > text\n" },
	{ name: "blockquote indented three", source: "   > - a\n   > text\n" },
	{ name: "ending in a setext underline", source: "- a\n  - \ntext\n" },
	{ name: "math in an item, then a lazy line", source: "- a\n  $$\n  x\n  $$\ntext\n" },
	{ name: "unclosed math in an item, then a lazy line", source: "- a\n  $$\n  x\ntext\n" },
	{ name: "math in an item, then an item line", source: "- a\n  $$\n  x\n  $$\n  more\ntext\n" },
	{ name: "math in a quoted item, then a lazy line", source: "> - a\n>   $$\n>   x\n>   $$\ntext\n" },
	{ name: "lazy math opener after an item", source: "$$\nx\n$$\n- a\n$$\ny\n$$\n" },
	{ name: "lazy math opener in a blockquote", source: "> - a\n> $$\n> y\n> $$\n" },
	{ name: "math in a nested item", source: "- - a\n  $$\n  x\n  $$\n- b\n" },
];

const run = runRule(MD032);

describe("MD032 blanks-around-lists", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD032, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a list with no blank line around it, with fixes that insert them", () => {
		const source = "> text\n> - a\n> ***\n";
		const findings = run(source);
		assert.deepStrictEqual(
			findings.map((finding) => [
				finding.lineNumber,
				Option.getOrNull(finding.context),
				Option.getOrNull(Option.map(finding.fixInfo, (fix) => ({ ...fix }))),
			]),
			[
				[2, "> - a", { editColumn: 1, insertText: ">\n" }],
				[2, "> - a", { lineNumber: 3, editColumn: 1, insertText: ">\n" }],
			],
		);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings), "> text\n>\n> - a\n>\n> ***\n");
	});

	// The math-block cut lines were once spread into Math.min, which overflows the call stack on this many.
	it(
		"reads a list item holding 150,000 math blocks as markdownlint does, without throwing",
		() => {
			const source = `- a\n${"$$\n$$\n".repeat(150_000)}`;
			const kit = run(source).map((finding) => finding.lineNumber);
			const oracle = oracleLint(source, { default: false, MD032: true }).map((finding) => finding.lineNumber);
			assert.deepStrictEqual(kit, oracle);
			assert.strictEqual(kit.length, 1);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint's directive extension ends a paragraph (and a lazy list item, and a table) before a directive line,
	// and reads an indented line after one as code: beside each block kind, in each container.
	it(
		"agrees with markdownlint beside directive lines",
		() => {
			const result = differential(MD032, { extra: [...directiveBlockGrid, ...directiveListEnds] });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DIRECTIVE_BLOCKS);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD032 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 122;

// markdownlint's MD032 findings over the corpus (LF and CRLF) and the blocks beside directive lines.
const ORACLE_FINDINGS_DIRECTIVE_BLOCKS = 115;

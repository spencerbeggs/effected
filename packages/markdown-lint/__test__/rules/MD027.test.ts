// MD027 `no-multiple-space-blockquote`, held to markdownlint's own MD027 over
// the upstream fixture corpus (LF and CRLF) and over inputs its setting
// changes. markdownlint reports a `linePrefix` token right after a
// `blockQuotePrefix`: the whitespace past a blockquote's marker and its one
// optional space where a block starts or a paragraph continues.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD027 } from "../../src/rules/MD027.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";

const extra = [
	{ name: "paragraph", source: ">  a\n>  b\n> c\n>   d\n" },
	{ name: "lazy continuation", source: ">  a\n  b\n" },
	{ name: "blank quote line", source: ">  \n> a\n" },
	{ name: "tab after the marker", source: ">\t a\n>  \tb\n" },
	{ name: "nested", source: "> >  a\n>  > b\n" },
	{ name: "indented quote", source: "  >  a\n" },
	{ name: "headings and rules", source: ">  # H\n>\n> a\n>  ===\n>\n>  ---\n" },
	{ name: "fenced code", source: ">  ```\n>  x\n>  ```\n\n> ```\n>   y\n> ```\n" },
	{ name: "indented code", source: ">     code\n>      more\n" },
	{ name: "paragraph then indented", source: "> a\n>     b\n" },
	{ name: "math", source: ">  $$\n>  x\n>  $$\n" },
	{ name: "html", source: ">  <div>\n>  x\n>  </div>\n" },
	{ name: "table", source: ">  | a |\n>  | - |\n>  | b |\n" },
	{ name: "list items", source: ">  - a\n>  - b\n>    c\n> - d\n>    e\n" },
	{ name: "list with blank", source: "> - a\n>\n>    b\n>\n>     c\n" },
	{ name: "ordered list", source: "> 1. a\n>    2. b\n>  3. c\n" },
	{ name: "quote in a list", source: "- a\n\n  >  b\n  >  c\n" },
	{ name: "list in a quote in a list", source: "- > - a\n  >    b\n" },
	{ name: "front matter", source: "---\ntitle: x\n---\n>  a\n" },
	{ name: "long line", source: `>  ${"word ".repeat(10)}\n` },
	{ name: "CRLF", source: ">  a\r\n>  b\r\n>  \r\n" },
];

const run = runRule(MD027);

describe("MD027 no-multiple-space-blockquote", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD027, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// The setting changes markdownlint's findings over the same inputs; the default spelled out changes nothing.
	for (const [settings, changes] of [
		[{ list_items: false }, true],
		[{ list_items: true }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD027, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `list_items === undefined || !!list_items`.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD027,
				[{ list_items: 0 }, { list_items: "" }, { list_items: null }, { list_items: "no" }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports the extra spaces with the line as context and a fix that deletes them", () => {
		const source = ">   text\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.context, Option.some(">   text"));
		assert.deepStrictEqual(finding?.range, Option.some([3, 2] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"> text\n",
		);
	});
});

// markdownlint's MD027 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 151;

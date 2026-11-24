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
import { unclosedFenceEnds, wrappedLinkEnds } from "../helpers/link-grid.js";
import { quotedBlankGrid } from "../helpers/list-container-grid.js";
import { directiveBlockGrid, directiveListEnds } from "../helpers/table-grid.js";

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
	// A blank quoted line after a list item is the item's blank continuation, not a `linePrefix`.
	{ name: "blank between items", source: "> - a\n>    \n> - b\n" },
	{ name: "blank after a list", source: "> - a\n>    \n" },
	{ name: "blank after a list, then text", source: "> - a\n>  \n> text\n" },
	{ name: "blank after an ordered list", source: "> 1. a\n>    \n" },
	{ name: "blank after a nested-quote list", source: "> > - a\n> >    \n" },
	{ name: "blank after a sublist", source: "> - a\n>   - b\n>      \n" },
	{ name: "blank after text after a list", source: "> - a\n>\n> text\n>   \n> more\n" },
	// But only within the item's own blockquote: past an unquoted blank line or a top-level list it is a new quote's.
	{ name: "quoted list, blank, new quote", source: "> - a\n\n>   \n> b\n" },
	{ name: "list, blank, new quote", source: "- a\n\n>   \n> b\n" },
	{ name: "list, then a new quote", source: "- a\n>   \n> b\n" },
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

	// How micromark reads a quoted line of spaces after a list, pinned as a whole grid of container stacks, list
	// shapes, separators and following lines (see `quotedBlankGrid`), under both `list_items` readings.
	it(
		"agrees with markdownlint over the quoted-blank grid",
		() => {
			const result = settingsDifferential(MD027, [{}, { list_items: false }], quotedBlankGrid);
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_GRID);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Not a divergence of the port: after a tab right behind `>`, markdownlint reports a range over the partly
	// consumed tab and throws on its own `range`. The kit reports nothing there.
	it(
		"reads a tab right after the marker where markdownlint throws on its own range",
		() => {
			const result = settingsDifferential(
				MD027,
				[{ list_items: true }],
				[{ name: "tab after the marker", source: ">\ttab\n" }],
			);
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				["tab after the marker"],
			);
			assert.match(
				result.divergences[0]?.reason ?? "",
				/^markdownlint throws: Value of 'range' passed to onError by 'MD027' is incorrect for 'input'\.; kit: 0 findings$/,
			);
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

	// markdownlint's directive extension ends a paragraph (and a lazy list item, and a table) before a directive line,
	// and reads an indented line after one as code: beside each block kind, in each container.
	it(
		"agrees with markdownlint beside directive lines",
		() => {
			const result = differential(MD027, { extra: [...directiveBlockGrid, ...directiveListEnds] });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DIRECTIVE_BLOCKS);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// A line lazy to an inner container (a list item, a nested quote) still carries the outer quote's prefix, and
	// markdownlint reads the whitespace after it.
	for (const settings of [{}, { list_items: false }]) {
		it(
			`agrees with markdownlint on lazy continuation lines under ${JSON.stringify(settings)}`,
			() => {
				const lazyLines = [
					{ name: "lazy to a list item", source: "> - a\n>  b\n" },
					{ name: "lazy to an ordered item", source: "> 1. a\n>   b\n" },
					{ name: "lazy to a nested quote", source: "> > a\n>  b\n" },
					{ name: "several lazy lines", source: "> - a\n>  b\n>   c\n> d\n" },
					{ name: "lazy with a tab", source: "> - a\n>\tb\n" },
					{ name: "lazy to an item in a nested quote", source: "> > - a\n> >  b\n" },
					{ name: "lazy line with no prefix", source: "> - a\n  b\n" },
				];
				const result = differential(MD027, { config: settings, extra: lazyLines });
				assert.deepStrictEqual(result.divergences, []);
				assert.isAbove(result.oracleFindings, 0);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// An unclosed fence ending the source with no final line ending: micromark reads its last line as code.
	it(
		"agrees with markdownlint on an unclosed fence ending the source",
		() => {
			const result = differential(MD027, { extra: unclosedFenceEnds });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_UNCLOSED);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// A list ending in a link whose destination or title wraps: the list ends on the wrapped line.
	it(
		"agrees with markdownlint on a list ending in a wrapped link",
		() => {
			const result = differential(MD027, { extra: wrappedLinkEnds });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_WRAPPED);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD027 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 155;
// markdownlint's MD027 findings over the quoted-blank grid, under both settings cases.
const ORACLE_FINDINGS_GRID = 543;

// markdownlint's MD027 findings over the corpus (LF and CRLF) and the blocks beside directive lines.
const ORACLE_FINDINGS_DIRECTIVE_BLOCKS = 121;

// markdownlint's MD027 findings over the corpus (LF and CRLF) and the unclosed fences ending the source.
const ORACLE_FINDINGS_UNCLOSED = 120;

// markdownlint's MD027 findings over the corpus (LF and CRLF) and the lists ending in a wrapped link.
const ORACLE_FINDINGS_WRAPPED = 120;

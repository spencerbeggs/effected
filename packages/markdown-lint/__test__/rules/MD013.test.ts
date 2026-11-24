// MD013 `line-length`, held to markdownlint's own MD013 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD013 } from "../../src/rules/MD013.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { indentedCodeTails } from "../helpers/link-grid.js";

const long = "word ".repeat(18).trim();
const extra = [
	{
		name: "math in a blockquote, unclosed",
		source: "> $$\n> x\n\n# Alpha heading text here\n\n### Gamma heading text here\n",
	},
	{
		name: "math fence indented four in a paragraph",
		source: "text\n    $$\n# Alpha heading text here\n\n### Gamma heading text here\n",
	},
	{
		name: "math closing fence indented four",
		source: "$$\n    $$\n# Alpha heading text here\n\n### Gamma heading text here\n",
	},
	{ name: "math in a list item", source: "- $$\n  # Alpha heading text here\n  ### Gamma heading text here\n  $$\n" },
	{
		name: "math fence in fenced code",
		source: "```\n$$\n```\n# Alpha heading text here\n\n### Gamma heading text here\n",
	},
	{
		name: "math fence in an HTML block",
		source: "<div>\n$$\n</div>\n\n# Alpha heading text here\n\n### Gamma heading text here\n",
	},
	{
		name: "math ended by a lazy line",
		source: "> $$\nlazy\n# Alpha heading text here\n\n### Gamma heading text here\n",
	},
	{
		name: "math interrupting a paragraph",
		source: "text\n$$\n# Alpha heading text here\n\n### Gamma heading text here\n$$\n",
	},
	{
		name: "math unclosed in a list item",
		source: "- item\n\n  $$\n  # Alpha heading text here\n  ### Gamma heading text here\n\n- next\n\n### D\n",
	},
	{ name: "long prose", source: `${long} tail\n\nshort\n` },
	{ name: "long last word", source: `${"a".repeat(75)} ${"b".repeat(30)}\n` },
	{ name: "unwrappable line", source: `${"x".repeat(100)}\n\n> ${"y".repeat(100)}\n\n# ${"z".repeat(100)}\n` },
	{ name: "trailing space at the limit", source: `${"a".repeat(79)} \n` },
	{ name: "long atx heading", source: `# ${long}\n` },
	{ name: "long setext heading", source: `${long}\n===\n` },
	{ name: "long fenced code", source: `\`\`\`\n${long}\n\`\`\`\n` },
	{ name: "long unclosed fence", source: `\`\`\`\n${long}\n` },
	{ name: "long indented code", source: `para\n\n    ${long}\n` },
	{ name: "long table", source: `| a | b |\n| - | - |\n| ${long} | x |\n` },
	{ name: "link-only line", source: `[${long}](https://example.com/a/very/long/path/that/keeps/going/on)\n` },
	{ name: "autolink-only line", source: `<https://example.com/${"p".repeat(90)}>\n` },
	{ name: "literal autolink line", source: `https://example.com/${"p".repeat(90)}\n` },
	{ name: "link with text", source: `see [${long}](https://example.com/a/very/long/path/that/keeps/going/on)\n` },
	{
		name: "two links on two lines",
		source: `[a](https://example.com/${"p".repeat(80)})\n[b](https://example.com/${"q".repeat(80)})\n`,
	},
	{ name: "link then a space", source: `[a](https://example.com/${"p".repeat(80)}) \nnext\n` },
	{ name: "image line", source: `![${long}](https://example.com/i.png)\n` },
	{ name: "reference definition", source: `[ref]: https://example.com/${"p".repeat(90)}\n\n[ref]\n` },
	{ name: "footnote definition", source: `[^1]: ${long} ${long}\n\nText[^1]\n` },
	{ name: "undefined reference", source: `[${long}] ${"w".repeat(20)}\n` },
	{ name: "front matter", source: `---\ntitle: ${long} ${long}\n---\n\n${long} end\n` },
	{ name: "mid-length heading", source: `# ${"h".repeat(38)}\n` },
	{ name: "link then an escape", source: `[${long}](https://example.com/a/very/long/path/that/keeps/going/on)\\*\n` },
	{ name: "link then an entity", source: `[${long}](https://example.com/a/very/long/path/that/keeps/going/on)&amp;\n` },
	{
		name: "link then a non-entity",
		source: `[${long}](https://example.com/a/very/long/path/that/keeps/going/on)&nope;\n`,
	},
	{
		name: "link then a numeric entity",
		source: `[${long}](https://example.com/a/very/long/path/that/keeps/going/on)&#42;\n`,
	},
	// No named reference of 32 letters exists, so this one stays text to both parsers, and the line is not link-only.
	{
		name: "link then a 32-letter name",
		source: `[${"word ".repeat(18)}end](https://example.com)&${"a".repeat(32)};\n`,
	},
	{ name: "heading in a math block", source: `$$\n# ${long}\n$$\n` },
	{ name: "blockquote and list", source: `> ${long} end\n\n- ${long} end\n` },
];

const run = runRule(MD013);

describe("MD013 line-length", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD013, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs, so its run is not the default run again;
	// a setting spelled as its default changes nothing.
	for (const [settings, changes] of [
		[{ line_length: 40 }, true],
		[{ line_length: 0 }, true],
		[{ line_length: 40, heading_line_length: 120 }, true],
		[{ heading_line_length: 20 }, true],
		[{ code_block_line_length: 20 }, true],
		[{ code_blocks: false }, true],
		[{ tables: false }, true],
		[{ headings: false }, true],
		[{ strict: true }, true],
		[{ stern: true }, true],
		[{ strict: true, stern: true }, true],
		[{ line_length: 80, code_blocks: true, tables: true, headings: true, strict: false, stern: false }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD013, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (!("line_length" in settings && settings.line_length === 0)) assert.isAbove(result.oracleFindings, 0);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint coerces its settings (`Number(x ?? d)`, `!!x`, `String(x || d)`), so a non-canonical value
	// means to the kit what it means there.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD013,
				[
					{ line_length: "50" },
					{ line_length: null },
					{ line_length: "x" },
					{ line_length: true },
					{ heading_line_length: "5" },
					{ heading_line_length: null },
					{ code_block_line_length: "10" },
					{ code_block_line_length: null },
					{ line_length: 50, strict: 1 },
					{ line_length: 50, strict: "x" },
					{ line_length: 50, stern: "yes" },
					{ line_length: 50, stern: 0 },
					{ line_length: 50, code_blocks: 0 },
					{ line_length: 50, code_blocks: "" },
					{ line_length: 20, tables: 0 },
					{ line_length: 20, tables: "no" },
					{ line_length: 50, headings: 0 },
					{ line_length: 50, headings: null },
				],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint reports a fractional limit's overflow as fractional range columns (`[51.5, 69.5]`), which a kit
	// range, in whole columns, cannot hold: the kit's finding carries no range, and lines and details agree.
	// Recorded as "a fractional MD013 limit reports no range".
	it(
		"differs from markdownlint under a fractional limit only in the range",
		() => {
			const result = settingsDifferential(
				MD013,
				[{ line_length: 50.5 }, { heading_line_length: 5.5 }, { code_block_line_length: 10.5 }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.strictEqual(result.divergences.length, FRACTIONAL_LIMIT_DIVERGENCES);
			for (const divergence of result.divergences)
				assert.match(divergence.reason, /\) range: kit null, markdownlint \[\d+\.5,\d+\.5\]$/);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// A space before a soft line break is micromark's `lineSuffix`, not `data`, so a line holding a link, a character
	// reference and that space is link-only to markdownlint. Found by fuzzing the paragraph-text reading.
	it(
		"reads a space before a line break as no paragraph text",
		() => {
			const link = "[link](http://example.com/a/long/path/x)";
			const result = settingsDifferential(
				MD013,
				[{ line_length: 20 }],
				[
					{ name: "reference then a space", source: `${link}&#38; \nx\n` },
					{ name: "named reference then a space", source: `${link}&amp; \nx\n` },
					{ name: "reference then a tab", source: `${link}&lt;\t\nx\n` },
					{ name: "control: text then a space", source: `${link} y \nx\n` },
				],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, 1);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Recorded divergence "a decoded and an escaped reference in one text node": the kit tells a decoded named
	// reference from text the parse left by looking for it in the node's value, and an escaped `\&amp;` later in the
	// same node leaves `&amp;` there, so the decoded one reads as text and its link line is not link-only.
	it(
		"reads a decoded named reference as text when the same text node holds it escaped",
		() => {
			const link = "[link](http://example.com/a/long/path/x)";
			const result = settingsDifferential(
				MD013,
				[{ line_length: 20 }],
				[{ name: "decoded then escaped", source: `${link}&amp; \n&lt;\\&amp;\n` }],
			);
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.reason),
				[
					'extra finding 1: kit {"lineNumber":1,"ruleNames":["MD013","line-length"],"detail":"Expected: 20; Actual: 46","context":null,"range":[21,26],"fixInfo":null,"severity":"error"}',
				],
			);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a line past the limit with the overflow as its range", () => {
		const source = `${"a".repeat(30)} ${"b".repeat(30)} ${"c".repeat(30)}\n`;
		const findings = run(source, { line_length: 40 });
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.detail, Option.some("Expected: 40; Actual: 92"));
		assert.deepStrictEqual(finding?.range, Option.some([41, 52] as const));
		assert.isTrue(Option.isNone(finding?.fixInfo ?? Option.none()));
	});

	// Whitespace-only lines after an indented code block, which micromark's token takes in from four columns.
	it(
		"agrees with markdownlint on whitespace-only lines after indented code",
		() => {
			const result = differential(MD013, { extra: indentedCodeTails });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_CODE_TAILS);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD013 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 165;

// The inputs on which a fractional limit's finding differs in its range (see the test above).
const FRACTIONAL_LIMIT_DIVERGENCES = 29;

// markdownlint's MD013 findings over the corpus (LF and CRLF) and the lines after indented code.
const ORACLE_FINDINGS_CODE_TAILS = 150;

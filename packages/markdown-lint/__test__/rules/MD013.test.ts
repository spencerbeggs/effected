// MD013 `line-length`, held to markdownlint's own MD013 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD013 } from "../../src/rules/MD013.js";
import { differential } from "../helpers/differential.js";

const long = "word ".repeat(18).trim();
const extra = [
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
	{ name: "blockquote and list", source: `> ${long} end\n\n- ${long} end\n` },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD013], { config: { default: false, MD013: settings ?? true } });

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
				assert.deepStrictEqual(
					result.divergences.map((divergence) => divergence.fixture),
					"heading_line_length" in settings && settings.heading_line_length === 20 ? MATH_BLOCK_HEADINGS : [],
				);
				for (const divergence of result.divergences)
					assert.match(divergence.reason, /^extra finding \d+: .*"lineNumber":(48|49|50),/);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads a wrong-typed setting as its default", () => {
		for (const settings of [
			{ line_length: "40" },
			{ heading_line_length: "20" },
			{ code_block_line_length: null },
			{ code_blocks: "no" },
			{ tables: 0 },
			{ headings: "false" },
			{ strict: "true" },
			{ stern: 1 },
		]) {
			for (const { source } of extra) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

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
});

// A parser-reading difference, not a port defect: markdownlint's micromark runs the math extension, so the `$$`
// block in headings-with-invalid-spaces.md is math, while the kit reads its `## …` lines as headings. A heading
// limit below their length reports them in the kit alone.
const MATH_BLOCK_HEADINGS = ["headings-with-invalid-spaces.md", "headings-with-invalid-spaces.md (CRLF)"];

// markdownlint's MD013 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 162;

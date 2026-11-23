// MD012 `no-multiple-blanks`, held to markdownlint's own MD012 over the
// upstream fixture corpus (LF and CRLF) and over inputs its setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD012 } from "../../src/rules/MD012.js";
import { differential } from "../helpers/differential.js";

const extra = [
	{ name: "two blanks", source: "a\n\n\nb\n" },
	{ name: "three blanks", source: "a\n\n\n\nb\n" },
	{ name: "whitespace-only blanks", source: "a\n  \n\t\n\nb\n" },
	{ name: "blanks at the end", source: "a\n\n\n" },
	{ name: "blanks at the end, CRLF", source: "a\r\n\r\n\r\n\r\n" },
	{ name: "blank last line with spaces", source: "a\n\n  " },
	{ name: "empty document", source: "" },
	{ name: "blanks at the start", source: "\n\n\na\n" },
	{ name: "blanks in fenced code", source: "```\nx\n\n\n\ny\n```\n" },
	{ name: "blanks after an unclosed fence", source: "```\nx\n\n\n" },
	{ name: "blanks in indented code", source: "para\n\n    x\n\n\n\n    y\n\n\nafter\n" },
	{ name: "blanks in a blockquote", source: "> a\n>\n>\n> b\n" },
	{ name: "blanks in a list", source: "- a\n\n\n- b\n" },
	{ name: "front matter blanks", source: "---\na: 1\n\n\n\nb: 2\n---\ntext\n" },
	{ name: "CRLF blanks", source: "a\r\n\r\n\r\nb\r\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD012], { config: { default: false, MD012: settings ?? true } });

describe("MD012 no-multiple-blanks", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD012, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs, so its run is not the default run again;
	// an explicit `maximum: 1` is the default spelled out.
	for (const [settings, changes] of [
		[{ maximum: 2 }, true],
		[{ maximum: 1 }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD012, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				assert.isAbove(result.oracleFindings, 0);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it(
		"agrees with markdownlint under { maximum: 0 } wherever markdownlint does not throw",
		() => {
			const result = differential(MD012, { config: { maximum: 0 }, extra });
			// Not a divergence of the port: markdownlint 0.42.1 throws on a file that is all front matter with no final
			// line break. Its content is one empty line, numbered one past its per-line enabled state, and MD012 with
			// `maximum: 0` is the one rule here that reports that line. The kit reads no content line and reports nothing.
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				["front-matter-no-crlf.md", "front-matter-no-crlf.md (CRLF)"],
			);
			for (const divergence of result.divergences) assert.match(divergence.reason, /^markdownlint throws: /);
			assert.isAbove(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reads a wrong-typed setting as its default", () => {
		for (const settings of [{ maximum: "2" }, { maximum: true }]) {
			for (const { source } of extra) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

	it("reports each blank line past the maximum, with a fix that deletes it", () => {
		const source = "a\n\n\n\nb\n";
		const findings = run(source);
		assert.deepStrictEqual(
			findings.map((finding) => [finding.lineNumber, Option.getOrNull(finding.detail)]),
			[
				[3, "Expected: 1; Actual: 2"],
				[4, "Expected: 1; Actual: 3"],
			],
		);
		assert.deepStrictEqual(findings[0]?.fixInfo.pipe(Option.map((fix) => fix.deleteCount)), Option.some(-1));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"a\n\nb\n",
		);
	});
});

// markdownlint's MD012 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 60;

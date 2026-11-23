// MD022 `blanks-around-headings`, held to markdownlint's own MD022 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD022 } from "../../src/rules/MD022.js";
import { differential } from "../helpers/differential.js";

const extra = [
	{ name: "mixed line endings", source: "text\r\n# H\ntext\n\n## Two\r\nmore\r\n" },
	{ name: "tight headings", source: "text\n# One\ntext\n## Two\n### Three\n" },
	{ name: "setext", source: "text\nOne\n===\ntext\n" },
	{ name: "blockquote", source: "> text\n> # Quoted\n> text\n" },
	{ name: "nested blockquote", source: "> > text\n> > # Deep\n> > text\n" },
	{ name: "list", source: "- item\n  # Listed\n  more\n" },
	{ name: "first and last line", source: "# First\ntext\n# Last" },
	{ name: "front matter above", source: "---\ntitle: x\n---\n# After\n\ntext\n" },
	{ name: "front matter with a blank last line", source: "---\ntitle: x\n\n---\n# After\n" },
	{ name: "two blank lines", source: "text\n\n\n# Two\n\n\ntext\n" },
	{ name: "comment line above", source: "text\n<!-- c -->\n# Heading\n" },
	{ name: "levels", source: "# One\n## Two\n### Three\n#### Four\n" },
	{ name: "in math", source: "$$\n# not\n$$\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD022], { config: { default: false, MD022: settings ?? true } });

describe("MD022 blanks-around-headings", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD022, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; `1` is the default spelled out.
	for (const [settings, changes] of [
		[{ lines_above: 2 }, true],
		[{ lines_below: 2 }, true],
		[{ lines_above: 0, lines_below: 0 }, true],
		[{ lines_above: -1 }, true],
		[{ lines_above: [2, 1, 0], lines_below: [1, -1] }, true],
		[{ include_front_matter: true }, true],
		[{ include_front_matter: true, lines_above: 2 }, true],
		[{ lines_above: 1, lines_below: 1, include_front_matter: false }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD022, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads a wrong-typed setting as its default", () => {
		for (const settings of [{ lines_above: "2" }, { lines_below: [1, "2"] }, { include_front_matter: "yes" }]) {
			for (const { source } of extra) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

	it("reports a heading with no blank line around it, with fixes that insert them", () => {
		const source = "text\n# Heading\nmore\n";
		const findings = run(source);
		assert.deepStrictEqual(
			findings.map((finding) => [
				finding.lineNumber,
				Option.getOrNull(finding.detail),
				Option.getOrNull(finding.context),
			]),
			[
				[2, "Expected: 1; Actual: 0; Above", "# Heading"],
				[2, "Expected: 1; Actual: 0; Below", "# Heading"],
			],
		);
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"text\n\n# Heading\n\nmore\n",
		);
	});
});

// markdownlint's MD022 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 145;

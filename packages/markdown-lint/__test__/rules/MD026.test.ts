// MD026 `no-trailing-punctuation`, held to markdownlint's own MD026 over the
// upstream fixture corpus (LF and CRLF) and over inputs its setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD026 } from "../../src/rules/MD026.js";
import { differential } from "../helpers/differential.js";

const extra = [
	{ name: "trailing punctuation", source: "# Done.\n\n## Wait!\n\n### Why?\n\n#### List:\n" },
	{ name: "full width", source: "# 完了。\n\n## 注意！\n" },
	{ name: "spaces before", source: "# Spaced .\n\n## Closed. ##\n" },
	{ name: "entity and emoji", source: "# Copy &copy;\n\n## Smile :smile:\n\n### Entity &#169;\n" },
	{ name: "setext", source: "Two lines\nend.\n===\n" },
	{ name: "run of marks", source: "# Really?!.\n" },
	{ name: "empty and markup", source: "#\n\n# *Emphasis*.\n\n# `code.`\n" },
	{ name: "in math", source: "$$\n# not.\n$$\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD026], { config: { default: false, MD026: settings ?? true } });

describe("MD026 no-trailing-punctuation", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD026, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the default spelled out changes nothing.
	for (const [settings, changes] of [
		[{ punctuation: ".,;:!?" }, true],
		[{ punctuation: "" }, true],
		[{ punctuation: "^$*" }, true],
		[{ punctuation: ".,;:!。，；：！" }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD026, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads a wrong-typed setting as its default", () => {
		for (const settings of [{ punctuation: 1 }, { punctuation: ["."] }]) {
			for (const { source } of extra) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

	it("reports trailing punctuation with its span and a fix that deletes it", () => {
		const source = "# Heading.\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.detail, Option.some("Punctuation: '.'"));
		assert.deepStrictEqual(finding?.range, Option.some([10, 1] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"# Heading\n",
		);
	});
});

// markdownlint's MD026 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 56;

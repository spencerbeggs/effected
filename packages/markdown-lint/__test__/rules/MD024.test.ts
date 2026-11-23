// MD024 `no-duplicate-heading`, held to markdownlint's own MD024 over the
// upstream fixture corpus (LF and CRLF) and over inputs its setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD024 } from "../../src/rules/MD024.js";
import { differential } from "../helpers/differential.js";

const extra = [
	{ name: "repeated top level", source: "# Same\n\n# Same\n" },
	{ name: "same text in sections", source: "# A\n\n## Notes\n\n# B\n\n## Notes\n\n### Deep\n\n## Notes\n" },
	{ name: "markup and html", source: "# *A* <b>x</b>\n\n# *A* x\n\n# A x\n" },
	{ name: "closed and setext", source: "# Same #\n\nSame\n===\n" },
	{ name: "multi-line setext", source: "Line one\nline two\n---\n\n## Line one line two\n" },
	{ name: "empty headings", source: "#\n\n#\n" },
	{ name: "escapes and entities", source: "# a \\# b\n\n# a # b\n\n# &amp;\n\n# &amp;\n" },
	{ name: "code and links", source: "# `x` [l](u)\n\n# `x` [l](u)\n" },
	{ name: "level jumps", source: "# A\n\n### Same\n\n## B\n\n### Same\n\n# C\n\n### Same\n" },
	{ name: "in math", source: "# Same\n\n$$\n# Same\n$$\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD024], { config: { default: false, MD024: settings ?? true } });

describe("MD024 no-duplicate-heading", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD024, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// This repository's own markdownlint config sets `siblings_only: true`; `false` is the default spelled out.
	for (const [settings, changes] of [
		[{ siblings_only: true }, true],
		[{ siblings_only: false }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD024, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads a wrong-typed setting as its default", () => {
		for (const settings of [{ siblings_only: "yes" }, { siblings_only: 1 }]) {
			for (const { source } of extra) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

	it("reports the second of two headings with the same text", () => {
		const findings = run("# Intro\n\n## Intro\n");
		assert.deepStrictEqual(
			findings.map((finding) => [finding.lineNumber, Option.getOrNull(finding.context)]),
			[[3, "Intro"]],
		);
	});
});

// markdownlint's MD024 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 41;

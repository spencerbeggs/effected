// MD003 `heading-style`, held to markdownlint's own MD003 over the upstream
// fixture corpus (LF and CRLF) and over inputs its setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD003 } from "../../src/rules/MD003.js";
import { differential } from "../helpers/differential.js";

const extra = [
	{ name: "atx then closed", source: "# One\n\n## Two ##\n" },
	{ name: "closed then atx", source: "# One #\n\n## Two\n" },
	{ name: "setext then atx", source: "One\n===\n\nTwo\n---\n\n### Three\n\n#### Four ####\n" },
	{ name: "atx then setext", source: "# One\n\nTwo\n---\n" },
	{ name: "empty and odd closings", source: "#\n\n## ##\n\n# foo#\n\n# foo \\#\n\n#  #\n" },
	{ name: "headings in containers", source: "> ## Quoted ##\n\n- # In list\n" },
	{ name: "indented headings", source: "  # Indented #  \n\n   ## Three\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD003], { config: { default: false, MD003: settings ?? true } });

describe("MD003 heading-style", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD003, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; `consistent` is the default spelled out.
	for (const [settings, changes] of [
		[{ style: "atx" }, true],
		[{ style: "atx_closed" }, true],
		[{ style: "setext" }, true],
		[{ style: "setext_with_atx" }, true],
		[{ style: "setext_with_atx_closed" }, true],
		[{ style: "consistent" }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD003, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads a wrong-typed setting as its default", () => {
		for (const settings of [{ style: 1 }, { style: ["atx"] }]) {
			for (const { source } of extra) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

	it("reports a heading whose style differs from the first", () => {
		const findings = run("# One\n\n## Two ##\n");
		assert.deepStrictEqual(
			findings.map((finding) => [finding.lineNumber, Option.getOrNull(finding.detail)]),
			[[3, "Expected: atx; Actual: atx_closed"]],
		);
		// markdownlint's rule reports no range and no fix.
		for (const finding of findings) {
			assert.isTrue(Option.isNone(finding.range));
			assert.isTrue(Option.isNone(finding.fixInfo));
			assert.isTrue(Option.isNone(finding.edit));
		}
	});
});

// markdownlint's MD003 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 51;

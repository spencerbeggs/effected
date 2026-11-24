// MD025 `single-title`, held to markdownlint's own MD025 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD025 } from "../../src/rules/MD025.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";

const extra = [
	{ name: "two titles", source: "# One\n\n# Two\n" },
	{ name: "text before the title", source: "Intro\n\n# One\n\n# Two\n" },
	{ name: "comment before the title", source: "<!-- note -->\n\n# One\n\n# Two\n" },
	{ name: "comment ending in a dash before the title", source: "<!-- a --->\n\n# One\n\n# Two\n" },
	{ name: "front matter title", source: "---\ntitle: Doc\n---\n\n# One\n\n# Two\n" },
	{ name: "front matter other key", source: "---\nlayout: post\n---\n\n# One\n\n# Two\n" },
	{ name: "front matter other key, one title", source: "---\nlayout: post\n---\n\n# Only\n" },
	{ name: "level two", source: "## One\n\n## Two\n\n# Top\n" },
	{ name: "docfx tabs", source: "# Title\n\n# [Linux](#tab/linux)\n\n# [Windows](#tab/windows)\n" },
	{ name: "nested, final line break", source: "> # One\n>\n> # Two\n" },
	{ name: "nested, no final line break", source: "> # One\n>\n> # Two" },
	{ name: "setext titles", source: "One\n===\n\nTwo\n===\n" },
	{ name: "in math", source: "# One\n\n$$\n# not\n$$\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const run = runRule(MD025);

describe("MD025 single-title", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD025, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// This repository's own markdownlint config sets `front_matter_title: ""`.
	for (const [settings, changes] of [
		[{ front_matter_title: "" }, true],
		[{ front_matter_title: false }, true],
		[{ front_matter_title: 0 }, true],
		[{ front_matter_title: null }, true],
		[{ front_matter_title: "^\\s*layout\\s*:" }, true],
		[{ level: 2 }, true],
		[{ level: 1 }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD025, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads a wrong-typed or invalid setting as its default", () => {
		for (const settings of [{ level: "2" }, { front_matter_title: 1 }, { front_matter_title: "(" }]) {
			for (const { source } of extra) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

	it("reports every top-level heading after the first", () => {
		const findings = run("# One\n\n# Two\n\n# Three\n");
		assert.deepStrictEqual(
			findings.map((finding) => [finding.lineNumber, Option.getOrNull(finding.context)]),
			[
				[3, "Two"],
				[5, "Three"],
			],
		);
		// markdownlint's rule reports no range and no fix.
		for (const finding of findings) {
			assert.isTrue(Option.isNone(finding.range));
			assert.isTrue(Option.isNone(finding.fixInfo));
			assert.isTrue(Option.isNone(finding.edit));
		}
	});
});

// markdownlint's MD025 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 53;

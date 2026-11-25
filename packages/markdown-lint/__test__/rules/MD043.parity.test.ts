// MD043 `required-headings`, held to markdownlint's own MD043 over the
// upstream fixture corpus (LF and CRLF), whose required-headings fixtures set
// `headings` in their own configuration comments, and over inputs each
// setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Corpus, Depth } from "@effected/testing";
import { Option } from "effect";
import { MD043 } from "../../src/rules/MD043.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { oracleLint } from "../helpers/markdownlint-oracle.js";

const extra = [
	{
		name: "changelog",
		source: "# Changelog\n\n## 1.0.0\n\n### Fixes\n\n### Features\n\n## 2.0.0\n\n### Fixes\n\n### Features\n",
	},
	{ name: "setext and closed", source: "Changelog\n=========\n\n## 1.0.0 ##\n\nFixes\n-----\n" },
	{ name: "case and markup", source: "# HEADING\n\n## *Item* <b>x</b>\n\n### `Detail`\n" },
	{ name: "empty heading", source: "# Heading\n\n##\n\n## Item\n" },
	{ name: "in containers", source: "> # Heading\n\n- ## Item\n" },
	{ name: "in code and math", source: "# Heading\n\n```\n## not\n```\n\n$$\n## not\n$$\n" },
	{ name: "after front matter", source: "---\ntitle: T\n---\n# Heading\n\n## Item\n" },
	{ name: "no headings", source: "Just text\n" },
	{ name: "CRLF", source: "# Heading\r\n\r\n## Item\r\n\r\n### Detail\r\n" },
];

const run = runRule(MD043);

describe("MD043 required-headings", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD043, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs. Not divergences of the port: markdownlint
	// 0.42.2 throws (1) on a file that is all front matter with no final line break whenever it reports the end of
	// file, which it numbers one past its per-line enabled state (the kit reports the last line), and (2) on an empty
	// heading read against a `%` entry, whose level it reads from a failed match (the kit reads no match and reports
	// the heading). Recorded as upstream failures.
	const frontMatterNoCrlf = ["front-matter-no-crlf.md", "front-matter-no-crlf.md (CRLF)"];
	const emptyHeadingPattern = [
		"MD030-warning-message.md",
		"MD030-warning-message.md (CRLF)",
		"headings-without-content.md",
		"headings-without-content.md (CRLF)",
		"empty heading",
	];
	for (const [settings, throws] of [
		[{ headings: ["# Heading", "## Item", "### Detail"] }, frontMatterNoCrlf],
		[{ headings: ["# heading", "## item"], match_case: true }, frontMatterNoCrlf],
		[{ headings: ["# Heading", "*", "## Item"] }, frontMatterNoCrlf],
		[{ headings: ["# Heading", "+"] }, frontMatterNoCrlf],
		[{ headings: ["?", "## Item", "*"] }, frontMatterNoCrlf],
		[{ headings: ["% [a-z]+", "%% \\d+\\.\\d+\\.\\d+", "*"] }, [...frontMatterNoCrlf, ...emptyHeadingPattern]],
		[
			{ headings: ["# Changelog", "^", "%% ^\\d+\\.\\d+\\.\\d+$", "### Fixes", "### Features", "^"] },
			frontMatterNoCrlf,
		],
		[{ headings: ["# Changelog", "^", "%% ^\\d+\\.\\d+\\.\\d+$", "^^", "%%% .+", "^^", "^"] }, frontMatterNoCrlf],
		[{ headings: ["^", "# Heading", "^"] }, frontMatterNoCrlf],
		[{ headings: ["bad syntax", "#NoSpace", ""] }, frontMatterNoCrlf],
		[{ headings: [] }, []],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD043, { config: settings, extra });
				assert.deepStrictEqual(result.divergences.map((divergence) => divergence.fixture).sort(), [...throws].sort());
				for (const divergence of result.divergences) {
					assert.match(
						divergence.reason,
						/^markdownlint throws: Cannot read properties of undefined .*; kit: 1 findings$/,
					);
				}
				Depth.whenFull(() => assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT));
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `headings` only when truthy, each item through its syntax test's string coercion, and
	// `match_case` through `Boolean`.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD043,
				[
					{ headings: null },
					{ headings: 0 },
					{ headings: "" },
					{ headings: false },
					{ headings: [1, null, true] },
					{ headings: ["# heading", "## item"], match_case: 1 },
					{ headings: ["# heading", "## item"], match_case: "" },
					{ headings: ["# heading", "## item"], match_case: "false" },
				],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint compiles a `%` pattern only when the heading's level matches the entry's, so a pattern that does
	// not compile is only ever reached, and thrown on, at a heading of its level.
	it(
		"compares levels before it compiles a pattern, as markdownlint does",
		() => {
			const source = "# Heading\n\n## Item\n";
			const result = settingsDifferential(
				MD043,
				[{ headings: ["# Heading", "%%% ("] }, { headings: ["%% (", "*"] }, { headings: ["*", "%%% (", "## Item"] }],
				[{ name: "pattern of another level", source }],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, 3);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Where markdownlint throws, the kit stays total: `headings` that is truthy but no list, or a `%` pattern that
	// does not compile when it is reached, reads as the default (no required headings); an empty heading read
	// against a `%` pattern, where markdownlint reads its level from a failed match, does not match it.
	it("reads a setting markdownlint throws on as the default", () => {
		const source = "# Heading\n\n## Item\n";
		for (const headings of ["# Heading", 5, true, { 0: "# Heading" }]) {
			assert.deepStrictEqual(run(source, { headings }), [], JSON.stringify(headings));
		}
		assert.deepStrictEqual(run(source, { headings: ["# Heading", "%% ("] }), []);
		// The bad pattern is never reached: the first heading already fails.
		assert.deepStrictEqual(
			run(source, { headings: ["# Other", "%% ("] }).map((each) => each.lineNumber),
			[1],
		);
	});

	// markdownlint tests an item's syntax through `String` but keeps the item, so a list item that reads as a
	// heading (`["# Heading"]`) passes the test and then throws at `startsWith`; the kit reads the item's text.
	it("reads an item that is no string through String, where markdownlint throws", () => {
		const source = "# Heading\n\n## Item\n";
		const settings = { headings: [["# Heading"], "## Item"] };
		assert.throws(() => oracleLint(source, { default: false, MD043: settings }));
		assert.deepStrictEqual(run(source, settings), []);
	});

	it("reads an empty heading as no match for a pattern", () => {
		const findings = run("# Heading\n\n##\n", { headings: ["# Heading", "%% .*"] });
		assert.lengthOf(findings, 1);
		assert.strictEqual(findings[0]?.lineNumber, 3);
		assert.deepStrictEqual(findings[0]?.detail, Option.some("Expected: %% .*; Actual: ## "));
	});

	it("reports the first heading out of place with the expected and actual heading", () => {
		const findings = run("# Heading\n\n## Wrong\n", { headings: ["# Heading", "## Item"] });
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 3);
		assert.deepStrictEqual(finding?.detail, Option.some("Expected: ## Item; Actual: ## Wrong"));
		assert.deepStrictEqual(finding?.range, Option.none());
	});

	it("reports a missing heading at the last line", () => {
		const findings = run("# Heading\n\ntext\n", { headings: ["# Heading", "## Item"] });
		assert.lengthOf(findings, 1);
		assert.strictEqual(findings[0]?.lineNumber, 4);
		assert.deepStrictEqual(findings[0]?.detail, Option.some("Expected: ## Item; Actual: [End of file]"));
	});
});

// markdownlint's MD043 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 46;

// MD025 `single-title`, held to markdownlint's own MD025 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD025 } from "../../src/rules/MD025.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";

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

const run = runRule(MD025);

// A front matter title after one leading byte order mark, and after three.
const bomExtra = [
	{ name: "byte order mark before a front matter title", source: "\uFEFF---\ntitle: x\n---\nText\n\n# H\n\n# H2\n" },
	{
		name: "three byte order marks before a front matter title",
		source: "\uFEFF\uFEFF\uFEFF---\ntitle: x\n---\nText\n\n# H\n\n# H2\n",
	},
];

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

	it(
		"diverges from markdownlint where micromark drops a further leading byte order mark",
		() => {
			// After one mark the block is front matter and its title counts in both. After three, markdownlint reads no
			// front matter, and micromark drops one more mark than its text view: every token text runs one character
			// behind, so the block's setext heading reads as level 1, the document's title, and both later h1s are
			// reported. The kit reads that heading as level 2 and reports neither.
			const result = differential(MD025, { extra: [...extra, ...bomExtra] });
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				["three byte order marks before a front matter title"],
			);
			assert.match(
				result.divergences[0]?.reason ?? "",
				/^missing finding 1: markdownlint \{"lineNumber":6,"ruleNames":\["MD025"/,
			);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT + ORACLE_FINDINGS_BOM);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint coerces its settings (`Number(x ?? d)`, `!!x`, `String(x || d)`), so a non-canonical value
	// means to the kit what it means there.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD025,
				[
					{ level: "2" },
					{ level: null },
					{ level: "x" },
					{ level: [2] },
					{ front_matter_title: 5 },
					{ front_matter_title: 0 },
					{ front_matter_title: null },
				],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Where markdownlint's own reading of a setting throws (a `front_matter_title` that is not a valid regular expression), the kit stays total: it reads the setting
	// as its default pattern and reports what that gives. Recorded as "the kit reads a setting markdownlint throws on".
	it(
		"reads a setting markdownlint throws on as its default pattern",
		() => {
			const result = settingsDifferential(
				MD025,
				[{ front_matter_title: "(" }, { front_matter_title: "[" }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.strictEqual(result.divergences.length, INVALID_TITLE_PATTERN_DIVERGENCES);
			for (const divergence of result.divergences)
				assert.match(divergence.reason, /^markdownlint throws: Invalid regular expression.*; kit: \d+ findings$/);
		},
		DIFFERENTIAL_TIMEOUT,
	);

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

// markdownlint's MD025 findings over the byte order mark inputs: both later h1s after one mark, and after three.
const ORACLE_FINDINGS_BOM = 4;

// The inputs on which markdownlint throws on an invalid `front_matter_title` (see the test above).
const INVALID_TITLE_PATTERN_DIVERGENCES = 32;

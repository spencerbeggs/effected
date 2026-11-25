// MD001 `heading-increment`, held to markdownlint's own MD001 over the
// upstream fixture corpus (LF and CRLF) and over inputs its setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Corpus, Depth } from "@effected/testing";
import { Option } from "effect";
import { MD001 } from "../../src/rules/MD001.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";

const extra = [
	{ name: "math in a blockquote, unclosed", source: "> $$\n> x\n\n# A\n\n### C\n" },
	{ name: "math fence indented four in a paragraph", source: "text\n    $$\n# A\n\n### C\n" },
	{ name: "math closing fence indented four", source: "$$\n    $$\n# A\n\n### C\n" },
	{ name: "math in a list item", source: "- $$\n  # A\n  ### C\n  $$\n" },
	{ name: "math fence in fenced code", source: "```\n$$\n```\n# A\n\n### C\n" },
	{ name: "math fence in an HTML block", source: "<div>\n$$\n</div>\n\n# A\n\n### C\n" },
	{ name: "math ended by a lazy line", source: "> $$\nlazy\n# A\n\n### C\n" },
	{ name: "math interrupting a paragraph", source: "text\n$$\n# A\n\n### C\n$$\n" },
	{ name: "math unclosed in a list item", source: "- item\n\n  $$\n  # A\n  ### C\n\n- next\n\n### D\n" },
	{ name: "skips a level", source: "# One\n\n### Three\n\n#### Four\n" },
	{ name: "steps back down", source: "# One\n\n## Two\n\n# One\n\n### Three\n" },
	{ name: "setext then atx", source: "One\n===\n\nTwo\n---\n\n#### Four\n" },
	{ name: "starts deep", source: "### Three\n\n##### Five\n" },
	{ name: "front matter title", source: "---\ntitle: Doc\n---\n\n## Two\n\n#### Four\n" },
	{ name: "front matter title, quoted", source: '---\n"title": Doc\n---\n\n### Three\n' },
	{ name: "front matter other key", source: "---\nlayout: post\n---\n\n## Two\n\n#### Four\n" },
	{ name: "toml front matter title", source: "+++\ntitle = 'Doc'\n+++\n\n### Three\n" },
	{ name: "headings in containers", source: "> # One\n>\n> ### Three\n\n- ## Two\n" },
];

const run = runRule(MD001);

describe("MD001 heading-increment", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD001, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs, so its run is not the default run again.
	for (const [settings, changes] of [
		[{ front_matter_title: "" }, true],
		[{ front_matter_title: false }, true],
		[{ front_matter_title: 0 }, true],
		[{ front_matter_title: null }, true],
		[{ front_matter_title: "^\\s*layout\\s*:" }, true],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD001, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) Depth.whenFull(() => assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT));
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
				MD001,
				[
					{ front_matter_title: 5 },
					{ front_matter_title: true },
					{ front_matter_title: 0 },
					{ front_matter_title: null },
					{ front_matter_title: ["title"] },
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
				MD001,
				[{ front_matter_title: "(" }, { front_matter_title: "[" }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.strictEqual(result.divergences.length, INVALID_TITLE_PATTERN_DIVERGENCES);
			for (const divergence of result.divergences)
				assert.match(divergence.reason, /^markdownlint throws: Invalid regular expression.*; kit: \d+ findings$/);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a heading two levels below the last", () => {
		const findings = run("# One\n\n### Three\n");
		assert.deepStrictEqual(
			findings.map((finding) => [finding.lineNumber, Option.getOrNull(finding.detail)]),
			[[3, "Expected: h2; Actual: h3"]],
		);
		// markdownlint's rule reports no range and no fix.
		for (const finding of findings) {
			assert.isTrue(Option.isNone(finding.range));
			assert.isTrue(Option.isNone(finding.fixInfo));
			assert.isTrue(Option.isNone(finding.edit));
		}
	});
});

// markdownlint's MD001 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 34;

// The inputs on which markdownlint throws on an invalid `front_matter_title` (see the test above).
const INVALID_TITLE_PATTERN_DIVERGENCES = 42;

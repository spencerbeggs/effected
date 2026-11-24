// MD012 `no-multiple-blanks`, held to markdownlint's own MD012 over the
// upstream fixture corpus (LF and CRLF) and over inputs its setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD012 } from "../../src/rules/MD012.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsAppliedTextDivergences,
	settingsDifferential,
} from "../helpers/differential.js";

const extra = [
	{ name: "two blanks", source: "a\n\n\nb\n" },
	{ name: "three blanks", source: "a\n\n\n\nb\n" },
	{ name: "whitespace-only blanks", source: "a\n  \n\t\n\nb\n" },
	{ name: "blanks at the end", source: "a\n\n\n" },
	{ name: "blanks at the end, CRLF", source: "a\r\n\r\n\r\n\r\n" },
	{ name: "blank last line with spaces", source: "a\n\n  " },
	{ name: "empty document", source: "" },
	{ name: "two blank lines only", source: "\n\n" },
	{ name: "three blank lines only", source: "\n\n\n" },
	{ name: "blanks at the start", source: "\n\n\na\n" },
	{ name: "blanks in fenced code", source: "```\nx\n\n\n\ny\n```\n" },
	{ name: "blanks after an unclosed fence", source: "```\nx\n\n\n" },
	{ name: "blanks in indented code", source: "para\n\n    x\n\n\n\n    y\n\n\nafter\n" },
	{ name: "blanks in a blockquote", source: "> a\n>\n>\n> b\n" },
	{ name: "blanks in a list", source: "- a\n\n\n- b\n" },
	{ name: "front matter blanks", source: "---\na: 1\n\n\n\nb: 2\n---\ntext\n" },
	{ name: "CRLF blanks", source: "a\r\n\r\n\r\nb\r\n" },
];

const run = runRule(MD012);

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

	// Under a negative maximum markdownlint reports, and deletes, every line, blank or not. That is the all-blank
	// case of `{ maximum: 0 }` again: n lines hold n - 1 line breaks, so the last line's delete cannot be its own
	// whole-line `fixInfo`, and only that one finding differs. The text the fixes leave is markdownlint's.
	it(
		"differs from markdownlint under a negative maximum only in the last line's delete",
		() => {
			const inputs = [...extra, ...SETTINGS_PROBES];
			const result = settingsDifferential(MD012, [{ maximum: -1 }], inputs);
			assert.strictEqual(result.divergences.length, NEGATIVE_MAXIMUM_DIVERGENCES);
			for (const divergence of result.divergences) {
				const input = inputs.find((each) => each.name === divergence.fixture);
				const lastLine = (input?.source ?? "").split(/\r\n|\r|\n/).length;
				assert.match(divergence.reason, new RegExp(`^finding ${lastLine} \\(line ${lastLine}\\) fixInfo: kit `));
				assert.match(
					divergence.reason,
					/markdownlint \{"lineNumber":\d+,"editColumn":1,"deleteCount":-1,"insertText":""\}$/,
				);
			}
			assert.deepStrictEqual(settingsAppliedTextDivergences(MD012, [{ maximum: -1 }], inputs), []);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it(
		"agrees with markdownlint under { maximum: 0 } wherever markdownlint does not throw",
		() => {
			const result = differential(MD012, { config: { maximum: 0 }, extra });
			// Not a divergence of the port: markdownlint 0.42.2 throws on a file that is all front matter with no final
			// line break. Its content is one empty line, numbered one past its per-line enabled state, and MD012 with
			// `maximum: 0` is the one rule here that reports that line. The kit reads no content line and reports nothing.
			const throws = ["front-matter-no-crlf.md", "front-matter-no-crlf.md (CRLF)"];
			// A document of nothing but blank lines: markdownlint deletes every one (`deleteCount: -1` each). n lines
			// hold n - 1 line breaks, so n disjoint kit edits cannot each delete one; the last line's delete is an empty
			// edit, which can carry no `fixInfo` (an empty edit changes nothing, where markdownlint's delete of that line
			// alone would remove a line break). The kit edits still apply to markdownlint's text.
			const allBlank = ["two blank lines only", "three blank lines only"];
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				[...throws, ...allBlank],
			);
			for (const divergence of result.divergences.filter((each) => throws.includes(each.fixture))) {
				assert.match(divergence.reason, /^markdownlint throws: .*; kit: 0 findings$/);
			}
			const lastLine = { "two blank lines only": 3, "three blank lines only": 4 } as Record<string, number>;
			for (const divergence of result.divergences.filter((each) => allBlank.includes(each.fixture))) {
				const line = lastLine[divergence.fixture];
				assert.match(
					divergence.reason,
					new RegExp(`^finding ${line} \\(line ${line}\\) fixInfo: kit null, markdownlint .*"deleteCount":-1`),
				);
			}
			assert.isAbove(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint coerces its settings (`Number(x ?? d)`, `!!x`, `String(x || d)`), so a non-canonical value
	// means to the kit what it means there.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD012,
				[{ maximum: "2" }, { maximum: true }, { maximum: null }, { maximum: "x" }, { maximum: [2] }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

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
const ORACLE_FINDINGS_DEFAULT = 65;

// The inputs on which a negative maximum's last delete differs (see the test above).
const NEGATIVE_MAXIMUM_DIVERGENCES = 16;

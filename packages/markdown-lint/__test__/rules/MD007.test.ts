// MD007 `ul-indent`, held to markdownlint's own MD007 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes. An
// unordered list's nesting counts the unordered lists around it, up to a
// blockquote; one inside an ordered list is not checked.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD007 } from "../../src/rules/MD007.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsAppliedTextDivergences,
	settingsDifferential,
} from "../helpers/differential.js";
import { oracleLint } from "../helpers/markdownlint-oracle.js";

const extra = [
	{ name: "two-space nesting", source: "* a\n  * b\n    * c\n" },
	{ name: "four-space nesting", source: "* a\n    * b\n        * c\n" },
	{ name: "three-space nesting", source: "- a\n   - b\n      - c\n" },
	{ name: "indented top level", source: " - a\n - b\n   - c\n" },
	{ name: "under an ordered list", source: "1. a\n   - b\n     - c\n" },
	{ name: "unordered under ordered under unordered", source: "- a\n  1. b\n     - c\n" },
	{ name: "blockquote", source: "> - a\n>   - b\n>    - c\n> - d\n" },
	{ name: "nested blockquotes", source: "> > - a\n> >    - b\n" },
	{ name: "blockquote in a list", source: "- a\n\n  > - b\n  >   - c\n  >  - d\n" },
	{ name: "list in a blockquote in a list item", source: "- a\n  > - b\n  >    - c\n" },
	{ name: "footnote", source: "[^1]: note\n\n    - a\n      - b\n     - c\n\nText[^1]\n" },
	{ name: "tabs", source: "-\ta\n\t- b\n  -\tc\n" },
	{ name: "loose and lazy", source: "- a\n\n   - b\nlazy\n\n- c\n" },
	{ name: "list in math", source: "$$\n- a\n   - b\n$$\n" },
	{ name: "list in code and html", source: "```\n- a\n   - b\n```\n\n<div>\n- a\n   - b\n</div>\n" },
	{ name: "front matter", source: "---\ntitle: x\n---\n- a\n   - b\n" },
	{ name: "CRLF", source: "- a\r\n   - b\r\n - c\r\n" },
];

const run = runRule(MD007);

describe("MD007 ul-indent", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD007, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the defaults spelled out change nothing.
	for (const [settings, changes] of [
		[{ indent: 4 }, true],
		[{ indent: 3 }, true],
		[{ start_indented: true }, true],
		[{ start_indented: true, start_indent: 1 }, true],
		[{ start_indented: true, indent: 4, start_indent: 2 }, true],
		[{ start_indent: 4 }, false],
		[{ indent: 2, start_indented: false }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD007, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `Number(indent ?? 2)`, `!!start_indented` and `Number(start_indent ?? indent)`.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD007,
				[
					{ indent: "4" },
					{ indent: null },
					{ indent: 0 },
					{ start_indented: "yes", start_indent: "3" },
					{ start_indented: 1 },
					{ start_indented: 0, start_indent: 5 },
				],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Not a divergence of the port: under a negative `indent`, markdownlint's fix deletes past the end of a nested
	// item's line, and markdownlint throws on its own `fixInfo`. The kit's deletion stops at the line's end.
	it(
		"reads a negative indent where markdownlint throws on its own fix",
		() => {
			const result = settingsDifferential(MD007, [{ indent: -2 }], [...extra, ...SETTINGS_PROBES]);
			assert.isAbove(result.divergences.length, 0);
			for (const divergence of result.divergences) {
				assert.match(
					divergence.reason,
					/^markdownlint throws: Value of 'fixInfo.deleteCount' passed to onError by 'MD007' is incorrect for 'input'\.; kit: \d+ findings$/,
				);
			}
			assert.strictEqual(result.divergences.length, NEGATIVE_INDENT_THROWS);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Recorded divergence "a fractional or NaN MD007 indent fixes whole columns": markdownlint's fix counts are the raw
	// arithmetic (`deleteCount: 1.5`, `padEnd(0.5)`, `NaN`), which its own `applyFixes` truncates. A kit edit is whole
	// characters, so its `fixInfo` carries the truncated count, and where that leaves nothing to do the kit carries no
	// `fixInfo`, as an empty edit never does. The text the fixes leave is markdownlint's in every case.
	it(
		"fixes a fractional or NaN indent in whole columns, leaving markdownlint's text",
		() => {
			const cases = [{ indent: 1.5 }, { indent: "x" }, { start_indented: true, start_indent: 2.5 }];
			const inputs = [...extra, ...SETTINGS_PROBES];
			const result = settingsDifferential(MD007, cases, inputs);
			assert.strictEqual(result.divergences.length, FIXINFO_ONLY_DIVERGENCES);
			for (const divergence of result.divergences) {
				assert.match(
					divergence.reason,
					/^finding \d+ \(line \d+\) fixInfo: kit (null|\{[^}]*"deleteCount":\d+[^}]*\}), markdownlint \{/,
				);
			}
			assert.deepStrictEqual(settingsAppliedTextDivergences(MD007, cases, inputs), []);
			// The divergence reason names only a finding's first differing field: compare every finding but its fix, so
			// "fixInfo only" holds for each finding, not just the first that differs.
			for (const settings of cases) {
				const config = { default: false, MD007: settings };
				for (const input of inputs) {
					const oracle = oracleLint(input.source, config)
						.filter((finding) => finding.ruleNames[0] === "MD007")
						.map((finding) => [
							finding.lineNumber,
							finding.errorDetail,
							finding.errorContext,
							finding.errorRange === null ? null : [...finding.errorRange],
						]);
					// markdownlint sorts by line, stably, as the harness does.
					const kit = [...MarkdownLint.lint(input.source, [MD007], { config })]
						.sort((a, b) => a.lineNumber - b.lineNumber)
						.map((finding) => [
							finding.lineNumber,
							Option.getOrNull(finding.detail),
							Option.getOrNull(finding.context),
							Option.match(finding.range, { onNone: () => null, onSome: (range) => [...range] }),
						]);
					assert.deepStrictEqual(kit, oracle, `${JSON.stringify(settings)} ${input.name}`);
				}
			}
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a sublist off its indent, with a fix that re-indents it", () => {
		const source = "- a\n   - b\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 2);
		assert.deepStrictEqual(finding?.detail, Option.some("Expected: 2; Actual: 3"));
		assert.deepStrictEqual(finding?.range, Option.some([1, 5] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"- a\n  - b\n",
		);
	});
});

// markdownlint's MD007 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 284;
// The inputs on which only a fix's counts differ under a fractional or NaN setting (see the test above).
const FIXINFO_ONLY_DIVERGENCES = 31;
// The inputs on which markdownlint throws under `indent: -2` (see the test above).
const NEGATIVE_INDENT_THROWS = 3;

// MD022 `blanks-around-headings`, held to markdownlint's own MD022 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Corpus, Depth } from "@effected/testing";
import { Option } from "effect";
import { MD022 } from "../../src/rules/MD022.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsAppliedTextDivergences,
	settingsDifferential,
} from "../helpers/differential.js";
import { directiveBlockGrid, directiveListEnds } from "../helpers/table-grid.js";

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

const run = runRule(MD022);

// A leading byte order mark, once and twice, before front matter and a heading.
const bomExtra = [
	{ name: "byte order mark before front matter", source: "\uFEFF---\ntitle: x\n---\nText\n\n# H\n\n# H2\n" },
	{ name: "two byte order marks before front matter", source: "\uFEFF\uFEFF---\ntitle: x\n---\nText\n\n# H\n\n# H2\n" },
];

describe("MD022 blanks-around-headings", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD022, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
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
				if (changes) Depth.whenFull(() => assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT));
				else Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it(
		"diverges from markdownlint where micromark drops a second leading byte order mark",
		() => {
			// markdownlint reads front matter after one mark, and micromark then drops a second before it parses:
			// after two marks the `---` is a thematic break and `title: x` a setext heading on line 2. The kit reads
			// the second mark as text, so its setext heading starts on line 1. One mark agrees.
			const result = differential(MD022, { extra: [...extra, ...bomExtra] });
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				["two byte order marks before front matter"],
			);
			assert.strictEqual(result.divergences[0]?.reason, "finding 1 (line 2) lineNumber: kit 1, markdownlint 2");
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT + ORACLE_FINDINGS_BOM);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint coerces its settings (`Number(x ?? d)`, `!!x`, `String(x || d)`), so a non-canonical value
	// means to the kit what it means there.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD022,
				[
					{ lines_above: "2" },
					{ lines_above: null },
					{ lines_above: "x" },
					{ lines_above: -1 },
					{ lines_below: "0" },
					{ lines_below: null },
					{ include_front_matter: 1 },
					{ include_front_matter: "yes" },
				],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Past the document's edge every line reads as blank; the kit stops its walk there (see `blankRun`) and must still
	// count what markdownlint's loop counts, including a fractional count's last step.
	it(
		"counts the lines past the document's edge as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD022,
				[
					{ lines_above: 50 },
					{ lines_below: 40 },
					{ lines_above: 500, lines_below: 500 },
					{ lines_above: 3, include_front_matter: true },
					{ lines_above: [7, 9, 2] },
				],
				[...extra, ...SETTINGS_PROBES, { name: "heading at the top", source: "# T\n" }],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint compares a per-level item as written (`"2" !== 2`) and a fractional count as a number, so a heading
	// with the expected blank lines can still be reported, with a fix inserting `"2" - 2 = 0` lines:
	// `{ insertText: "" }`. The kit reports the same finding, but an empty edit maps to no `fixInfo` (it changes
	// nothing), so the one difference is that `fixInfo`; the text the fixes leave is markdownlint's. Recorded as
	// "an empty insert carries no fixInfo" in the module concept.
	it(
		"differs from markdownlint only in the fixInfo of an empty insert under a per-level item as written",
		() => {
			const cases = [
				{ lines_above: ["2"] },
				{ lines_above: [null] },
				{ lines_above: [true] },
				{ lines_above: 2.5 },
				{ lines_below: [1, "2"] },
			];
			const inputs = [...extra, ...SETTINGS_PROBES];
			const result = settingsDifferential(MD022, cases, inputs);
			assert.strictEqual(result.divergences.length, EMPTY_INSERT_DIVERGENCES);
			for (const divergence of result.divergences)
				assert.match(divergence.reason, /fixInfo: kit null, markdownlint \{[^}]*"deleteCount":0,"insertText":""\}$/);
			assert.deepStrictEqual(settingsAppliedTextDivergences(MD022, cases, inputs), []);
		},
		DIFFERENTIAL_TIMEOUT,
	);

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

	// markdownlint's directive extension ends a paragraph (and a lazy list item, and a table) before a directive line,
	// and reads an indented line after one as code: beside each block kind, in each container.
	it(
		"agrees with markdownlint beside directive lines",
		() => {
			const result = differential(MD022, { extra: [...directiveBlockGrid, ...directiveListEnds] });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DIRECTIVE_BLOCKS);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// A blank's prefix is the line's blockquote markers as micromark's tokens give them: not a list item's own
	// indentation, and nothing on an HTML block's later lines, whose prefixes micromark nests inside the block.
	it(
		"agrees with markdownlint on the prefix a blank takes beside a quoted block",
		() => {
			const prefixes = [
				{ name: "after a quoted HTML block", source: "> <div>\n> block\n> </div>\n# H\n" },
				{ name: "after an unclosed quoted HTML block", source: "> <div>\n> block\n# H\n" },
				{ name: "after an HTML block in a nested quote", source: "> > <div>\n> > b\n# H\n" },
				{ name: "after a quote in a list item", source: "- > - q\n  > - r\n# H\n" },
				{ name: "after a quote in a list item, paragraph", source: "- > q\n  > r\n# H\n" },
				{ name: "after a list in a quote", source: "> - q\n# H\n" },
				{ name: "before a quoted HTML block", source: "# H\n> <div>\n> b\n" },
			];
			const result = differential(MD022, { extra: prefixes });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_PREFIXES);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD022 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 145;

// markdownlint's MD022 findings over the byte order mark inputs: the setext heading after two marks, above and below.
const ORACLE_FINDINGS_BOM = 2;

// The settings cases and inputs on which markdownlint's fix is an empty insert (see the test above).
const EMPTY_INSERT_DIVERGENCES = 41;

// markdownlint's MD022 findings over the corpus (LF and CRLF) and the blocks beside directive lines.
const ORACLE_FINDINGS_DIRECTIVE_BLOCKS = 149;

// markdownlint's MD022 findings over the corpus (LF and CRLF) and the blanks beside quoted blocks.
const ORACLE_FINDINGS_PREFIXES = 129;

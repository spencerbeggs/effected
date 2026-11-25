// MD030 `list-marker-space`, held to markdownlint's own MD030 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting
// changes. The spaces after a marker are micromark's
// `listItemPrefixWhitespace`; a list is single-line when it spans as many
// lines as it has items.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD030 } from "../../src/rules/MD030.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { wrappedLinkEnds } from "../helpers/link-grid.js";
import { listEndGrid } from "../helpers/list-container-grid.js";

const extra = [
	{ name: "single-line lists", source: "-  a\n- b\n\ntext\n\n1.  a\n2. b\n" },
	{ name: "multi-line lists", source: "-  a\n\n   more\n- b\n\ntext\n\n1.   a\n\n     more\n2. b\n" },
	{ name: "wrapped item", source: "- a\n  b\n-  c\n" },
	{ name: "tabs", source: "-\ta\n- \tb\n1.\tc\n" },
	{ name: "five spaces (code)", source: "-     code\n- b\n" },
	{ name: "empty items", source: "-\n- \n1.\n" },
	{ name: "nested", source: "- a\n  -  b\n  -   c\n- d\n" },
	{ name: "blockquote", source: ">  -  a\n> -   b\n" },
	{ name: "wide numbers", source: "9.  a\n10. b\n" },
	{ name: "list in math", source: "$$\n-  a\n$$\n" },
	{ name: "list in code", source: "```\n-  a\n```\n" },
	{ name: "front matter", source: "---\ntitle: x\n---\n-  a\n" },
	{ name: "CRLF", source: "-  a\r\n1.  b\r\n" },
	// micromark ends a list in a blockquote or footnote on the next container's line, or past quoted blank lines.
	{ name: "quoted list, then a quoted blank", source: "> - a\n>\n> text\n" },
	{ name: "quoted list, then a nested quote", source: "> - a\n>\n> > b\n" },
	{ name: "quoted lists of two markers", source: "> - a\n>   + b\n>   - c\n" },
	{ name: "footnote lists", source: "[^1]: x\n\n    - a\n      - b\n\n    1. c\n\nText[^1]\n" },
	{ name: "empty last item", source: "- a\n-\n\ntext\n" },
	// The next container may follow an outer blockquote or footnote, and a footnote definition is one.
	{ name: "nested quote, then an outer list", source: "> > - a\n> > - b\n> - c\n" },
	{ name: "deeply nested quote, then an outer list", source: "> > > - a\n> > > - b\n> - c\n" },
	{ name: "footnote in a quote, then a list", source: "> [^1]: x\n>     - a\n>     - b\n> - c\n" },
	{ name: "quoted list, then a footnote", source: "> - a\n> - b\n> [^1]: n\n" },
	// But not to a container outside every open quote or footnote, or past an unquoted blank line.
	{ name: "quoted list, blank, then a new quote", source: "> - a\n> - b\n\n> - c\n" },
	{ name: "nested quoted list, blank, then a new quote", source: "> > - a\n> > - b\n\n> - c\n" },
	{ name: "footnote list, blank, then a footnote", source: "[^1]: x\n    - a\n    - b\n\n[^2]: y\n" },
	{ name: "footnote list, then a footnote", source: "[^1]: x\n    - a\n    - b\n[^2]: y\n" },
];

const run = runRule(MD030);

describe("MD030 list-marker-space", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD030, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the defaults spelled out change nothing.
	// Recorded divergence "a list opening `01.` interrupts a paragraph" (see MD029): a setting that tells ordered
	// lists apart from the default reports that list's items, which markdownlint reads as paragraph text.
	const interrupting = ["list-item-prefix-alignment.md", "list-item-prefix-alignment.md (CRLF)"];
	for (const [settings, changes, divergent] of [
		[{ ul_single: 2 }, true, []],
		[{ ol_single: 2 }, true, interrupting],
		[{ ul_multi: 3 }, true, []],
		[{ ol_multi: 3 }, true, []],
		[{ ul_single: 3, ol_single: 2, ul_multi: 3, ol_multi: 2 }, true, interrupting],
		[{ ul_single: 1, ol_single: 1, ul_multi: 1, ol_multi: 1 }, false, []],
		[{ ul_single: 2, ul_multi: 3 }, true, []],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD030, { config: settings, extra });
				assert.deepStrictEqual(
					result.divergences.map((divergence) => divergence.fixture),
					[...divergent],
				);
				for (const divergence of result.divergences)
					assert.match(divergence.reason, /lineNumber: kit 43, markdownlint 5[57]$/);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// Where micromark's list token ends, pinned as a whole grid of container stacks, separators and following blocks
	// (see `listEndGrid`), under the default and under single and multi counts that tell the two apart.
	// Recorded divergence "a quoted blank line closes a footnote in a blockquote" (okf, @effected/markdown): the kit's
	// footnote ends at the quoted blank line, so the list after it is a new list there and the same list here.
	it(
		"agrees with markdownlint over the list-end grid",
		() => {
			const result = settingsDifferential(MD030, [{}, { ul_single: 2, ul_multi: 3 }], listEndGrid);
			assert.deepStrictEqual(
				result.divergences.map((divergence) => `${divergence.settings} ${divergence.fixture}`),
				['{"ul_single":2,"ul_multi":3} qf/quoted1/list@2'],
			);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_GRID);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint reads each count as `Number(x ?? 1)`; `padEnd` truncates a fraction and reads `NaN` as zero.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD030,
				[
					{ ul_single: "2" },
					{ ol_single: null },
					{ ul_multi: 0 },
					{ ol_multi: 1.5 },
					{ ul_single: "x" },
					{ ol_single: -1 },
					{ ul_single: true },
				],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports the spaces after a marker, with the prefix as the range and a fix that respaces it", () => {
		const source = "-   a\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.detail, Option.some("Expected: 1; Actual: 3"));
		assert.deepStrictEqual(finding?.range, Option.some([1, 4] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"- a\n",
		);
	});

	// A list ending in a link whose destination or title wraps: the list ends on the wrapped line.
	it(
		"agrees with markdownlint on a list ending in a wrapped link",
		() => {
			const result = differential(MD030, { extra: wrappedLinkEnds });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_WRAPPED);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD030 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 62;
// markdownlint's MD030 findings over the list-end grid, under both settings cases.
const ORACLE_FINDINGS_GRID = 1077;

// markdownlint's MD030 findings over the corpus (LF and CRLF) and the lists ending in a wrapped link.
const ORACLE_FINDINGS_WRAPPED = 48;

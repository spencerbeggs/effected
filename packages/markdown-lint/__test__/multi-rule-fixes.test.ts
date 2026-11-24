// The fixes of several rules applied together, held to markdownlint's own
// applyFixes over the upstream fixture corpus (as written, CRLF and bare CR):
// all the ported rules at once, and pairs whose fixes meet on one line.

import { assert, describe, it } from "@effect/vitest";
import type { LintDiagnostic } from "../src/LintDiagnostic.js";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { rules } from "../src/rules/all.js";
import { MD004 } from "../src/rules/MD004.js";
import { MD032 } from "../src/rules/MD032.js";
import { DIFFERENTIAL_TIMEOUT, corpus, fixesDifferential } from "./helpers/differential.js";
import { oracleApplyFixes, oracleLint } from "./helpers/markdownlint-oracle.js";

const byName = (...names: ReadonlyArray<string>) => rules.filter((rule) => names.includes(rule.name));

// A marker change and a blank-line insert at one column, under each line ending.
const extra = [
	{ name: "marker and blank line, LF", source: "- a\n+ b\n" },
	{ name: "marker and blank line, CRLF", source: "- a\r\n+ b\r\n" },
	{ name: "marker and blank line, CR", source: "- a\r+ b\r" },
	{ name: "marker and blank line, mixed", source: "- a\r\n+ b\n* c\r" },
	{ name: "heading, trailing space and blank line, CRLF", source: "# H  \r\ntext  \r\n## I\r\n" },
	{ name: "fence and list, CRLF", source: "- a\r\n```\r\nx\r\n```\r\n+ b\r\n" },
	{ name: "blanks and final newline, CRLF", source: "a\r\n\r\n\r\n\r\nb" },
	{ name: "tab and trailing space, CRLF", source: "a\t \r\n\tb  \r\n" },
];

// A Fisher-Yates shuffle under a PRNG seeded by `seed`'s text (FNV-1a into mulberry32), so a failure reproduces.
const shuffled = <A>(items: ReadonlyArray<A>, seed: string): ReadonlyArray<A> => {
	let state = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193);
	const next = () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[out[i], out[j]] = [out[j] as A, out[i] as A];
	}
	return out;
};

// markdownlint's findings with a fix over every input, per case.
const ORACLE_FIXES_ALL = 5862;
const ORACLE_FIXES_MD004_MD032 = 396;
const ORACLE_FIXES_MD022_MD009 = 452;
const ORACLE_FIXES_MD031_MD032 = 368;
const ORACLE_FIXES_MD012_MD047 = 90;
const ORACLE_FIXES_MD009_MD010 = 542;
const ORACLE_FIXES_MD020_MD009 = 333;
const ORACLE_FIXES_MD021_MD009 = 359;
const ORACLE_FIXES_MD005_MD009 = 309;
const ORACLE_FIXES_MD007_MD004 = 655;
const ORACLE_FIXES_MD027_MD009 = 454;
const ORACLE_FIXES_MD029_MD005 = 437;
const ORACLE_FIXES_MD030_MD004 = 324;
const ORACLE_FIXES_MD030_MD007 = 479;
const ORACLE_FIXES_MD030_MD005 = 116;
const ORACLE_FIXES_MD014_MD010 = 334;
const ORACLE_FIXES_MD038_MD009 = 615;
const ORACLE_FIXES_MD037_MD009 = 850;
const ORACLE_FIXES_MD049_MD037 = 773;
const ORACLE_FIXES_MD050_MD049 = 340;
const ORACLE_FIXES_MD044_MD049 = 494;
// The inputs on which fixes from two or more of the case's rules land on one line, the case the file exists for.
const MEETING_ALL = 47;
const MEETING_MD004_MD032 = 17;
const MEETING_MD022_MD009 = 3;
const MEETING_MD031_MD032 = 13;
// MD012 fixes a blank run and MD047 the last line's end: they never fix one line together in the corpus or the extras.
const MEETING_MD012_MD047 = 0;
const MEETING_MD009_MD010 = 3;
const MEETING_MD020_MD009 = 2;
const MEETING_MD021_MD009 = 2;
const MEETING_MD005_MD009 = 2;
const MEETING_MD007_MD004 = 14;
const MEETING_MD027_MD009 = 2;
const MEETING_MD029_MD005 = 2;
const MEETING_MD030_MD004 = 8;
const MEETING_MD030_MD007 = 5;
const MEETING_MD030_MD005 = 2;
const MEETING_MD014_MD010 = 2;
const MEETING_MD038_MD009 = 2;
const MEETING_MD037_MD009 = 2;
const MEETING_MD049_MD037 = 2;
const MEETING_MD050_MD049 = 5;
const MEETING_MD044_MD049 = 2;
const MEETING_SAMPLE = 11;

describe("applyFixes over several rules' fixes", () => {
	// Recorded divergence "findings come in rule order": lint returns the rules' findings in the order of the rules it
	// was given, each in the order it reported them, where markdownlint sorts by rule name, then line. applyFixes
	// sorts for itself, so the fixed text does not depend on it.
	it("returns findings in rule order, where markdownlint sorts them by rule name, then line", () => {
		const key = (finding: { readonly ruleNames: ReadonlyArray<string>; readonly lineNumber: number }) =>
			`${finding.ruleNames[0]}:${finding.lineNumber}`;
		const config = { default: false, MD004: true, MD032: true };
		const source = "- a\n+ b\n";
		assert.deepStrictEqual(MarkdownLint.lint(source, [MD032, MD004], { config }).map(key), [
			"MD032:1",
			"MD032:2",
			"MD004:2",
		]);
		assert.deepStrictEqual(oracleLint(source, config).map(key), ["MD004:2", "MD032:1", "MD032:2"]);
		// With the rules in name order the two agree, except where one rule reports lines out of order: MD004 walks
		// a nested list in a blockquote and reports lines 68 and 69 before 65.
		const fixture = corpus.find((entry) => entry.name === "lists-in-blockquote.md");
		assert.isDefined(fixture);
		const md004 = { default: false, MD004: true };
		const kit = MarkdownLint.lint(fixture?.source ?? "", [MD004], { config: md004 }).map(key);
		const oracle = oracleLint(fixture?.source ?? "", md004).map(key);
		assert.notDeepEqual(kit, oracle);
		assert.deepStrictEqual([...kit].sort(), [...oracle].sort());
		assert.deepStrictEqual(kit.slice(2, 6), ["MD004:64", "MD004:68", "MD004:69", "MD004:65"]);
	});

	it("applies MD004 and MD032 meeting on a line as markdownlint does, whatever order the rules run in", () => {
		const config = { default: false, MD004: true, MD032: true };
		for (const [source, expected] of [
			["- a\n+ b\n", "- a\n- b\n"],
			["- a\r\n+ b\r\n", "- a\r\n- b\r\n"],
		] as const) {
			assert.strictEqual(oracleApplyFixes(source, oracleLint(source, config)), expected, "markdownlint");
			for (const order of [
				[MD004, MD032],
				[MD032, MD004],
			]) {
				const findings = MarkdownLint.lint(source, order, { config });
				assert.strictEqual(MarkdownLint.applyFixes(source, findings), expected, order.map((rule) => rule.name).join());
				assert.strictEqual(MarkdownLint.applyFixes(source, [...findings].reverse()), expected, "reversed findings");
			}
		}
	});

	it("applies MD004 and MD032 meeting on a CRLF line as markdownlint does", () => {
		const source = "- a\r\n+ b\r\n";
		const fixed = MarkdownLint.applyFixes(
			source,
			MarkdownLint.lint(source, [MD004, MD032], { config: { default: false, MD004: true, MD032: true } }),
		);
		assert.strictEqual(fixed, "- a\r\n- b\r\n");
	});

	// A case's own inputs, beside the shared extras: for pairs whose fixes the corpus never puts on one line.
	const cases: ReadonlyArray<
		readonly [string, ReadonlyArray<string>, number, number, ReadonlyArray<{ name: string; source: string }>?]
	> = [
		["every ported rule", rules.map((rule) => rule.name), ORACLE_FIXES_ALL, MEETING_ALL],
		["MD004 and MD032", ["MD004", "MD032"], ORACLE_FIXES_MD004_MD032, MEETING_MD004_MD032],
		["MD022 and MD009", ["MD022", "MD009"], ORACLE_FIXES_MD022_MD009, MEETING_MD022_MD009],
		["MD031 and MD032", ["MD031", "MD032"], ORACLE_FIXES_MD031_MD032, MEETING_MD031_MD032],
		["MD012 and MD047", ["MD012", "MD047"], ORACLE_FIXES_MD012_MD047, MEETING_MD012_MD047],
		["MD009 and MD010", ["MD009", "MD010"], ORACLE_FIXES_MD009_MD010, MEETING_MD009_MD010],
		// MD020 rewrites a closed heading's whole line, trailing whitespace included, where MD009 trims it.
		[
			"MD020 and MD009",
			["MD020", "MD009"],
			ORACLE_FIXES_MD020_MD009,
			MEETING_MD020_MD009,
			[
				{ name: "closed heading and trailing spaces, LF", source: "#Heading#  \n\n## Heading##   \n" },
				{ name: "closed heading and trailing spaces, CRLF", source: "#Heading#  \r\n\r\n## Heading##   \r\n" },
			],
		],
		// MD021 deletes spaces inside the hashes and MD009 the spaces after them.
		[
			"MD021 and MD009",
			["MD021", "MD009"],
			ORACLE_FIXES_MD021_MD009,
			MEETING_MD021_MD009,
			[
				{ name: "spaced closed heading and trailing spaces, LF", source: "#  Heading  #  \n\n##   Heading ##   \n" },
				{
					name: "spaced closed heading and trailing spaces, CRLF",
					source: "#  Heading  #  \r\n\r\n## Heading   ##   \r\n",
				},
			],
		],
		// MD005 re-indents an ordered item and MD009 trims the same line's end. (MD005 fixes only ordered items and MD004
		// only unordered ones, so those two never fix one line.)
		[
			"MD005 and MD009",
			["MD005", "MD009"],
			ORACLE_FIXES_MD005_MD009,
			MEETING_MD005_MD009,
			[
				{ name: "re-indented items and trailing spaces, LF", source: "1. a  \n 2. b   \n  3. c \n" },
				{ name: "re-indented items and trailing spaces, CRLF", source: " 9. a  \r\n10. b\r\n  11. c   \r\n" },
			],
		],
		// MD007 re-indents a sublist item and MD004 changes its marker, on one line.
		[
			"MD007 and MD004",
			["MD007", "MD004"],
			ORACLE_FIXES_MD007_MD004,
			MEETING_MD007_MD004,
			[
				{ name: "re-indented sublists and markers, LF", source: "- a\n   * b\n + c\n> - d\n>    + e\n" },
				{ name: "re-indented sublists and markers, CRLF", source: "- a\r\n   * b\r\n + c\r\n" },
			],
		],
		// MD027 deletes the spaces past a blockquote marker and MD009 a line's trailing spaces: on a blank quote line
		// they are the same spaces.
		[
			"MD027 and MD009",
			["MD027", "MD009"],
			ORACLE_FIXES_MD027_MD009,
			MEETING_MD027_MD009,
			[
				{ name: "quote spaces and trailing spaces, LF", source: ">   \n>  a  \n>\t \n" },
				{ name: "quote spaces and trailing spaces, CRLF", source: ">   \r\n>  a  \r\n" },
			],
		],
		// MD029 renumbers an ordered item and MD005 re-indents it, on one line.
		[
			"MD029 and MD005",
			["MD029", "MD005"],
			ORACLE_FIXES_MD029_MD005,
			MEETING_MD029_MD005,
			[
				{ name: "renumbered and re-indented items, LF", source: "1. a\n 3. b\n  5. c\n" },
				{ name: "renumbered and re-indented items, CRLF", source: "1. a\r\n 3. b\r\n  5. c\r\n" },
			],
		],
		// MD030 respaces after a marker; MD004 changes the marker, MD007 an unordered item's indent and MD005 an
		// ordered item's, on the same line. (MD007 fixes only unordered items and MD005 only ordered ones.)
		[
			"MD030 and MD004",
			["MD030", "MD004"],
			ORACLE_FIXES_MD030_MD004,
			MEETING_MD030_MD004,
			[
				{ name: "respaced items and markers, LF", source: "-  a\n*   b\n" },
				{ name: "respaced items and markers, CRLF", source: "-  a\r\n*   b\r\n" },
			],
		],
		[
			"MD030 and MD007",
			["MD030", "MD007"],
			ORACLE_FIXES_MD030_MD007,
			MEETING_MD030_MD007,
			[
				{ name: "respaced and re-indented sublists, LF", source: "- a\n   -  b\n -   c\n" },
				{ name: "respaced and re-indented sublists, CRLF", source: "- a\r\n   -  b\r\n -   c\r\n" },
			],
		],
		[
			"MD030 and MD005",
			["MD030", "MD005"],
			ORACLE_FIXES_MD030_MD005,
			MEETING_MD030_MD005,
			[
				{ name: "respaced and re-indented ordered items, LF", source: "1. a\n 2.  b\n  3.   c\n" },
				{ name: "respaced and re-indented ordered items, CRLF", source: "1. a\r\n 2.  b\r\n  3.   c\r\n" },
			],
		],
		// MD014 deletes a command's `$` and the whitespace after it, and MD010 rewrites a tab in that whitespace.
		[
			"MD014 and MD010",
			["MD014", "MD010"],
			ORACLE_FIXES_MD014_MD010,
			MEETING_MD014_MD010,
			[
				{ name: "dollar, tab and command, LF", source: "```\n$\tls\n$ cd\tx\n```\n" },
				{ name: "dollar, tab and command, CRLF", source: "```\r\n$\tls\r\n$ cd\tx\r\n```\r\n" },
			],
		],
		// MD038 deletes the spaces inside a code span and MD009 the spaces after it, on one line.
		[
			"MD038 and MD009",
			["MD038", "MD009"],
			ORACLE_FIXES_MD038_MD009,
			MEETING_MD038_MD009,
			[
				{ name: "padded code spans and trailing spaces, LF", source: "a `  x` b   \n`y  `  \n" },
				{ name: "padded code spans and trailing spaces, CRLF", source: "a `  x` b   \r\n`y  `  \r\n" },
			],
		],
		// MD037 deletes the spaces inside emphasis markers and MD009 the spaces at the line's end.
		[
			"MD037 and MD009",
			["MD037", "MD009"],
			ORACLE_FIXES_MD037_MD009,
			MEETING_MD037_MD009,
			[
				{ name: "spaced markers and trailing spaces, LF", source: "a ** bold ** c   \n_ x _  \n" },
				{ name: "spaced markers and trailing spaces, CRLF", source: "a ** bold ** c   \r\n_ x _  \r\n" },
			],
		],
		// MD049 swaps an emphasis's markers and MD037 deletes the spaces inside bare ones, on one line.
		[
			"MD049 and MD037",
			["MD049", "MD037"],
			ORACLE_FIXES_MD049_MD037,
			MEETING_MD049_MD037,
			[
				{ name: "swapped and spaced markers, LF", source: "*a* and _b_ and * c * end\n" },
				{ name: "swapped and spaced markers, CRLF", source: "*a* and _b_ and * c * end\r\n" },
			],
		],
		// MD050 swaps a strong's markers and MD049 an emphasis's, on one line and in one span.
		[
			"MD050 and MD049",
			["MD050", "MD049"],
			ORACLE_FIXES_MD050_MD049,
			MEETING_MD050_MD049,
			[
				{ name: "strong and emphasis in both styles, LF", source: "**a** *b* and __c__ _d_ and ___e___\n" },
				{ name: "strong and emphasis in both styles, CRLF", source: "**a** *b* and __c__ _d_ and ___e___\r\n" },
			],
		],
		// MD044 writes a name and MD049 swaps the emphasis markers around it, on one line.
		[
			"MD044 and MD049",
			["MD044", "MD049"],
			ORACLE_FIXES_MD044_MD049,
			MEETING_MD044_MD049,
			[
				{
					name: "names in swapped emphasis, LF",
					source:
						'<!-- markdownlint-configure-file {"MD044":{"names":["JavaScript"]}} -->\n\n*javascript* and _javascript_\n',
				},
				{
					name: "names in swapped emphasis, CRLF",
					source:
						'<!-- markdownlint-configure-file {"MD044":{"names":["JavaScript"]}} -->\r\n\r\n*javascript* and _javascript_\r\n',
				},
			],
		],
	];
	for (const [label, names, oracleFixes, meeting, own = []] of cases) {
		it(
			`agrees with markdownlint on ${label} together`,
			() => {
				const inputs = [...extra, ...own];
				const result = fixesDifferential(byName(...names), { extra: inputs });
				assert.deepStrictEqual(result.divergences, []);
				assert.strictEqual(result.compared, corpus.length * 3 + inputs.length);
				assert.strictEqual(result.oracleFixes, oracleFixes);
				assert.strictEqual(result.meeting, meeting);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint sorts its results by rule name, then line, before it applies them; applyFixes does the same, so
	// the rules' order and the findings' order change nothing.
	it(
		"agrees with markdownlint on every ported rule run in reverse order",
		() => {
			const result = fixesDifferential([...rules].reverse(), { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFixes, ORACLE_FIXES_ALL);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it(
		"agrees with markdownlint on every ported rule with its findings shuffled, over every fourth corpus file",
		() => {
			const sample = corpus.filter((_, index) => index % 4 === 0);
			const order = (findings: ReadonlyArray<LintDiagnostic>, input: { readonly name: string }) =>
				shuffled(findings, input.name);
			const result = fixesDifferential(rules, { extra, inputs: sample, order });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.compared, sample.length * 3 + extra.length);
			assert.strictEqual(result.meeting, MEETING_SAMPLE);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

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
const ORACLE_FIXES_ALL = 3054;
const ORACLE_FIXES_MD004_MD032 = 396;
const ORACLE_FIXES_MD022_MD009 = 452;
const ORACLE_FIXES_MD031_MD032 = 368;
const ORACLE_FIXES_MD012_MD047 = 90;
const ORACLE_FIXES_MD009_MD010 = 542;
// The inputs on which fixes from two or more of the case's rules land on one line, the case the file exists for.
const MEETING_ALL = 35;
const MEETING_MD004_MD032 = 17;
const MEETING_MD022_MD009 = 3;
const MEETING_MD031_MD032 = 13;
// MD012 fixes a blank run and MD047 the last line's end: they never fix one line together in the corpus or the extras.
const MEETING_MD012_MD047 = 0;
const MEETING_MD009_MD010 = 3;
const MEETING_SAMPLE = 8;

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

	const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>, number, number]> = [
		["every ported rule", rules.map((rule) => rule.name), ORACLE_FIXES_ALL, MEETING_ALL],
		["MD004 and MD032", ["MD004", "MD032"], ORACLE_FIXES_MD004_MD032, MEETING_MD004_MD032],
		["MD022 and MD009", ["MD022", "MD009"], ORACLE_FIXES_MD022_MD009, MEETING_MD022_MD009],
		["MD031 and MD032", ["MD031", "MD032"], ORACLE_FIXES_MD031_MD032, MEETING_MD031_MD032],
		["MD012 and MD047", ["MD012", "MD047"], ORACLE_FIXES_MD012_MD047, MEETING_MD012_MD047],
		["MD009 and MD010", ["MD009", "MD010"], ORACLE_FIXES_MD009_MD010, MEETING_MD009_MD010],
	];
	for (const [label, names, oracleFixes, meeting] of cases) {
		it(
			`agrees with markdownlint on ${label} together`,
			() => {
				const result = fixesDifferential(byName(...names), { extra });
				assert.deepStrictEqual(result.divergences, []);
				assert.strictEqual(result.compared, corpus.length * 3 + extra.length);
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

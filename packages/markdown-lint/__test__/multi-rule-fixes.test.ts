// The fixes of several rules applied together, held to markdownlint's own
// applyFixes over the upstream fixture corpus (as written, CRLF and bare CR):
// all the ported rules at once, and pairs whose fixes meet on one line.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { rules } from "../src/rules/all.js";
import { MD004 } from "../src/rules/MD004.js";
import { MD032 } from "../src/rules/MD032.js";
import { DIFFERENTIAL_TIMEOUT, fixesDifferential } from "./helpers/differential.js";

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

// markdownlint's findings with a fix over every input, per case.
const ORACLE_FIXES_ALL = 3054;
const ORACLE_FIXES_MD004_MD032 = 396;
const ORACLE_FIXES_MD022_MD009 = 452;
const ORACLE_FIXES_MD031_MD032 = 368;
const ORACLE_FIXES_MD012_MD047 = 90;
const ORACLE_FIXES_MD009_MD010 = 542;

describe("applyFixes over several rules' fixes", () => {
	it("applies MD004 and MD032 meeting on a CRLF line as markdownlint does", () => {
		const source = "- a\r\n+ b\r\n";
		const fixed = MarkdownLint.applyFixes(
			source,
			MarkdownLint.lint(source, [MD004, MD032], { config: { default: false, MD004: true, MD032: true } }),
		);
		assert.strictEqual(fixed, "- a\r\n- b\r\n");
	});

	const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>, number]> = [
		["every ported rule", rules.map((rule) => rule.name), ORACLE_FIXES_ALL],
		["MD004 and MD032", ["MD004", "MD032"], ORACLE_FIXES_MD004_MD032],
		["MD022 and MD009", ["MD022", "MD009"], ORACLE_FIXES_MD022_MD009],
		["MD031 and MD032", ["MD031", "MD032"], ORACLE_FIXES_MD031_MD032],
		["MD012 and MD047", ["MD012", "MD047"], ORACLE_FIXES_MD012_MD047],
		["MD009 and MD010", ["MD009", "MD010"], ORACLE_FIXES_MD009_MD010],
	];
	for (const [label, names, oracleFixes] of cases) {
		it(
			`agrees with markdownlint on ${label} together`,
			() => {
				const result = fixesDifferential(byName(...names), { extra });
				assert.deepStrictEqual(result.divergences, []);
				assert.strictEqual(result.compared, 1308 + extra.length);
				assert.strictEqual(result.oracleFixes, oracleFixes);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}
});

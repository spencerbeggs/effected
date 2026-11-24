// MD053 `link-image-reference-definitions`, held to markdownlint's own MD053
// over the upstream fixture corpus (LF and CRLF), the reference grid (see
// `referenceGrid`) and label shapes, and over inputs its setting changes.
// markdownlint reads its reference link and image data: a definition no
// reference or shortcut uses, and each duplicate, is reported on its label's
// line, and a definition on one line is deleted by the fix.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD012 } from "../../src/rules/MD012.js";
import { MD047 } from "../../src/rules/MD047.js";
import { MD053 } from "../../src/rules/MD053.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	fixesDifferential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { oracleLint } from "../helpers/markdownlint-oracle.js";
import {
	definitionsAboveTables,
	labelShapes,
	paragraphBreakShapes,
	referenceGrid,
	tabbedDefinitions,
} from "../helpers/reference-grid.js";

// Definitions beside other text, in containers, across lines, last in a source with no final line ending.
const definitionShapes = [
	{ name: "unused at the end with no line ending", source: "x\n\n[a]: u" },
	{ name: "unused alone with no line ending", source: "[a]: u" },
	{ name: "label alone on its line", source: "x\n\n[a]:\n  u\n[b]:\n\n[c]: v\n" },
	{ name: "unused in a blockquote and a list", source: "> [a]: u\n\n- [b]: v\n\n  [c]: w\n" },
	{ name: "unused and duplicate footnotes", source: "x\n\n[^1]: a\n[^1]: b\n\n[^2]:\n    c\n" },
	{ name: "long definition line", source: `x\n\n[a]: https://example.com/${"long/".repeat(12)}\n` },
	{ name: "escaped bracket label", source: "x\n\n[a\\]]: u\n[b\\\\]: v\n" },
	{ name: "indented definitions", source: "x\n\n [a]: u\n   [b]: v\n" },
	{ name: "ignored comment idiom", source: "x\n\n[//]: # (comment)\n[//]: # (again)\n" },
	{ name: "used by an image and a footnote call", source: "![i][a] [^1]\n\n[a]: u\n[^1]: n\n" },
	{ name: "CRLF", source: "x\r\n\r\n[a]: u\r\n[a]: v\r\n" },
];

const extra = [...referenceGrid, ...labelShapes, ...definitionShapes];

// Unused definitions deleted at the source's end: 1 to 3 (and a duplicate), alone or after text, with and without a
// final line ending, under each line ending. markdownlint removes each deleted line and joins the rest, so a run
// reaching the end takes the line break before it.
const endings: ReadonlyArray<readonly [string, string]> = [
	["LF", "\n"],
	["CRLF", "\r\n"],
	["CR", "\r"],
];
const lastLineDeletes = (() => {
	const grid: Array<{ readonly name: string; readonly source: string }> = [];
	const runs: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
		["one", ["[a]: /u"]],
		["two", ["[a]: /u", "[b]: /v"]],
		["three", ["[a]: /u", "[b]: /v", "[c]: /w"]],
		["a duplicate", ["[a]: /u", "[a]: /v"]],
	];
	for (const [count, definitions] of runs) {
		for (const [prefixName, prefix] of [
			["alone", []],
			["after text", ["x", ""]],
			["after a used one", ["[d]", "", "[d]: /d"]],
		] as const) {
			for (const [ending, eol] of endings) {
				for (const final of [true, false]) {
					const lines = [...prefix, ...definitions];
					grid.push({
						name: `${count} ${prefixName}, ${ending}${final ? "" : ", no final line ending"}`,
						source: lines.join(eol) + (final ? eol : ""),
					});
				}
			}
		}
	}
	return grid;
})();

const run = runRule(MD053);

describe("MD053 link-image-reference-definitions", () => {
	it(
		"agrees with markdownlint with default settings over the corpus, the reference grid and definition shapes",
		() => {
			const result = differential(MD053, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// The fix is markdownlint's whole-line delete (`deletesLine`), so the text left is markdownlint's, alone and beside
	// MD047 (a final line ending added on a deleted line) and MD012 (blank lines removed beside deleted ones).
	it(
		"leaves markdownlint's text when deleting definitions at the source's end",
		() => {
			const result = differential(MD053, { extra: lastLineDeletes });
			assert.deepStrictEqual(result.divergences, []);
			for (const companion of [MD047, MD012]) {
				const pair = fixesDifferential([MD053, companion], { inputs: lastLineDeletes });
				assert.deepStrictEqual(pair.divergences, [], companion.name);
				assert.isAbove(pair.oracleFixes, 0);
			}
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the default spelled out changes nothing.
	for (const [settings, changes] of [
		[{ ignored_definitions: ["r", "s", "^n"] }, true],
		[{ ignored_definitions: [] }, true],
		[{ ignored_definitions: ["//"] }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD053, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `new Set(ignored_definitions || ["//"])`: a string is the set of its characters.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD053,
				[
					{ ignored_definitions: "abc" },
					{ ignored_definitions: "" },
					{ ignored_definitions: null },
					{ ignored_definitions: 0 },
					{ ignored_definitions: [1, null, "a"] },
				],
				[...labelShapes, ...definitionShapes, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Where markdownlint throws (`new Set` of a number, `true` or a plain object), the kit reads the default.
	it("reads an ignored_definitions markdownlint throws on as the default", () => {
		const source = "x\n\n[a]: u\n[//]: # (c)\n";
		const lines = (settings: Record<string, unknown>) => run(source, settings).map((each) => each.lineNumber);
		const defaults = lines({});
		assert.deepStrictEqual(defaults, [3]);
		for (const ignored_definitions of [5, true, { a: 1 }]) {
			assert.deepStrictEqual(lines({ ignored_definitions }), defaults, JSON.stringify(ignored_definitions));
		}
	});

	// A named divergence, not of the port: enabled with no micromark rule beside it, markdownlint's MD053 reads no
	// reference data and reports nothing (see MD052).
	it("reports where markdownlint, with no micromark rule enabled, reads no reference data", () => {
		const source = "x\n\n[a]: u\n";
		const config = { default: false, MD053: true };
		assert.lengthOf(oracleLint(source, config), 0);
		assert.lengthOf(
			oracleLint(source, config, { micromark: true }).filter((finding) => finding.ruleNames[0] === "MD053"),
			1,
		);
		assert.lengthOf(run(source), 1);
	});

	it("keeps a definition used after a math block, which the fix would otherwise delete", () => {
		const source = "Formula:\n\n$$\nE = mc^2\n$$\nSee [the paper][p] for details.\n\n[p]: https://example.com/paper\n";
		assert.deepStrictEqual(run(source), []);
	});

	it("reports an unused definition on its line, with a fix that deletes the line", () => {
		const source = "Text.\n\n[unused]: https://example.com\n[used]: https://example.org\n\n[used]\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 3);
		assert.deepStrictEqual(finding?.detail, Option.some('Unused link or image reference definition: "unused"'));
		assert.deepStrictEqual(finding?.context, Option.some("[unused]: https://example.com"));
		assert.deepStrictEqual(finding?.range, Option.some([1, 29] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"Text.\n\n[used]: https://example.org\n\n[used]\n",
		);
	});

	// A definition's whitespace may be tabs (CommonMark §4.7), as markdownlint reads it.
	it(
		"agrees with markdownlint over definitions whose whitespace is a tab",
		() => {
			const result = differential(MD053, { extra: tabbedDefinitions });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_TABBED);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// After a math block or a directive line micromark starts a paragraph the kit's parser does not: its references,
	// and the definitions opening it, read as markdownlint reads them.
	it(
		"agrees with markdownlint after a line micromark ends a paragraph at",
		() => {
			const result = differential(MD053, { extra: paragraphBreakShapes });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_BREAKS);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// A definition directly above a table's header row is a definition.
	it(
		"agrees with markdownlint on definitions directly above a table",
		() => {
			const result = differential(MD053, { extra: definitionsAboveTables });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_ABOVE_TABLES);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD053 findings over the corpus (LF and CRLF), the grid, the label shapes and the definition shapes.
const ORACLE_FINDINGS_DEFAULT = 1137;

// markdownlint's MD053 findings over the corpus (LF and CRLF) and the tabbed definitions.
const ORACLE_FINDINGS_TABBED = 25;

// markdownlint's MD053 findings over the corpus (LF and CRLF) and the shapes after a paragraph break.
const ORACLE_FINDINGS_BREAKS = 22;

// markdownlint's MD053 findings over the corpus (LF and CRLF) and the definitions above tables.
const ORACLE_FINDINGS_ABOVE_TABLES = 22;

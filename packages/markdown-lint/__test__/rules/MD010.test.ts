// MD010 `no-hard-tabs`, held to markdownlint's own MD010 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD010 } from "../../src/rules/MD010.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { indentedCodeTails, unclosedFenceEnds } from "../helpers/link-grid.js";

const extra = [
	{ name: "tabs in text", source: "a\tb\t\tc\n\tlead\n" },
	{ name: "fenced code", source: "```\nx\ty\n```\n\n```js\nj\tk\n```\n\n```JS extra\nq\tr\n```\n" },
	{ name: "fence with no info", source: "~~~\nn\to\n~~~\n" },
	{ name: "indented code", source: "para\n\n    code\tx\n\t\ttabbed code\n\nafter\tz\n" },
	{ name: "code span", source: "`a\tb` c\td\n\n`a`\tb\n" },
	{ name: "code in containers", source: "- item\n\n      code\tx\n\n> ```js\n> a\tb\n> ```\n" },
	{ name: "unclosed fence", source: "```py\nx\ty\n" },
	{ name: "front matter", source: "---\nkey:\tvalue\n---\n\ttext\n" },
];

const run = runRule(MD010);

describe("MD010 no-hard-tabs", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD010, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs, so its run is not the default run again;
	// an explicit `code_blocks: true` is the default spelled out.
	for (const [settings, changes] of [
		[{ code_blocks: false }, true],
		[{ code_blocks: true }, false],
		[{ ignore_code_languages: ["js"] }, true],
		[{ ignore_code_languages: ["JS", "py"] }, true],
		[{ code_blocks: false, ignore_code_languages: ["js"] }, true],
		[{ spaces_per_tab: 4 }, false],
		[{ spaces_per_tab: 0 }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD010, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				assert.isAbove(result.oracleFindings, 0);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
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
				MD010,
				[
					{ spaces_per_tab: "4" },
					{ spaces_per_tab: null },
					{ spaces_per_tab: "x" },
					{ spaces_per_tab: -2 },
					{ spaces_per_tab: true },
					{ code_blocks: 0 },
					{ code_blocks: "" },
					{ code_blocks: "no" },
					{ code_blocks: null },
					{ ignore_code_languages: [1, "JS"] },
					{ ignore_code_languages: null },
					{ ignore_code_languages: "" },
					{ ignore_code_languages: [] },
				],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Where markdownlint's own reading of a setting throws (a truthy `ignore_code_languages` that is not an array), the kit stays total: it reads the setting
	// as no languages and reports what that gives. Recorded as "the kit reads a setting markdownlint throws on".
	it(
		"reads a setting markdownlint throws on as no languages",
		() => {
			const result = settingsDifferential(
				MD010,
				[{ ignore_code_languages: "js" }, { ignore_code_languages: 5 }, { ignore_code_languages: {} }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.strictEqual(result.divergences.length, NOT_A_LIST_DIVERGENCES);
			for (const divergence of result.divergences)
				assert.match(divergence.reason, /^markdownlint throws: .*\.map is not a function; kit: \d+ findings$/);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports each run of tabs with its column, and a fix of spaces_per_tab spaces per tab", () => {
		const source = "a\t\tb\n";
		const findings = run(source, { spaces_per_tab: 2 });
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.detail, Option.some("Column: 2"));
		assert.deepStrictEqual(finding?.range, Option.some([2, 2] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"a    b\n",
		);
	});

	// An unclosed fence ending the source with no final line ending: micromark reads its last line as code.
	it(
		"agrees with markdownlint on an unclosed fence ending the source",
		() => {
			const result = differential(MD010, { extra: unclosedFenceEnds });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_UNCLOSED);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Whitespace-only lines after an indented code block, which micromark's token takes in from four columns.
	it(
		"agrees with markdownlint on whitespace-only lines after indented code",
		() => {
			const result = differential(MD010, { extra: indentedCodeTails });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_CODE_TAILS);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD010 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 199;

// The inputs on which markdownlint throws on an `ignore_code_languages` that is not a list (see the test above).
const NOT_A_LIST_DIVERGENCES = 33;

// markdownlint's MD010 findings over the corpus (LF and CRLF) and the unclosed fences ending the source.
const ORACLE_FINDINGS_UNCLOSED = 183;

// markdownlint's MD010 findings over the corpus (LF and CRLF) and the lines after indented code.
const ORACLE_FINDINGS_CODE_TAILS = 183;

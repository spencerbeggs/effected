// MD009 `no-trailing-spaces`, held to markdownlint's own MD009 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD009 } from "../../src/rules/MD009.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { unclosedFenceEnds } from "../helpers/link-grid.js";

const extra = [
	{ name: "mixed line endings", source: "a  \r\nb   \nc \r\nd\n" },
	{ name: "hard break and stray spaces", source: "a  \nb   \nc \nd\n" },
	{ name: "trailing tab", source: "a\t\nb \t\n" },
	{ name: "fenced code", source: "```\ncode  \n  \n```  \n\ntext \n" },
	{ name: "indented code", source: "para\n\n    code \n    more  \n\nafter\n" },
	{ name: "unclosed fence", source: "```\ncode \n" },
	{ name: "unclosed fence, no newline", source: "```\ncode " },
	{ name: "fence in a list", source: "- item\n\n  ```\n  code \n  ```\n" },
	{
		name: "list item empty lines",
		source: "- a\n  \n  b\n  \n- c\n  \n\n  ```\n  x\n  \n  ```\n  \ntext\n\n1. one\n   \n   two\n",
	},
	{ name: "nested list empty lines", source: "- a\n  \n  - b\n    \n    c\n    \n- d\n" },
	{ name: "strict breaks", source: "a  \nb  \n\nlast  \n\n`code  \nspan`  \nmore\n" },
	{ name: "front matter", source: "---\ntitle: x   \n---\n\ntext \n" },
	{ name: "blockquote", source: "> a  \n> b \n>  \n" },
	{ name: "heading", source: "# Title  \n\nSetext  \n---\n" },
];

const run = runRule(MD009);

describe("MD009 no-trailing-spaces", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD009, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs, so its run is not the default run again;
	// an explicit `code_blocks: false` is the default spelled out.
	for (const [settings, changes] of [
		[{ br_spaces: 3 }, true],
		[{ br_spaces: 1 }, true],
		[{ br_spaces: 0 }, true],
		[{ code_blocks: true }, true],
		[{ code_blocks: false }, false],
		[{ list_item_empty_lines: true }, true],
		[{ strict: true }, true],
		[{ strict: true, list_item_empty_lines: true }, true],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD009, { config: settings, extra });
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
				MD009,
				[
					{ br_spaces: "3" },
					{ br_spaces: null },
					{ br_spaces: true },
					{ br_spaces: "x" },
					{ br_spaces: [3] },
					{ code_blocks: 1 },
					{ code_blocks: "yes" },
					{ code_blocks: 0 },
					{ list_item_empty_lines: 1 },
					{ list_item_empty_lines: "x" },
					{ strict: 1 },
					{ strict: "true" },
					{ strict: 0 },
				],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports stray trailing spaces with a range and a fix that deletes them", () => {
		const source = "Text   \n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.detail, Option.some("Expected: 0 or 2; Actual: 3"));
		assert.deepStrictEqual(finding?.range, Option.some([5, 3] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"Text\n",
		);
	});

	// An unclosed fence ending the source with no final line ending: micromark reads its last line as code.
	it(
		"agrees with markdownlint on an unclosed fence ending the source",
		() => {
			const result = differential(MD009, { extra: unclosedFenceEnds });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_UNCLOSED);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD009 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 190;

// markdownlint's MD009 findings over the corpus (LF and CRLF) and the unclosed fences ending the source.
const ORACLE_FINDINGS_UNCLOSED = 178;

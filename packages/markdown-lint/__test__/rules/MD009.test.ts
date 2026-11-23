// MD009 `no-trailing-spaces`, held to markdownlint's own MD009 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD009 } from "../../src/rules/MD009.js";
import { differential } from "../helpers/differential.js";

const extra = [
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

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD009], { config: { default: false, MD009: settings ?? true } });

describe("MD009 no-trailing-spaces", () => {
	it("agrees with markdownlint with default settings", () => {
		const result = differential(MD009, { extra });
		assert.deepStrictEqual(result.divergences, []);
		assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
	});

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
		it(`agrees with markdownlint under ${JSON.stringify(settings)}`, () => {
			const result = differential(MD009, { config: settings, extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
			if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		});
	}

	it("reads a wrong-typed setting as its default", () => {
		for (const settings of [
			{ br_spaces: "3" },
			{ code_blocks: "yes" },
			{ list_item_empty_lines: 1 },
			{ strict: "true" },
		]) {
			for (const { source } of extra) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

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
});

// markdownlint's MD009 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 188;

// MD010 `no-hard-tabs`, held to markdownlint's own MD010 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD010 } from "../../src/rules/MD010.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";

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

	it("reads a wrong-typed setting as its default", () => {
		for (const settings of [
			{ code_blocks: "no" },
			{ ignore_code_languages: "js" },
			{ ignore_code_languages: [1, "js"] },
			{ spaces_per_tab: "4" },
		]) {
			for (const { source } of extra) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

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
});

// markdownlint's MD010 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 199;

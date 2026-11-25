// MD005 `list-indent`, held to markdownlint's own MD005 over the upstream
// fixture corpus (LF and CRLF). A list item's prefix is micromark's
// `listItemPrefix` token: its marker and the whitespace after it. The rule
// has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Corpus } from "@effected/testing";
import { Option } from "effect";
import { MD005 } from "../../src/rules/MD005.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";

const extra = [
	{ name: "unordered drift", source: "* a\n * b\n  * c\n* d\n" },
	{ name: "unordered nested drift", source: "- a\n  - b\n   - c\n  - d\n" },
	{ name: "ordered drift", source: "1. a\n 2. b\n3. c\n" },
	{ name: "ordered right-aligned", source: " 9. a\n10. b\n11. c\n" },
	{ name: "ordered right-aligned then broken", source: " 8. a\n 9. b\n10. c\n  11. d\n" },
	{ name: "ordered left-aligned", source: "9. a\n10. b\n" },
	{ name: "ordered paren", source: "1) a\n 2) b\n" },
	{ name: "first item indented", source: "  - a\n- b\n  - c\n" },
	{ name: "blockquote", source: "> - a\n>  - b\n> 1. c\n>  2. d\n" },
	{ name: "list in a blockquote in a list", source: "- a\n\n  > * b\n  >  * c\n" },
	{ name: "footnote", source: "[^1]: note\n\n    * a\n     * b\n\nText[^1]\n" },
	{ name: "tabs", source: "-\ta\n -\tb\n1.\tc\n 2.\td\n" },
	{ name: "wide prefixes", source: "-    a\n -     b\n1.   c\n 2.  d\n" },
	{ name: "empty items", source: "-\n -\n1.\n 2.\n" },
	{ name: "loose list", source: "- a\n\n - b\n\n  - c\n" },
	{ name: "list in math", source: "$$\n- a\n - b\n$$\n" },
	{ name: "list in code and html", source: "```\n- a\n - b\n```\n\n<div>\n- a\n - b\n</div>\n" },
	{ name: "front matter", source: "---\ntitle: x\n---\n- a\n - b\n" },
	{ name: "CRLF", source: "1. a\r\n 2. b\r\n- c\r\n - d\r\n" },
];

const run = runRule(MD005);

describe("MD005 list-indent", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD005, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports an unordered item off its list's indent, with its prefix as the range and no fix", () => {
		const findings = run("- a\n - b\n");
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 2);
		assert.deepStrictEqual(finding?.detail, Option.some("Expected: 0; Actual: 1"));
		assert.deepStrictEqual(finding?.range, Option.some([1, 3] as const));
		assert.deepStrictEqual(finding?.fixInfo, Option.none());
	});

	it("reports an ordered item off its list's indent, with a fix that re-indents it", () => {
		const source = "1. a\n 2. b\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		assert.deepStrictEqual(findings[0]?.detail, Option.some("Expected: 0; Actual: 1"));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"1. a\n2. b\n",
		);
	});
});

// markdownlint's MD005 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 114;

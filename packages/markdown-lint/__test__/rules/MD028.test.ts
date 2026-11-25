// MD028 `no-blanks-blockquote`, held to markdownlint's own MD028 over the
// upstream fixture corpus (LF and CRLF). markdownlint reports the blank lines
// between a blockquote and a sibling blockquote that follows with nothing
// else between: a blank line holding a parent blockquote's marker is a token
// of its own, and ends the run. The rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD028 } from "../../src/rules/MD028.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";

const extra = [
	{ name: "one blank", source: "> a\n\n> b\n" },
	{ name: "two blanks and a third quote", source: "> a\n\n\n> b\n\n> c\n" },
	{ name: "whitespace-only blank", source: "> a\n  \n> b\n\n\t\n> c\n" },
	{ name: "nested, blank quote line", source: "> > a\n>\n> > b\n" },
	{ name: "nested, blank line", source: "> > a\n\n> > b\n" },
	{ name: "in a list item", source: "- > a\n\n  > b\n" },
	{ name: "in a quoted list item", source: "> - > a\n>\n>   > b\n" },
	{ name: "comment between", source: "> a\n\n<!-- x -->\n\n> b\n" },
	{ name: "definition between", source: "> a\n\n[z]: w\n\n> b\n" },
	{ name: "paragraph between", source: "> a\n\ntext\n\n> b\n" },
	{ name: "in a footnote", source: "[^1]: > a\n\n    > b\n\nText[^1]\n" },
	{ name: "in math", source: "$$\n> a\n\n> b\n$$\n" },
	{ name: "in code", source: "```\n> a\n\n> b\n```\n" },
	{ name: "front matter", source: "---\ntitle: x\n---\n> a\n\n> b\n" },
	{ name: "CRLF", source: "> a\r\n\r\n> b\r\n" },
];

const run = runRule(MD028);

describe("MD028 no-blanks-blockquote", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD028, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports each blank line between two blockquotes, with no detail or fix", () => {
		const findings = run("> a\n\n\n> b\n");
		assert.deepStrictEqual(
			findings.map((each) => each.lineNumber),
			[2, 3],
		);
		assert.deepStrictEqual(findings[0]?.detail, Option.none());
		assert.deepStrictEqual(findings[0]?.range, Option.none());
		assert.deepStrictEqual(findings[0]?.fixInfo, Option.none());
	});
});

// markdownlint's MD028 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 25;

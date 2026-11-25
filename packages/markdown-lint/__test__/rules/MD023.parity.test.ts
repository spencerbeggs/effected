// MD023 `heading-start-left`, held to markdownlint's own MD023 over the
// upstream fixture corpus (LF and CRLF). The rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Corpus } from "@effected/testing";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD023 } from "../../src/rules/MD023.js";
import { DIFFERENTIAL_TIMEOUT, differential } from "../helpers/differential.js";

const extra = [
	{ name: "indented atx", source: " # One\n\n   ## Three\n" },
	{ name: "indented setext", source: "  Setext\n  ===\n\n Text only\n---\n" },
	{ name: "tab-indented", source: "\t# Tab is code\n\n \t# Space tab\n" },
	{ name: "blockquote", source: "> # Flush\n>  # One extra\n>\n>   ## Two extra\n" },
	{ name: "list item", source: "- # On the marker line\n\n  # Continuation\n\n   # One extra\n" },
	{ name: "ordered list", source: "1. item\n\n    # Content column\n\n     # Extra\n" },
	{ name: "nested", source: "- > # In a quote\n  >  # Extra\n" },
	{ name: "long line", source: `  # ${"word ".repeat(10)}\n` },
	{ name: "in math", source: "$$\n # not\n$$\n" },
];

describe("MD023 heading-start-left", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD023, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports the indentation before a heading, with a fix that deletes it", () => {
		const source = "  # Heading\n";
		const findings = MarkdownLint.lint(source, [MD023]);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.context, Option.some("  # Heading"));
		assert.deepStrictEqual(finding?.range, Option.some([1, 2] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"# Heading\n",
		);
	});
});

// markdownlint's MD023 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 27;

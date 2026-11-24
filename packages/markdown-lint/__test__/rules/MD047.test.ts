// MD047 `single-trailing-newline`, held to markdownlint's own MD047 over the
// upstream fixture corpus (LF and CRLF). The rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD047 } from "../../src/rules/MD047.js";
import { DIFFERENTIAL_TIMEOUT, differential } from "../helpers/differential.js";

const extra = [
	{ name: "no trailing newline", source: "# H\n\ntext" },
	{ name: "no trailing newline, CRLF", source: "# H\r\n\r\ntext" },
	{ name: "no trailing newline, mostly CR", source: "a\rb\rc" },
	{ name: "a single line", source: "text" },
	{ name: "front matter only, unterminated", source: "---\ntitle: x\n---" },
	{ name: "a comment-only last line", source: "# H\n\n<!-- c -->" },
	{ name: "a blockquote marker last line", source: "> a\n>" },
	{ name: "whitespace last line", source: "a\n  " },
	{ name: "an empty document", source: "" },
];

describe("MD047 single-trailing-newline", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD047, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a last line with no line break, with a fix that adds one", () => {
		const source = "# H\n\ntext";
		const findings = MarkdownLint.lint(source, [MD047]);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 3);
		assert.isTrue(Option.isNone(finding?.detail ?? Option.none()));
		assert.deepStrictEqual(finding?.range, Option.some([4, 1] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"# H\n\ntext\n",
		);
	});
});

// markdownlint's MD047 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 18;

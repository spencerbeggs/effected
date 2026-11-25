// MD021 `no-multiple-space-closed-atx`, held to markdownlint's own MD021 over
// the upstream fixture corpus (LF and CRLF). The whitespace inside a closed
// ATX heading's hashes, micromark's `whitespace` tokens beside its two
// `atxHeadingSequence` tokens, is read from the heading's source span. The
// rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Corpus } from "@effected/testing";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD021 } from "../../src/rules/MD021.js";
import { DIFFERENTIAL_TIMEOUT, differential } from "../helpers/differential.js";

const extra = [
	{ name: "both sides", source: "#  Two  #\n\n##   Three   ##\n" },
	{ name: "one side", source: "#  Left #\n\n## Right   ##\n" },
	{ name: "one space", source: "# One #\n" },
	{ name: "open headings are MD019's", source: "#  Open\n" },
	{ name: "tabs", source: "#\t\tTabs\t\t#\n\n# \tMixed \t#\n" },
	{ name: "empty closed heading", source: "#   #\n\n## ##\n" },
	{ name: "trailing whitespace", source: "#  Trailing  #   \n" },
	{ name: "escaped hash", source: "#  Escaped \\#  #\n\n#  Not closed \\##\n" },
	{ name: "longer closing run", source: "#  Long  ####\n" },
	{ name: "in containers", source: ">   ##   Quoted   ##\n\n- #  Listed  #\n" },
	{ name: "long heading", source: `#  ${"word ".repeat(10)}  #\n` },
	{ name: "in code", source: "```\n#  not  #\n```\n" },
	{ name: "in math", source: "$$\n#  not  #\n$$\n" },
	{ name: "after front matter", source: "---\ntitle: T\n---\n#  Heading  #\n" },
	{ name: "CRLF", source: "#  Heading  #\r\n\r\n## Heading ##\r\n" },
];

describe("MD021 no-multiple-space-closed-atx", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD021, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports the extra spaces on each side, with fixes that delete them", () => {
		const source = "##   Heading  ##\n";
		const findings = MarkdownLint.lint(source, [MD021]);
		assert.lengthOf(findings, 2);
		const [opening, closing] = findings;
		assert.strictEqual(opening?.lineNumber, 1);
		assert.deepStrictEqual(opening?.context, Option.some("##   Heading  ##"));
		assert.deepStrictEqual(opening?.range, Option.some([4, 2] as const));
		assert.deepStrictEqual(closing?.range, Option.some([14, 1] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"## Heading ##\n",
		);
	});
});

// markdownlint's MD021 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 84;

// MD019 `no-multiple-space-atx`, held to markdownlint's own MD019 over the
// upstream fixture corpus (LF and CRLF). The rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD019 } from "../../src/rules/MD019.js";
import { differential } from "../helpers/differential.js";

const extra = [
	{ name: "two and three spaces", source: "#  Two\n\n##   Three\n" },
	{ name: "one space", source: "# One\n" },
	{ name: "closed headings are MD021's", source: "#  Closed  #\n" },
	{ name: "tabs", source: "#\t\tTabs\n\n# \tMixed\n" },
	{ name: "empty heading with spaces", source: "#   \n\nText\n" },
	{ name: "in containers", source: ">   ##   Quoted\n\n- #  Listed\n" },
	{ name: "long heading", source: `#  ${"word ".repeat(10)}\n` },
	{ name: "in math", source: "$$\n#  not\n$$\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

describe("MD019 no-multiple-space-atx", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD019, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports the extra spaces after the hashes, with a fix that deletes them", () => {
		const source = "##   Heading\n";
		const findings = MarkdownLint.lint(source, [MD019]);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.context, Option.some("##   Heading"));
		assert.deepStrictEqual(finding?.range, Option.some([4, 2] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"## Heading\n",
		);
	});
});

// markdownlint's MD019 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 40;

// MD018 `no-missing-space-atx`, held to markdownlint's own MD018 over the
// upstream fixture corpus (LF and CRLF). A line rule: `#Heading` is a
// paragraph to both parsers. The rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD018 } from "../../src/rules/MD018.js";
import { DIFFERENTIAL_TIMEOUT, differential } from "../helpers/differential.js";

const extra = [
	{ name: "missing space", source: "#Heading 1\n\n##Heading 2\n" },
	{ name: "closed or hash-only", source: "#Heading#\n\n####\n\n#Heading #  \n" },
	{ name: "keycap emoji", source: "#️⃣ keycap\n" },
	{ name: "in code", source: "```\n#not\n```\n\n    #not\n" },
	{ name: "in html", source: "<div>\n#not\n</div>\n" },
	{ name: "in math", source: "$$\n#not\n$$\n" },
	{ name: "in front matter", source: "---\n#comment: x\n---\n#Heading\n" },
	{ name: "long context", source: `#${"word ".repeat(10)}\n` },
	{ name: "indented", source: " #Indented\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
describe("MD018 no-missing-space-atx", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD018, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a missing space with the hashes as its range and a fix that inserts the space", () => {
		const source = "##Heading\n";
		const findings = MarkdownLint.lint(source, [MD018]);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.context, Option.some("##Heading"));
		assert.deepStrictEqual(finding?.range, Option.some([1, 3] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"## Heading\n",
		);
	});
});

// markdownlint's MD018 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 26;

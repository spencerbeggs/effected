// MD020 `no-missing-space-closed-atx`, held to markdownlint's own MD020 over
// the upstream fixture corpus (LF and CRLF). A line rule: `#Heading#` parses
// as a paragraph, so no heading node exists to read. The rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Corpus } from "@effected/testing";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD020 } from "../../src/rules/MD020.js";
import { DIFFERENTIAL_TIMEOUT, differential } from "../helpers/differential.js";

const extra = [
	{ name: "missing both sides", source: "#Heading 1#\n\n##Heading 2##\n" },
	{ name: "missing one side", source: "# Left only#\n\n##Right only ##\n" },
	{ name: "escaped closing hash", source: "# Escaped \\##\n\n#Escaped\\##\n" },
	{ name: "one character", source: "#a#\n\n#\\#\n" },
	{ name: "trailing whitespace", source: "#Heading#  \n\n#Heading#\t\n" },
	{ name: "spaced correctly", source: "# Heading #\n\n#\tTabbed\t#\n" },
	{ name: "open headings are MD018's", source: "#Heading\n\n# Heading\n" },
	{ name: "hash-only", source: "####\n\n# #\n" },
	{ name: "in code", source: "```\n#not#\n```\n\n    #not#\n" },
	{ name: "in html", source: "<div>\n#not#\n</div>\n" },
	{ name: "in math", source: "$$\n#not#\n$$\n" },
	{ name: "in front matter", source: "---\n#comment#\n---\n#Heading#\n" },
	{ name: "in containers", source: "> #Quoted#\n\n- #Listed#\n" },
	{ name: "long context", source: `#${"word ".repeat(10)}word#\n` },
	{ name: "indented", source: " #Indented#\n" },
	{ name: "CRLF", source: "#Heading#\r\n\r\n## Heading##\r\n" },
];

describe("MD020 no-missing-space-closed-atx", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD020, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a missing space with the opening hashes as its range and a fix that rewrites the line", () => {
		const source = "##Heading##\n";
		const findings = MarkdownLint.lint(source, [MD020]);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.context, Option.some("##Heading##"));
		assert.deepStrictEqual(finding?.range, Option.some([1, 3] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"## Heading ##\n",
		);
	});
});

// markdownlint's MD020 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 53;

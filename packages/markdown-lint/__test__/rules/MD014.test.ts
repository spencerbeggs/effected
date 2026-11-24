// MD014 `commands-show-output`, held to markdownlint's own MD014 over the
// upstream fixture corpus (LF and CRLF). A code block's lines are micromark's
// `codeFlowValue` tokens: each line past its containers and the block's own
// indentation, a whitespace-only line one too, an empty line none. The rule
// has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD014 } from "../../src/rules/MD014.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";

const extra = [
	{ name: "every line a command", source: "```sh\n$ ls\n$ cd x\n```\n" },
	{ name: "with output", source: "```sh\n$ ls\nfoo\n```\n" },
	{ name: "empty line between", source: "```\n$ ls\n\n$ cd\n```\n" },
	{ name: "whitespace line between", source: "```\n$ ls\n  \n$ cd\n```\n" },
	{ name: "leading spaces and tabs", source: "```\n  $ ls\n\t$  cd\n```\n" },
	{ name: "dollar alone", source: "```\n$\n$ ls\n```\n" },
	{ name: "dollar without space", source: "```\n$ls\n```\n" },
	{ name: "indented fence", source: "  ```\n   $ ls\n $ cd\n  ```\n" },
	{ name: "indented code", source: "text\n\n    $ ls\n      \n    $ cd\n" },
	{ name: "indented code, tab", source: "\t$ ls\n    \t$ cd\n" },
	{ name: "blockquote", source: "> ```\n> $ ls\n>  $ cd\n> ```\n" },
	{ name: "list item", source: "- ```\n  $ ls\n  ```\n\n  text\n\n      $ cd\n" },
	{ name: "empty block", source: "```\n```\n" },
	{ name: "unclosed fence", source: "```\n$ ls\n" },
	{ name: "tilde fence", source: "~~~\n$ ls\n~~~\n" },
	{ name: "in math", source: "$$\n```\n$ ls\n```\n$$\n" },
	{ name: "inline code", source: "`$ ls`\n" },
	{ name: "front matter", source: "---\ntitle: x\n---\n```\n$ ls\n```\n" },
	{ name: "CRLF", source: "```\r\n$ ls\r\n$ cd\r\n```\r\n" },
];

const run = runRule(MD014);

describe("MD014 commands-show-output", () => {
	it(
		"agrees with markdownlint",
		() => {
			const result = differential(MD014, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports each command's dollar sign, with a fix that deletes it", () => {
		const source = "```sh\n$ ls\n$  cd x\n```\n";
		const findings = run(source);
		assert.deepStrictEqual(
			findings.map((each) => each.lineNumber),
			[2, 3],
		);
		assert.deepStrictEqual(findings[1]?.context, Option.some("$  cd x"));
		assert.deepStrictEqual(findings[1]?.range, Option.some([1, 3] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"```sh\nls\ncd x\n```\n",
		);
	});
});

// markdownlint's MD014 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 53;

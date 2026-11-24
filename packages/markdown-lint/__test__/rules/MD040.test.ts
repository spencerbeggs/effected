// MD040 `fenced-code-language`, held to markdownlint's own MD040 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD040 } from "../../src/rules/MD040.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";

const extra = [
	{ name: "no language", source: "```\ncode\n```\n" },
	{ name: "language", source: "```js\ncode\n```\n" },
	{ name: "language and meta", source: "```js title=x\ncode\n```\n" },
	{ name: "space before the language", source: "```   ts   \ncode\n```\n" },
	{ name: "tilde fence", source: "~~~\ncode\n~~~\n\n~~~ python {.x}\ncode\n~~~\n" },
	{ name: "escaped and entity info", source: "``` j\\s\ncode\n```\n\n```&amp;x\ncode\n```\n" },
	{ name: "trailing space after the fence", source: "```  \ncode\n```\n" },
	{ name: "blockquote", source: "> ```\n> code\n> ```\n" },
	{ name: "list item", source: "- ```text\n  code\n  ```\n" },
	{ name: "unclosed fence", source: "```\ncode\n" },
	{ name: "first and last line, no final newline", source: "```" },
	{ name: "indented code", source: "    code\n" },
	{ name: "fence in math", source: "$$\n```\nx\n```\n$$\n" },
	{
		name: "long fence line",
		source: `\`\`\`${" ".repeat(2)}\n${"x".repeat(5)}\n\`\`\`\n\n\`\`\`${"y".repeat(10)} ${"z".repeat(40)}\ncode\n\`\`\`\n`,
	},
	{ name: "case", source: "```JS\ncode\n```\n" },
	{ name: "front matter", source: "---\ntitle: x\n---\n```\ncode\n```\n" },
	{ name: "tilde fence with a backtick in its info", source: "~~~ a`b c\nx\n~~~\n" },
	{ name: "fence in an html block", source: "<div>\n```\nx\n```\n</div>\n" },
	{ name: "fence in a list in a blockquote", source: "> - ```\n>   x\n>   ```\n" },
	{ name: "no-break space in the info", source: "```js\u00a0x\ny\n```\n" },
	{ name: "footnote", source: "[^1]: ```\n    x\n    ```\n\nT[^1]\n" },
	{ name: "tab after the fence", source: "```\tjs\tmeta\ncode\n```\n" },
];

const run = runRule(MD040);

describe("MD040 fenced-code-language", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD040, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint reads `allowed_languages` as the array or nothing, and `language_only` as `!!language_only`.
	for (const [settings, expected] of [
		[{ allowed_languages: ["js", "text"] }, 150],
		[{ allowed_languages: ["JS"] }, 347],
		[{ language_only: true }, 39],
		[{ language_only: "yes" }, 39],
		[{ allowed_languages: ["js"], language_only: true }, 306],
		[{ allowed_languages: [] }, 28],
		[{ allowed_languages: "js" }, 28],
		[{ language_only: false }, 28],
		[{ language_only: 0 }, 28],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD040, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				assert.strictEqual(result.oracleFindings, expected);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads allowed_languages that is not an array as empty, and language_only by truthiness", () => {
		for (const { source } of extra) {
			for (const settings of [{ allowed_languages: "js" }, { allowed_languages: { js: true } }]) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
			assert.deepStrictEqual(run(source, { language_only: 1 }), run(source, { language_only: true }));
			assert.deepStrictEqual(run(source, { language_only: "" }), run(source));
		}
	});

	it("reports a fence with no language, with the fence as its context", () => {
		const findings = run("text\n\n```\ncode\n```\n\n```py\nx\n```\n", { allowed_languages: ["js"] });
		assert.deepStrictEqual(
			findings.map((finding) => [
				finding.lineNumber,
				Option.getOrNull(finding.detail),
				Option.getOrNull(finding.context),
			]),
			[
				[3, null, "```"],
				[7, '"py" is not allowed', null],
			],
		);
	});
});

// markdownlint's MD040 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 28;

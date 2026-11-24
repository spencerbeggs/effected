// Differences from markdownlint the kit records rather than fixes, each named in `okf/modules/markdown-lint.md`
// (Known divergences and kit limitations): every input runs through all 53 rules in both engines, with the micromark
// companion on, and its findings (rule:line) only markdownlint reports and only the kit reports are pinned exactly, so
// a change that moves one, fixing it or widening it, fails here and is recorded.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { rules } from "../src/rules/all.js";
import { oracleLint } from "./helpers/markdownlint-oracle.js";

const cases: ReadonlyArray<readonly [name: string, source: string, markdownlintOnly: string, kitOnly: string]> = [
	// N-2: a directive line as a list item's content stops lazy continuation.
	["leaf as an item's content", "- ::leaf\ntext\n", "MD032:1", ""],
	["opening as an item's content", "- :::note\ntext\n", "MD032:1", ""],
	["opening as an item's content, then a table", "- :::note\n| a |\n| - |\n", "MD032:1,MD058:2", ""],
	// N-2: open container directives tracked document-wide (a kit limitation): closers, tables, quotes.
	["nested closers", ":::a\n:::b\n- a\n:::\n- b\n:::\n- c\n:::\n- d\n", "", "MD032:7"],
	["quoted opening, table outside", "> :::a\n> x\n\n| a |\n| - |\n:::\n| b |\n", "MD055:6,MD055:6", "MD058:5"],
	["quoted opening, quoted list after a closing fence", "> :::a\n\n> - x\n:::\n>  y\n", "", "MD032:3"],
	// N-2: a container directive's content in a blockquote.
	["quoted content", "> :::note\n>  text\n> :::\n", "", "MD027:2"],
	// N-2: a definition after a closing fence is paragraph text to MD034.
	["definition after a closing fence", ":::note\ninside\n:::\n[r]: https://r.example\n", "", "MD034:4"],
	// N-3: MD027 on a quoted math block's inner line, where micromark has no linePrefix.
	["quoted math", "> $$\n> x\n>      foo\n> $$\n", "", "MD027:3"],
	// N-4: container readings found by fuzz.
	["MD028 after quoted math and a lazy line", "> $$\n> math\n> $$\n[collapsed][]\n \n> x", "", "MD028:5"],
	[
		"fuzz2-7 #366: MD032 after an unclosed fence in a list item",
		"| x | y |\n|:-:|--:|\n| `a|b` | c |\n`code`\n\n\n- ```\n  unclosed\n \n> ` padded `",
		"",
		"MD032:9",
	],
	[
		"fuzz2-99 #100: MD032 on math in a list item before a table-like line",
		"1. <https://auto.example>\n\n\nText\n- tight list\nmore\n- $$\n  math\n  $$\na | b\n- | -\nc | d\nSetext two\n---\n\n\n\n1. ```\n   code\n   ```\n- plain paragraph\n  second line\n \n1. one\n1. one again",
		"MD032:11,MD032:9",
		"",
	],
	[
		"fuzz2-99 #388: a top-level table after a quoted table",
		'- a | b\r\n  - | -\r\n  c | d\r\n \r\n[r]: https://r.example\r\n- [ ] task\r\n- [x] done\r\n\r\n> | x | y |\r\n> |:-:|--:|\r\n> | `a|b` | c |\r\n> ` padded `\r\n| a | b |\r\n| - | - |\r\n| c | d |\r\n[r]: https://r.example\r\n\r\n\r\n1. [x](<https://e.example> "t")\r\n\r\n',
		"",
		"MD055:16,MD055:16,MD056:16,MD058:13",
	],
	// M-2: a setext heading after a definition.
	["setext after a definition", "[d]: /u\nTitle\n---\n", "", "MD022:2"],
	["setext after an indented definition", " [d]: /u\nTitle\n---\n", "MD023:1", "MD022:2"],
	// M-3: a table whose header row looks like a delimiter row.
	["header like a delimiter row", "a\n[x][y]\n| - | - |\n| - | - |\nb\n", "MD055:5,MD055:5,MD056:5,MD058:3", ""],
	// M-4: MD025 with undefined references in a container.
	[
		"undefined references in a list item",
		"- [javascript][]\n  # H\n  [*javascript*][used]\n  # H\n    [u6]: /u6",
		"",
		"MD025:4",
	],
];

const key = (finding: { readonly ruleNames: ReadonlyArray<string>; readonly lineNumber: number }) =>
	`${finding.ruleNames[0]}:${finding.lineNumber}`;
const config = { default: true };

describe("recorded divergences, every rule", () => {
	for (const [name, source, markdownlintOnly, kitOnly] of cases) {
		it(name, () => {
			const oracle = oracleLint(source, config, { micromark: true }).map(key).sort();
			const kit = MarkdownLint.lint(source, rules, { config }).map(key).sort();
			assert.strictEqual(oracle.filter((each) => !kit.includes(each)).join(","), markdownlintOnly, "markdownlint only");
			assert.strictEqual(kit.filter((each) => !oracle.includes(each)).join(","), kitOnly, "kit only");
		});
	}

	// N-7: markdownlint throws validating its own MD026 range on a lone colon fence before a setext underline; the kit
	// reports MD026 and MD041 there.
	it("markdownlint throws where the kit reports MD026 and MD041", () => {
		const source = "text\n:::\n---\n";
		let thrown: unknown;
		try {
			oracleLint(source, config, { micromark: true });
		} catch (error) {
			thrown = error;
		}
		assert.match(String(thrown), /range.*MD026/);
		assert.strictEqual(MarkdownLint.lint(source, rules, { config }).map(key).sort().join(","), "MD026:1,MD041:1");
	});
});

// markdownlint's directive extension (leaf and container directives) read beside every rule: the kit reads
// directive lines in micromark's own grammar (see `src/internal/directives.ts`), never inside code, HTML or math,
// and ends tables, lists and paragraphs before one. Each input runs through all 53 rules in both engines; where
// they still differ, the difference is one of three named classes recorded in okf, pinned here finding for finding.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { rules } from "../src/rules/all.js";
import { oracleLint } from "./helpers/markdownlint-oracle.js";

// Each input, with the findings (rule:line) only markdownlint reports and only the kit reports.
const cases: ReadonlyArray<readonly [name: string, source: string, markdownlintOnly: string, kitOnly: string]> = [
	// Agreeing now: directive lines inside a fence, the grammar's edges, definitions and labels after a directive.
	["opener in a fence before a list", "```\n:::note\n```\n\n- a\n:::\n- b\n", "", ""],
	["opener in a fence before a table", "```\n:::note\n```\n\n| a |\n| - |\n:::\n| b |\n", "", ""],
	["leaf in a quoted fence", ">  ```\n>  ::leaf\n>      foo\n>  ```\n", "", ""],
	["digit name", "::1note[label]\n", "", ""],
	["non-ASCII name", "::é[label]\n", "", ""],
	["quoted brace in an attribute", '::note[label]{a="}"}\n', "", ""],
	["leaf mid-paragraph", "text\n::note[label]\n", "", ""],
	["definition after a leaf", "::leaf\n[r]: /u\n", "", ""],
	["definition in a container directive", ":::note\n[r]: /u\n:::\n", "", ""],
	["name ending in a dash", "- a\n::a-\n- b\n", "", ""],
	["name ending in an underscore", "- a\n::a_\n- b\n", "", ""],
	["attribute with no value", "- a\n::a{b=}\n- b\n", "", ""],
	["attribute with no name", "- a\n::a{=b}\n- b\n", "", ""],
	["attribute of punctuation", "- a\n::a{<}\n- b\n", "", ""],
	["unquoted value with a bracket", "- a\n::a{b=c>d}\n- b\n", "", ""],
	["unquoted value with a backtick", "- a\n::a{b=`}\n- b\n", "", ""],
	["text after a quoted value", '- a\n::a{b="c"d}\n- b\n', "", ""],
	["leaf ending a list", "- a\n::leaf\n- b\n", "", ""],
	["leaf between list markers", "* a\n::leaf\n- b\n", "", ""],
	// Lists re-split after a directive line: micromark starts new lists past it, which the kit's list rules
	// (MD005, MD007, MD029) read as one list. MD032 reads the split.
	["nested list cut by a leaf", "- a\n  - b\n::leaf\n  - c\n- d\n", "MD005:5,MD007:4", ""],
	["ordered list cut by a leaf", "1. a\n::leaf\n2. b\n", "MD029:3", ""],
	["nested item after a leaf", "- a\n::leaf\n  - b\n", "MD007:3", ""],
	// Container directives tracked across the document, not per container: a quoted opening is still open below.
	["quoted opening, closing fence outside", "> :::a\n> - x\n\n- a\n:::\n- b\n", "", "MD032:4,MD032:6"],
	// Other rules reading a directive line as paragraph text.
	["setext underline after a leaf", "text\n::leaf\n===\n", "MD041:1", ""],
	["emphasis paragraph before a leaf", "**bold**\n::leaf\n", "MD036:1", ""],
	["URL in a leaf's label", "::leaf[https://e.example]\n", "MD034:1", ""],
	["leaf inside an HTML tag", "<span\n::leaf\nclass='x'>\n", "", "MD033:1"],
];

const key = (finding: { readonly ruleNames: ReadonlyArray<string>; readonly lineNumber: number }) =>
	`${finding.ruleNames[0]}:${finding.lineNumber}`;

describe("directive lines, every rule", () => {
	for (const [name, source, markdownlintOnly, kitOnly] of cases) {
		it(name, () => {
			const config = { default: true };
			const oracle = oracleLint(source, config, { micromark: true }).map(key).sort();
			const kit = MarkdownLint.lint(source, rules, { config }).map(key).sort();
			assert.strictEqual(oracle.filter((each) => !kit.includes(each)).join(","), markdownlintOnly, "markdownlint only");
			assert.strictEqual(kit.filter((each) => !oracle.includes(each)).join(","), kitOnly, "kit only");
		});
	}
});

// MD058 `blanks-around-tables`, held to markdownlint's own MD058 over the
// upstream fixture corpus (LF and CRLF), the table grid (see `tableGrid`)
// and table edges: a table on the document's first and last lines, in nested
// blockquotes and lists, beside headings, fences and HTML. The fix inserts a
// blank line holding the table line's blockquote markers.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD058 } from "../../src/rules/MD058.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";
import { lonePipeRows, tableGrid } from "../helpers/table-grid.js";

const edges = [
	{ name: "first and last lines", source: "| a | b |\n| - | - |\n| c | d |" },
	{ name: "first and last lines with a line ending", source: "| a | b |\n| - | - |\n| c | d |\n" },
	{ name: "nested blockquote", source: "> > text\n> > | a |\n> > | - |\n> > | b |\n> > text\n" },
	{ name: "list in a blockquote", source: "> - item\n>   | a |\n>   | - |\n>   | b |\n>   text\n" },
	{ name: "between a heading and a fence", source: "# H\n| a |\n| - |\n```\nx\n```\n" },
	{ name: "html comment above", source: "<!-- c -->\n| a |\n| - |\n<!-- d -->\n" },
	{ name: "blank with spaces around", source: "text\n   \n| a |\n| - |\n\t\ntext\n" },
	{ name: "table after front matter", source: "---\nt: 1\n---\n| a |\n| - |\n" },
];

const run = runRule(MD058);

describe("MD058 blanks-around-tables", () => {
	it(
		"agrees with markdownlint over the corpus, the table grid and table edges",
		() => {
			const result = differential(MD058, { extra: [...tableGrid, ...edges] });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// The lone pipe row (see MD055): the kit's table ends before it, so the kit reports no blank line missing below
	// the row before it where markdownlint's table goes on.
	it(
		"pins the lone pipe row as a parser-reading difference",
		() => {
			const result = differential(MD058, { extra: lonePipeRows });
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				lonePipeRows.map((input) => input.name),
			);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a table with no blank lines around it in a blockquote, with fixes that insert quoted blank lines", () => {
		// A heading ends the table: a line of text would be one more row.
		const source = "> Text\n> | a |\n> | - |\n> # H\n";
		const findings = run(source);
		assert.deepStrictEqual(
			findings.map((finding) => [finding.lineNumber, finding.context]),
			[
				[2, Option.some("> | a |")],
				[3, Option.some("> | - |")],
			],
		);
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"> Text\n>\n> | a |\n> | - |\n>\n> # H\n",
		);
	});
});

// markdownlint's MD058 findings over the corpus (LF and CRLF), the table grid and the edges.
const ORACLE_FINDINGS_DEFAULT = 135;

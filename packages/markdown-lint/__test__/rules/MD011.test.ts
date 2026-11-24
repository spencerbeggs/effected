// MD011 `no-reversed-links`, held to markdownlint's own MD011 over the
// upstream fixture corpus (LF and CRLF), the link grid (see `linkGrid`) and
// reversed-link shapes. A raw-line rule: markdownlint's pattern over each
// content line outside code, HTML and math blocks, less any match touching a
// code span or inline math. The rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD011 } from "../../src/rules/MD011.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";
import { linkGrid } from "../helpers/link-grid.js";

const extra = [
	{ name: "reversed", source: "(text)[https://u.v] and (a b)[c]\n" },
	{ name: "escaped open", source: "\\(text)[u] and a\\(b)[c]\n" },
	{ name: "followed by a paren", source: "(text)[u](v)\n" },
	{ name: "escaped ends", source: "(text\\)[u] and (t)[u\\]\n" },
	{ name: "caret destination", source: "(text)[^1] and (t)[]] and (t)[]\n" },
	{ name: "nested parens", source: "((a))[b] and (a(b))[c]\n" },
	{ name: "line start", source: "(a)[b]\n" },
	{ name: "code span touching", source: "`x`(a)[b] and (a)[b]`y` and `(a)[b]`\n" },
	{ name: "math touching", source: "$x$(a)[b] and $(a)[b]$\n" },
	{ name: "in code and html blocks", source: "```\n(a)[b]\n```\n\n    (a)[b]\n\n<div>\n(a)[b]\n</div>\n" },
	{ name: "in math block", source: "$$\n(a)[b]\n$$\n" },
	{ name: "in containers", source: "> (a)[b]\n\n- (c)[d]\n" },
	{ name: "front matter", source: "---\ntitle: (a)[b]\n---\n(c)[d]\n" },
	{ name: "many on a line", source: "(a)[b] (c)[d] (e)[f]\n" },
	{ name: "CRLF", source: "(a)[b]\r\n(c)[d]\r\n" },
];

const run = runRule(MD011);

describe("MD011 no-reversed-links", () => {
	it(
		"agrees with markdownlint over the corpus, the link grid and reversed shapes",
		() => {
			const result = differential(MD011, { extra: [...linkGrid, ...extra] });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a reversed link, with a fix that swaps its parts", () => {
		const source = "See (text)[https://u.v].\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.deepStrictEqual(finding?.detail, Option.some("(text)[https://u.v]"));
		assert.deepStrictEqual(finding?.range, Option.some([5, 19] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"See [text](https://u.v).\n",
		);
	});
});

// markdownlint's MD011 findings over the corpus (LF and CRLF), the grid and the extras.
const ORACLE_FINDINGS_DEFAULT = 82;

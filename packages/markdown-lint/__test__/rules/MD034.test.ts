// MD034 `no-bare-urls`, held to markdownlint's own MD034 over the upstream
// fixture corpus (LF and CRLF), the link grid (see `linkGrid`) and the
// literal-autolink grid (see `autolinkGrid`). markdownlint reports micromark's
// GFM literal autolinks outside HTML and HTML elements' content. The rule has
// no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD034 } from "../../src/rules/MD034.js";
import { autolinkGrid } from "../helpers/autolink-grid.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";
import { linkGrid } from "../helpers/link-grid.js";

// micromark links no literal while a label opener before it is unbalanced; a `]` balances the latest, link or not.
const extra = [
	{ name: "unclosed opener", source: "[a@b.co and [x https://a.b\n" },
	{ name: "closed span before", source: "a [b] a@b.co and [c] https://d.e\n" },
	{ name: "inside a later span", source: "[a] [b a@b.co] c\n" },
	{ name: "nested openers", source: "[[a@b.co]] and [[x] www.a.b]\n" },
	{ name: "escaped opener", source: "\\[a@b.co] and \\[https://a.b]\n" },
	{ name: "opener across lines", source: "[x\na@b.co]\n" },
	{ name: "opener in emphasis", source: "*[a@b.co]*\n" },
	{ name: "opener in a code span", source: "`[` a@b.co\n" },
	{ name: "entity before an email", source: "&amp;a@b.co and \\_c@d.ef\n" },
	{ name: "other-case www after a tag", source: "<b>WWW.a.b and x WWW.c.d\n" },
	// micromark ends a URL before a trailing `]`; an address after an escape or a reference reads as its own.
	{ name: "trailing brackets", source: "x https://a.b]] and www.a.b] and https://a.b/[x] and https://a.b/x]y\n" },
	{ name: "address after a reference", source: "x &#95;c@d.ef and &amp;a@b.co\n" },
	{ name: "address after an escape", source: "x \\.c@d.ef and \\-c@d.ef and \\*a@b.co\n" },
];

const run = runRule(MD034);

describe("MD034 no-bare-urls", () => {
	it(
		"agrees with markdownlint over the corpus, the link grid and the literal-autolink grid",
		() => {
			const result = differential(MD034, { extra: [...linkGrid, ...autolinkGrid, ...extra] });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a bare URL, with a fix that wraps it in angle brackets", () => {
		const source = "See https://u.v/x for more.\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.deepStrictEqual(finding?.context, Option.some("https://u.v/x"));
		assert.deepStrictEqual(finding?.range, Option.some([5, 13] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"See <https://u.v/x> for more.\n",
		);
	});
});

// markdownlint's MD034 findings over the corpus (LF and CRLF) and the grids.
const ORACLE_FINDINGS_DEFAULT = 333;

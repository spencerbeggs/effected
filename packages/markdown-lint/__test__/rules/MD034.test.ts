// MD034 `no-bare-urls`, held to markdownlint's own MD034 over the upstream
// fixture corpus (LF and CRLF), the link grid (see `linkGrid`) and the
// literal-autolink grid (see `autolinkGrid`). markdownlint reports micromark's
// GFM literal autolinks outside HTML and HTML elements' content. The rule has
// no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD034 } from "../../src/rules/MD034.js";
import { addressGrid, autolinkGrid, mathBracketGrid } from "../helpers/autolink-grid.js";
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

// micromark reads an address as it reads the text, before emphasis and brackets resolve: around `_`, `/`, an escape
// or a scheme, and on a second or third `@`, and after inline math holding a bracket.
const readings = [
	{ name: "underscores around addresses", source: "_a@b.co_ and _a@b.co and _a@b.co._ and x_a@b.co_ y\n" },
	{ name: "a second and third at sign", source: "foo@bar.baz@q.co and a@b.co@c.co@d.ef and x@y.z@w\n" },
	{ name: "a slash or an escape before", source: "x/a@b.co and a\\_b@c.de and \\_c@d.ef\n" },
	{ name: "domain edges", source: "a@.b.co a@b..co a@b.c1 a@b.co- a@b-.co a.@b.co -@b.co A@B.CO\n" },
	{ name: "a www or URL holding an at sign", source: "www.a@b.co and https://a@b.co\n" },
	{ name: "a bracket in math before", source: "$[$ https://a.com and $[$ *www.a.com* and $![$ WWW.a.com\n" },
	{ name: "a closer in math", source: "[x $]$ https://a.com and [$x$] https://b.com\n" },
	{ name: "emphasis across an html close tag", source: "<b>_x a@b.co</b> y_ and _x <b>_ a@b.co</b> y_\n" },
];

const emphasisAcrossTags = [
	// markdownlint reports, the kit does not: the `_` after the address's trailing `.` opens micromark emphasis that
	// pairs with a later `_` across the close tag, so the open tag finds no close.
	{ name: "diverges: a later underscore after the close tag", source: "<i>_a@b.co._</i> x_\n" },
	{ name: "diverges: a later address after the close tag", source: "<b>_a@b.co._</b> _a@b.co._\n" },
	// The kit reports, markdownlint does not: the kit's emphasis, opened by the run micromark gave the address, pairs
	// with a `_` after the close tag, so the close tag is no sibling of the open one.
	{ name: "diverges: an underscore right after the close tag", source: "<b>_a@b.co</b>_\n" },
	{ name: "diverges: another tag name", source: "<span>_a@b.co</span>_ x\n" },
	{ name: "diverges: a double underscore run", source: "<b>__a@b.co</b>__\n" },
	{ name: "diverges: an underscore later on the line", source: "<b>_a@b.co</b> y_\n" },
	{ name: "diverges: a trailing dot before the close tag", source: "<b>_a@b.co.</b> x_\n" },
	{ name: "diverges: a second element after", source: "<b>_a@b.co</b>_ <b>c@d.ef</b>\n" },
	// Agrees: an asterisk is no address character, an underscore not right before the address leaves it a delimiter
	// in both, a URL or www literal takes no underscore, and with no later underscore nothing pairs.
	{ name: "asterisk run", source: "<b>*a@b.co</b>* and <b>_a@b.co</b>*\n" },
	{ name: "underscore before a word", source: "<b>_x a@b.co</b>_\n" },
	{ name: "underscore inside the address", source: "<b>x_a@b.co</b>_ and <b>a@b.co_</b>_\n" },
	{ name: "URL after the underscore", source: "<b>_https://a.co</b>_\n" },
	{ name: "www after the underscore", source: "<b>_www.a.co</b>_\n" },
	{ name: "no later underscore", source: "<b>_a@b.co._</b>\n" },
	{ name: "asterisk later", source: "<b>_a@b.co._</b> x*\n" },
	{ name: "underscore before the open tag", source: "_<b>a@b.co_</b> and _a@b.co <b>c@d.ef_</b>\n" },
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

	it(
		"agrees with markdownlint over micromark's address and math-bracket readings",
		() => {
			const result = differential(MD034, { extra: [...addressGrid, ...mathBracketGrid, ...readings] });
			// Not a reading the port can take: micromark's address takes the `_` that would open emphasis, so a later `_`
			// opens emphasis that pairs across the inline HTML close tag, and markdownlint's walk finds no close for the
			// open tag. The kit's emphasis closes inside the element, so the kit leaves the address in it out.
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				["_a@b.co._ in inside an html element"],
			);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_READINGS);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// The class of the pinned divergence above, both ways: micromark's address consumes the `_` run before it, so its
	// emphasis pairs differently from the kit's, and with it which inline HTML tags are siblings for markdownlint's
	// tag pairing. Only an address does it (a URL or `www.` literal takes no `_`), and only a `_` run (`*` is no
	// address character).
	it(
		"pins the emphasis-pairing class across inline HTML in both directions",
		() => {
			const result = differential(MD034, { extra: emphasisAcrossTags });
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				emphasisAcrossTags.filter((input) => input.name.startsWith("diverges:")).map((input) => input.name),
			);
			assert.lengthOf(result.divergences, 8);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_EMPHASIS_ACROSS_TAGS);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reads markdownlint's address that takes an emphasis opener inside an html element as the kit's emphasis", () => {
		const findings = run("<b>_a@b.co._</b> x_\n");
		assert.deepStrictEqual(findings, []);
	});

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

// markdownlint's MD034 findings over the corpus (LF and CRLF) and the emphasis-pairing shapes.
const ORACLE_FINDINGS_EMPHASIS_ACROSS_TAGS = 102;

// markdownlint's MD034 findings over the corpus (LF and CRLF), the address and math-bracket grids and the readings.
const ORACLE_FINDINGS_READINGS = 384;

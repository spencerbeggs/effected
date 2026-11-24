// MD039 `no-space-in-links`, held to markdownlint's own MD039 over the
// upstream fixture corpus (LF and CRLF), the link grid (see `linkGrid`) and
// label-padding shapes. A link's label text is micromark's `labelText`: the
// source between its brackets. The rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD039 } from "../../src/rules/MD039.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";
import { linkGrid } from "../helpers/link-grid.js";

const extra = [
	{ name: "padded both sides", source: "[ a ](u) and [  b  ](u) and [\ta\t](u)\n" },
	{ name: "padded one side", source: "[ a](u) and [b ](u)\n" },
	{ name: "references", source: "[ a ][r] and [ r ][] and [ r ]\n\n[r]: u\n[ r ]: v\n" },
	{ name: "label across lines", source: "[a\nb ](u) and [ a\nb](u)\n" },
	{ name: "label starting with a break", source: "[\na](u) and [a\n](u)\n" },
	{ name: "quoted label across lines", source: "> [ a\n> b ](u)\n" },
	{ name: "nested markup", source: "[ *a* ](u) and [ `b` ](u)\n" },
	{ name: "image is not a link", source: "![ a ](i) and [ ![b](i) ](u)\n" },
	{ name: "link in an image alt", source: "![x [ a ](u) y](i)\n" },
	{ name: "undefined references", source: "[ a ][x] and [ b ]\n" },
	{ name: "empty labels", source: "[](u) and [ ](u)\n" },
	{ name: "in math", source: "$[ a ](u)$ and $$[ b ](u)$$\n" },
	{ name: "in html", source: "<div>\n[ a ](u)\n</div>\n" },
	{ name: "long label", source: `[ ${"word ".repeat(10)}](u)\n` },
	{ name: "CRLF", source: "[ a ](u)\r\n[b ](u)\r\n" },
];

const noBreakSpaces = [
	{ name: "no-break space ending a label on the first line", source: "[a\u00a0](u)\n" },
	{ name: "space and no-break space ending a label on the first line", source: "[a \u00a0](u)\n" },
	{ name: "no-break space opening a label", source: "[\u00a0a](u)\n" },
	{ name: "no-break space and space ending a label", source: "[a\u00a0 ](u)\n" },
	{ name: "no-break space ending a reference label on a later line", source: "x\n\n[a\u00a0][r]\n\n[r]: u\n" },
];

const run = runRule(MD039);

describe("MD039 no-space-in-links", () => {
	it(
		"agrees with markdownlint over the corpus, the link grid and padding shapes",
		() => {
			const result = differential(MD039, { extra: [...linkGrid, ...extra] });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint matches the spaces with re2, whose `\s` is ASCII, after `trimStart` and `trimEnd`, which trim a
	// no-break space: a label edged by one is reported with no range, a line off.
	it(
		"agrees with markdownlint on labels edged by a no-break space",
		() => {
			const result = differential(MD039, { extra: noBreakSpaces });
			// Not a divergence of the port: for a label that ends in a no-break space on the first line, markdownlint
			// reports the line before it and throws on its own `lineNumber`. The kit reports the label's line.
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				[
					"no-break space ending a label on the first line",
					"space and no-break space ending a label on the first line",
				],
			);
			for (const divergence of result.divergences) {
				assert.match(
					divergence.reason,
					/^markdownlint throws: Value of 'lineNumber' passed to onError by 'MD039' is incorrect for 'input'\.; kit: \d+ findings$/,
				);
			}
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_NO_BREAK);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a label ending in a no-break space on the first line at that line, with no range", () => {
		const findings = run("[a\u00a0](u)\n");
		assert.deepStrictEqual(
			findings.map((finding) => [finding.lineNumber, finding.range]),
			[[1, Option.none()]],
		);
	});

	it("reports the spaces inside a link's brackets, with fixes that delete them", () => {
		const source = "See [ text  ](u).\n";
		const findings = run(source);
		assert.lengthOf(findings, 2);
		assert.deepStrictEqual(findings[0]?.context, Option.some("[ text ]"));
		assert.deepStrictEqual(findings[0]?.range, Option.some([6, 1] as const));
		assert.deepStrictEqual(findings[1]?.range, Option.some([11, 2] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"See [text](u).\n",
		);
	});
});

// markdownlint's MD039 findings over the corpus (LF and CRLF), the grid and the extras.
const ORACLE_FINDINGS_DEFAULT = 217;

// markdownlint's MD039 findings over the corpus (LF and CRLF) and the no-break-space labels it does not throw on.
const ORACLE_FINDINGS_NO_BREAK = 173;

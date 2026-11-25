// MD042 `no-empty-links`, held to markdownlint's own MD042 over the upstream
// fixture corpus (LF and CRLF), the link grid (see `linkGrid`) and empty-link
// shapes. A link is empty when its destination is nothing or `#`, read as
// written, or when the definition a reference resolves to (labels normalized
// as markdownlint normalizes them) has the destination `#`. The rule has no
// settings.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD042 } from "../../src/rules/MD042.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";
import { linkGrid } from "../helpers/link-grid.js";
import { tabbedDefinitions } from "../helpers/reference-grid.js";

const extra = [
	{ name: "empty destinations", source: '[a]() and [b](<>) and [c]( ) and [d]( "t")\n' },
	{ name: "hash destinations", source: "[a](#) and [b](<#>) and [c]( # ) and [d](#x) and [e](\\#)\n" },
	{ name: "hash definitions", source: "[a] [b][] [c][hash] [d][HASH] [e][ hash  ]\n\n[a]: #\n[b]: #\n[hash]: #\n" },
	{ name: "angle hash definition", source: "[a][r] and [r]\n\n[r]: <#>\n" },
	{ name: "empty definition", source: "[a][r] and [r]\n\n[r]: <>\n" },
	{ name: "duplicate definitions", source: "[a][r] and [b][s]\n\n[r]: u\n[r]: #\n[s]: #\n[s]: u\n" },
	{ name: "spaced labels", source: "[a  b][] and [A B]\n\n[a b]: #\n" },
	{ name: "markup labels", source: "[*a*] and [`b`][]\n\n[*a*]: #\n[`b`]: #\n" },
	{ name: "link across lines", source: "[a\nb]() and [long text\nx](#)\n" },
	{ name: "empty label", source: "[](#) and [](u)\n" },
	{ name: "images are not links", source: "![a]() and ![b](#)\n" },
	{ name: "link in an image alt", source: "![x [a]() y](i)\n" },
	{ name: "undefined references", source: "[a][nope] and [nope]\n" },
	{ name: "in math", source: "$[a]()$ and $$[b](#)$$\n" },
	{ name: "in html", source: "<div>\n[a]()\n</div>\n" },
	{ name: "in a quote and a table", source: "> [a](#)\n\n| x |\n| - |\n| [b]() |\n" },
	{ name: "long link", source: `[${"word ".repeat(10)}]()\n` },
	{ name: "CRLF", source: "[a]()\r\n[b](#)\r\n" },
];

const run = runRule(MD042);

describe("MD042 no-empty-links", () => {
	it(
		"agrees with markdownlint over the corpus, the link grid and empty-link shapes",
		() => {
			const result = differential(MD042, { extra: [...linkGrid, ...extra] });
			// Not a divergence of the port: for a link spanning lines, markdownlint's range (the end column less the start
			// column) runs past the first line, and it throws on its own `range`. The kit reports the link, its range cut
			// to the line.
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				["link across lines"],
			);
			assert.match(
				result.divergences[0]?.reason ?? "",
				/^markdownlint throws: Value of 'range' passed to onError by 'MD042' is incorrect for 'input'\.; kit: \d+ findings$/,
			);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// The same upstream failure for a non-empty label ending in a line break, its destination `#`.
	it(
		"pins markdownlint's throw on a label ending in a line break",
		() => {
			const result = differential(MD042, { extra: [{ name: "label ending in a line break", source: "[x\n](#)\n" }] });
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				["label ending in a line break"],
			);
			assert.match(
				result.divergences[0]?.reason ?? "",
				/^markdownlint throws: Value of 'range' passed to onError by 'MD042' is incorrect for 'input'\.; kit: 1 findings$/,
			);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports an empty link with the link as its context and range, and no fix", () => {
		const findings = run("See [text]() here.\n");
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.deepStrictEqual(finding?.context, Option.some("[text]()"));
		assert.deepStrictEqual(finding?.range, Option.some([5, 8] as const));
		assert.deepStrictEqual(finding?.fixInfo, Option.none());
	});

	// A definition's whitespace may be tabs (CommonMark §4.7), as markdownlint reads it.
	it(
		"agrees with markdownlint over definitions whose whitespace is a tab",
		() => {
			const result = differential(MD042, { extra: tabbedDefinitions });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_TABBED);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD042 findings over the corpus (LF and CRLF), the grid and the extras.
const ORACLE_FINDINGS_DEFAULT = 97;

// markdownlint's MD042 findings over the corpus (LF and CRLF) and the tabbed definitions.
const ORACLE_FINDINGS_TABBED = 52;

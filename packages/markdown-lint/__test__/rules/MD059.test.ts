// MD059 `descriptive-link-text`, held to markdownlint's own MD059 over the
// upstream fixture corpus (LF and CRLF), the link grid (see `linkGrid`) and
// link-text shapes, and over inputs its setting changes. A link's text is its
// label's source, normalized as markdownlint normalizes it.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD059 } from "../../src/rules/MD059.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { linkGrid } from "../helpers/link-grid.js";

const extra = [
	{ name: "default texts", source: "[click here](u) [here](u) [link](u) [more](u) [More!](u) [ HERE ](u)\n" },
	{ name: "punctuation and markup", source: "[*here*](u) [**link**](u) [click_here](u) [click-here](u) [here.](u)\n" },
	{ name: "code and html children", source: "[`here`](u) [<b>here</b>](u) [*`here`*](u)\n" },
	{ name: "descriptive", source: "[the budget](u) [here and there](u)\n" },
	{ name: "references", source: "[here][r] [here][] [link]\n\n[r]: u\n[here]: u\n[link]: u\n" },
	{ name: "label across lines", source: "[click\nhere](u)\n" },
	{ name: "images are not links", source: "![here](i) and [![here](i)](u)\n" },
	{ name: "link in an image alt", source: "![x [here](u) y](i) and ![x [`here`](u)](i)\n" },
	{ name: "undefined references", source: "[here][nope] and [more]\n" },
	{ name: "autolinks", source: "<https://here> and https://link\n" },
	{ name: "in math", source: "$[here](u)$ and $$[link](u)$$\n" },
	{ name: "in html", source: "<div>\n[here](u)\n</div>\n" },
	{ name: "in a quote and a table", source: "> [here](u)\n\n| x |\n| - |\n| [link](u) |\n" },
	{ name: "CRLF", source: "[here](u)\r\n[link](u)\r\n" },
];

const run = runRule(MD059);

describe("MD059 descriptive-link-text", () => {
	it(
		"agrees with markdownlint with default settings over the corpus, the link grid and text shapes",
		() => {
			const result = differential(MD059, { extra: [...linkGrid, ...extra] });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the default spelled out changes nothing.
	for (const [settings, changes] of [
		[{ prohibited_texts: ["the budget", "text"] }, true],
		[{ prohibited_texts: ["Click  Here!"] }, true],
		[{ prohibited_texts: [] }, true],
		[{ prohibited_texts: ["click here", "here", "link", "more"] }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD059, { config: settings, extra: [...linkGrid, ...extra] });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `prohibited_texts || default`: a falsy value is the default.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD059,
				[{ prohibited_texts: null }, { prohibited_texts: 0 }, { prohibited_texts: "" }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Where markdownlint throws (it calls `.map` on the setting and string methods on each item), the kit reads the
	// default.
	it("reads a setting markdownlint throws on as the default", () => {
		const source = "[here](u) and [the budget](u)\n";
		const lines = (settings: Record<string, unknown>) => run(source, settings).map((each) => each.range);
		const defaults = lines({});
		assert.lengthOf(defaults, 1);
		for (const prohibited_texts of ["the budget", 5, true, ["the budget", 5]]) {
			assert.deepStrictEqual(lines({ prohibited_texts }), defaults, JSON.stringify(prohibited_texts));
		}
	});

	it("reports generic link text with the label as context and its text as the range", () => {
		const findings = run("See [click here](u).\n");
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.deepStrictEqual(finding?.context, Option.some("[click here]"));
		assert.deepStrictEqual(finding?.range, Option.some([6, 10] as const));
		assert.deepStrictEqual(finding?.fixInfo, Option.none());
	});
});

// markdownlint's MD059 findings over the corpus (LF and CRLF), the grid and the extras.
const ORACLE_FINDINGS_DEFAULT = 73;

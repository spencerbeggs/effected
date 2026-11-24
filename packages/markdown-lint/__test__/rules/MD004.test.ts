// MD004 `ul-style`, held to markdownlint's own MD004 over the upstream
// fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD004 } from "../../src/rules/MD004.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";

const extra = [
	{ name: "mixed markers", source: "* one\n+ two\n- three\n" },
	{ name: "first marker sets the style", source: "+ one\n\ntext\n\n- two\n" },
	{ name: "nested three deep", source: "* a\n  + b\n    - c\n  + d\n* e\n  + f\n" },
	{ name: "nested same marker", source: "- a\n  - b\n    - c\n" },
	{ name: "sublist under an ordered list", source: "1. a\n   - b\n     * c\n2. d\n   + e\n" },
	{ name: "blockquote", source: "> * a\n> + b\n>   - c\n" },
	{ name: "list in a blockquote in a list", source: "- a\n\n  > * b\n  >   + c\n" },
	{ name: "first and last line, no final newline", source: "+ a\n* b" },
	{ name: "front matter", source: "---\ntitle: x\n---\n* a\n- b\n" },
	{ name: "tab after the marker", source: "*\ta\n-\tb\n" },
	{ name: "lazy continuation", source: "* a\nlazy\n+ b\n" },
	{ name: "footnote", source: "[^1]: note\n\n    * a\n    + b\n\nText[^1]\n" },
	{ name: "list in math", source: "$$\n* a\n+ b\n$$\n\n- c\n" },
	{ name: "list in fenced code", source: "```\n* a\n```\n\n- c\n" },
	{ name: "empty items", source: "*\n+\n-\n" },
	{ name: "html block", source: "<div>\n* a\n</div>\n\n+ b\n" },
	{ name: "sublist deeper first", source: "- a\n  - b\n\n* c\n" },
	{ name: "math on an item's marker line", source: "- $$\n  x\n  $$\n+ b\n" },
	{ name: "math beside a nested marker line", source: "- - $$\n    x\n    $$\n  + y\n" },
	{ name: "math then a list opening math", source: "$$\nx\n$$\n- $$\n  y\n  $$\n* c\n" },
	{ name: "math holding a loose list", source: "$$\n- a\n\n- b\n$$\n* c\n" },
	{ name: "math inside an item", source: "- a\n  $$\n  * b\n  $$\n+ c\n" },
	{ name: "math in a blockquote", source: "> $$\n> * a\n> $$\n\n+ b\n" },
	{ name: "tab-indented sublist", source: "* a\n\n\t- b\n\t+ c\n" },
];

const run = runRule(MD004);

describe("MD004 ul-style", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD004, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each style changes markdownlint's findings over the same inputs; `consistent` is the default spelled out.
	// markdownlint reads `style` as `String(style || "consistent")` and an unknown name as `dash`, so a falsy value
	// is the default and a truthy one of the wrong type (`5`, `true`) is `dash`.
	for (const [settings, expected] of [
		[{ style: "asterisk" }, 888],
		[{ style: "dash" }, 848],
		[{ style: "plus" }, 1194],
		[{ style: "sublist" }, 506],
		[{ style: "unknown" }, 848],
		[{ style: 5 }, 848],
		[{ style: true }, 848],
		[{ style: ["sublist"] }, 506],
		[{ style: "consistent" }, 187],
		[{ style: "" }, 187],
		[{ style: 0 }, 187],
		[{ style: null }, 187],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD004, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				assert.strictEqual(result.oracleFindings, expected);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads a falsy style as the default and a truthy unknown one as dash", () => {
		for (const { source } of extra) {
			for (const settings of [{ style: "" }, { style: false }, { style: 0 }]) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
			for (const settings of [{ style: 5 }, { style: "Dash" }, { style: {} }]) {
				assert.deepStrictEqual(run(source, settings), run(source, { style: "dash" }), JSON.stringify(settings));
			}
		}
	});

	it("reports a marker that differs from the first, with a fix that replaces it", () => {
		const source = "* one\n+ two\n";
		const findings = run(source);
		assert.deepStrictEqual(
			findings.map((finding) => [
				finding.lineNumber,
				Option.getOrNull(finding.detail),
				Option.getOrNull(finding.range),
				Option.getOrNull(Option.map(finding.fixInfo, (fix) => ({ ...fix }))),
			]),
			[[2, "Expected: asterisk; Actual: plus", [1, 1], { editColumn: 1, deleteCount: 1, insertText: "*" }]],
		);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings), "* one\n* two\n");
	});

	// markdownlint coerces its settings (`Number(x ?? d)`, `!!x`, `String(x || d)`), so a non-canonical value
	// means to the kit what it means there.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD004,
				[{ style: ["dash"] }, { style: false }, { style: {} }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD004 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 187;

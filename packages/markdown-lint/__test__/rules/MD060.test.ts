// MD060 `table-column-style`, held to markdownlint's own MD060 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD060 } from "../../src/rules/MD060.js";
import { differential } from "../helpers/differential.js";

const extra = [
	{ name: "aligned", source: "| a   | b |\n| --- | - |\n| ccc | d |\n" },
	{ name: "compact", source: "| a | b |\n| - | - |\n| ccc | d |\n" },
	{ name: "tight", source: "|a|b|\n|-|-|\n|ccc|d|\n" },
	{ name: "mixed", source: "| a |b|\n|  -  | - |\n|ccc   | d|\n" },
	{ name: "no leading or trailing pipes", source: "a | b\n- | -\nc|d\n" },
	{ name: "short and long rows", source: "| a | b | c |\n| - | - | - |\n| d |\n| e | f | g | h |\n" },
	{ name: "trailing space after the last pipe", source: "| a | b |  \n| - | - |\n| c | d |\t\n" },
	{ name: "empty cells", source: "| a |  |\n| - | - |\n|   | \\| |\n" },
	{ name: "escaped pipe and code span", source: "| a | `x\\|y` |\n| - | - |\n| `p|q` | r |\n" },
	{ name: "indented table", source: "  | a | b |\n  |-|-|\n  |c|d|\n" },
	{ name: "blockquote", source: "> | a | b |\n> |---|---|\n> |c|d|\n" },
	{ name: "list item", source: "- | a |\n  | - |\n  | \tb\t|\n" },
	{ name: "wide characters", source: "| a  | b |\n| -- | - |\n| 你 | ✅ |\n" },
	{ name: "cell that looks like a list item", source: "|a|b|\n|-|-|\n|-|*|\n" },
	{ name: "list-like cell in a blockquote", source: "> |a|\n> |-|\n> |+|\n" },
	{ name: "first and last line, no final newline", source: "|a|b|\n|-|-|" },
	{ name: "front matter", source: "---\ntitle: x\n---\n| a |b|\n| - | - |\n" },
	{ name: "table in math", source: "$$\n| a |b|\n| - | - |\n$$\n" },
	{ name: "table in an html block", source: "<div>\n| a |b|\n| - | - |\n</div>\n" },
	{ name: "two tables", source: "| a | b |\n| - | - |\n\n|a  |b|\n|---|-|\n" },
	{ name: "footnote", source: "[^1]: | a |b|\n    | - | - |\n    |c|d|\n\nT[^1]\n" },
	{ name: "list item, a row indented past it", source: "- x\n\n  | a |b|\n  | - | - |\n    |c|d|\n" },
	{ name: "tab-indented table", source: "\t| a |b|\n\t| - | - |\n" },
	{ name: "row ending in a backslash", source: "| a |b|\n| - | - |\n|c|d\\\n" },
	{ name: "nested blockquote", source: "> > | a |b|\n> > | - | - |\n" },
	{ name: "emoji header", source: "| 👋🌎 | b |\n| ---- | - |\n| x    | y |\n" },
	{ name: "pipe inside inline html", source: "| a | b |\n| - | - |\n| <b>|</b> | c |\n" },
	{ name: "list-like cell in a list item", source: "- |a|\n  |-|\n  |*|\n" },
	{ name: "row of one pipe", source: "| a |\n| - |\n|\n" },
	{ name: "aligned delimiter", source: "| aaa | b |\n| - | - |\n| c | d |\n" },
];

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD060], { config: { default: false, MD060: settings ?? true } });

describe("MD060 table-column-style", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD060, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint reads `style` as `String(style || "any")`, so a falsy value is `any` and a name it does not know
	// allows no style and reports nothing; `aligned_delimiter` is read by truthiness.
	for (const [settings, changes] of [
		[{ style: "compact" }, true],
		[{ style: "aligned" }, true],
		[{ style: "tight" }, true],
		[{ style: "compact", aligned_delimiter: true }, true],
		[{ style: "tight", aligned_delimiter: 1 }, true],
		[{ aligned_delimiter: true }, true],
		[{ style: "unknown" }, true],
		[{ style: 5 }, true],
		[{ style: "any" }, false],
		[{ style: "" }, false],
		[{ style: "any", aligned_delimiter: false }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD060, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it("reads a falsy style as any and aligned_delimiter by truthiness", () => {
		for (const { source } of extra) {
			for (const settings of [{ style: "" }, { style: 0 }, { style: null }]) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
			assert.deepStrictEqual(
				run(source, { style: "compact", aligned_delimiter: "yes" }),
				run(source, { style: "compact", aligned_delimiter: true }),
			);
			assert.deepStrictEqual(run(source, { style: "nope" }), []);
		}
	});

	it("reports a pipe with no space beside it under compact, with a fix that inserts one", () => {
		const source = "| a |b|\n| - | - |\n";
		const findings = run(source, { style: "compact" });
		assert.deepStrictEqual(
			findings.map((finding) => [
				finding.lineNumber,
				Option.getOrNull(finding.detail),
				Option.getOrNull(finding.range),
			]),
			[
				[1, 'Table pipe is missing space to the right for style "compact"', [5, 1]],
				[1, 'Table pipe is missing space to the left for style "compact"', [7, 1]],
			],
		);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings), "| a | b |\n| - | - |\n");
	});
});

// markdownlint's MD060 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 1352;

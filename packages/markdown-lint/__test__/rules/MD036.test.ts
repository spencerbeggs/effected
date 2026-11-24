// MD036 `no-emphasis-as-heading`, held to markdownlint's own MD036 over the
// upstream fixture corpus (LF and CRLF) and over inputs its setting changes.
// markdownlint reports a top-level one-line paragraph whose one meaningful
// micromark child is an emphasis or strong holding one `data` token; the kit
// reads micromark's token split from the source (see the rule module).

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD036 } from "../../src/rules/MD036.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";

const extra = [
	{
		name: "emphasis and strong",
		source: "**Bold heading**\n\ntext\n\n_Italic heading_\n\ntext\n\n*Star*\n\n__Under__\n",
	},
	{ name: "punctuation", source: "**Done.**\n\n*Why?*\n\n**完了。**\n\n*Colon:*\n" },
	{ name: "inside text", source: "Some **bold** text\n\n**Bold** tail\n" },
	{ name: "multi-line", source: "**Bold\nheading**\n\n**Bold**\nnext line\n" },
	{ name: "nested emphasis", source: "***Both***\n\n**Bold _inner_**\n\n_**Strong in em**_\n" },
	{ name: "escapes and references", source: "**a\\*b**\n\n**a &amp; b**\n\n**a\\b**\n\n**a &bogus; b**\n" },
	{
		name: "unmatched delimiters",
		source: "**a * b**\n\n**a [ b**\n\n**a ] b**\n\n**a ~ b**\n\n**a ~~~ b**\n\n**a_b**\n",
	},
	{ name: "code, links and breaks", source: "**`code`**\n\n**[link](x)**\n\n**a  \nb**\n\n**<b>a</b>**\n" },
	{ name: "html beside it", source: "<b></b>**Bold**\n\n**Bold** <!-- c -->\n\n**Bold** &nbsp;\n" },
	{ name: "trailing whitespace", source: "**Bold**   \n\n**Bold**\t\n" },
	{ name: "in containers", source: "> **Quoted**\n\n- **Listed**\n\n1. _Ordered_\n" },
	{ name: "in html", source: "<div>\n\n**In html**\n\n</div>\n\n<div>\n**In html two**\n</div>\n" },
	{ name: "in code and math", source: "```\n**not**\n```\n\n    **not**\n\n$$\n**not**\n$$\n" },
	{ name: "headings and tables", source: "# **Heading**\n\n| **a** |\n| - |\n| **b** |\n" },
	{ name: "after front matter", source: "---\ntitle: T\n---\n**Bold**\n" },
	{ name: "long context", source: `**${"word ".repeat(10)}end**\n` },
	{ name: "CRLF", source: "**Bold**\r\n\r\n_Italic_\r\n" },
	// markdownlint's math extension reads inline math as a token apart from the data around it.
	{ name: "inline math", source: "**a $x$ b**\n\n*$x$*\n\n**a $$x$$ b**\n\n**a $ b $ c**\n\n**a $ b**\n" },
	{ name: "inline math in html", source: "<div>\n\n**a $x$ b**\n\n**plain**\n\n</div>\n" },
	// markdownlint parses no strikethrough: tildes are data to it.
	{ name: "strikethrough", source: "**~~gone~~**\n\n**a ~~b~~ c**\n\n**a~b~c**\n\n**~~*x*~~**\n\n~~**a**~~\n" },
];

const run = runRule(MD036);

describe("MD036 no-emphasis-as-heading", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD036, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the default spelled out changes nothing.
	for (const [settings, changes] of [
		[{ punctuation: ".,;:!" }, true],
		[{ punctuation: "" }, true],
		[{ punctuation: "^.?" }, true],
		[{ punctuation: ".,;:!?。，；：！？" }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD036, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `String(punctuation === undefined ? default : punctuation)`, so a non-string means its text.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD036,
				[{ punctuation: 5 }, { punctuation: null }, { punctuation: ["."] }, { punctuation: true }, { punctuation: 0 }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint builds `[${punctuation}]$` unescaped and throws on a pattern that does not compile; the kit falls
	// back to the default.
	it("reads a punctuation setting that is no valid character class as the default", () => {
		const source = "**Bold**\n\n**Done.**\n";
		const fallback = run(source).map((each) => each.lineNumber);
		assert.deepStrictEqual(fallback, [1]);
		assert.deepStrictEqual(
			run(source, { punctuation: "\\" }).map((each) => each.lineNumber),
			fallback,
		);
	});

	it("reports the emphasized text as its context", () => {
		const findings = run("text\n\n**My document**\n");
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 3);
		assert.deepStrictEqual(finding?.context, Option.some("My document"));
		assert.deepStrictEqual(finding?.range, Option.none());
		assert.deepStrictEqual(finding?.fixInfo, Option.none());
	});
});

// markdownlint's MD036 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 43;

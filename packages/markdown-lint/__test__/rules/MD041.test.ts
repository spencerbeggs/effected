// MD041 `first-line-heading`, held to markdownlint's own MD041 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { Option, Result } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD041 } from "../../src/rules/MD041.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";

const extra = [
	{ name: "text first", source: "Intro\n\n# Title\n" },
	{ name: "level two first", source: "## Section\n" },
	{ name: "comment then title", source: "<!-- note -->\n\n# Title\n" },
	{ name: "comment ending in a dash then title", source: "<!-- a --->\n\n# Title\n" },
	{ name: "html heading", source: "<h1>Title</h1>\n\ntext\n" },
	{ name: "html heading of level two", source: '<h2 class="x">Title</h2>\n' },
	{ name: "html block then title", source: "<div>\nx\n</div>\n\n# Title\n" },
	{ name: "front matter title", source: "---\ntitle: Doc\n---\n\nIntro\n" },
	{ name: "front matter other key", source: "---\nlayout: post\n---\n\nIntro\n" },
	{ name: "setext title", source: "Title\n=====\n" },
	{ name: "badge preamble", source: "[![badge](https://x/b.svg)](https://x)\n\n# Title\n" },
	{ name: "empty document", source: "" },
	{ name: "long first line", source: `${"word ".repeat(10)}\n` },
];

// A leading byte order mark, once and twice, before plain content and before a front matter title.
const bomExtra = [
	{ name: "byte order mark", source: "\uFEFFIntro\n\n# Title\n" },
	{ name: "byte order mark before front matter", source: "\uFEFF---\ntitle: Doc\n---\n\nIntro\n" },
	{ name: "two byte order marks", source: "\uFEFF\uFEFFIntro\n\n# Title\n" },
	{ name: "two byte order marks before front matter", source: "\uFEFF\uFEFF---\ntitle: Doc\n---\n\nIntro\n" },
	{ name: "two byte order marks before a heading", source: "\uFEFF\uFEFF# Title\n\ntext\n" },
	{ name: "three byte order marks before a heading", source: "\uFEFF\uFEFF\uFEFF# Title\n\ntext\n" },
];

const run = runRule(MD041);

describe("MD041 first-line-heading", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD041, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the defaults spelled out change nothing.
	for (const [settings, changes] of [
		[{ allow_preamble: true }, true],
		[{ level: 2 }, true],
		[{ front_matter_title: "" }, true],
		[{ front_matter_title: false }, true],
		[{ front_matter_title: 0 }, true],
		[{ front_matter_title: null }, true],
		[{ front_matter_title: "^\\s*layout\\s*:" }, true],
		[{ allow_preamble: false, level: 1 }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD041, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it(
		"reads front matter after one leading byte order mark only, and diverges where micromark drops a second",
		() => {
			// markdownlint strips exactly one leading byte order mark: a second one is text to its front matter
			// reader, so a block after it is not front matter and its title does not count. micromark then drops
			// that second mark before it parses, which the kit does not model: two marks before a heading read as
			// a heading there and as text here. That one input is a recorded divergence; three marks agree again.
			const result = differential(MD041, { extra: [...extra, ...bomExtra] });
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				["two byte order marks before a heading"],
			);
			assert.match(result.divergences[0]?.reason ?? "", /^extra finding 1: kit \{"lineNumber":1,"ruleNames":\["MD041"/);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT + ORACLE_FINDINGS_BOM);
			for (const { name, source } of bomExtra) {
				const document = Result.getOrThrow(MarkdownDocument.parseResult(source));
				assert.deepStrictEqual(
					MarkdownLint.lintDocument(document, [MD041], { config: { default: false, MD041: true } }),
					run(source),
					name,
				);
			}
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reads a wrong-typed or invalid setting as its default", () => {
		for (const settings of [
			{ allow_preamble: "yes" },
			{ level: "2" },
			{ front_matter_title: 1 },
			{ front_matter_title: "(" },
		]) {
			for (const { source } of extra) {
				assert.deepStrictEqual(run(source, settings), run(source), JSON.stringify(settings));
			}
		}
	});

	it("reports a first line that is not a top-level heading", () => {
		const findings = run("Intro text\n\n# Title\n");
		assert.deepStrictEqual(
			findings.map((finding) => [finding.lineNumber, Option.getOrNull(finding.context)]),
			[[1, "Intro text"]],
		);
		// markdownlint's rule reports no range and no fix.
		for (const finding of findings) {
			assert.isTrue(Option.isNone(finding.range));
			assert.isTrue(Option.isNone(finding.fixInfo));
			assert.isTrue(Option.isNone(finding.edit));
		}
	});
});

// markdownlint's MD041 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 30;

// markdownlint's MD041 findings over the byte order mark inputs: one mark before text, and two before text, before a
// front matter title and three before a heading (micromark drops only the second, so a third is text).
const ORACLE_FINDINGS_BOM = 4;

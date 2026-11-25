// MD041 `first-line-heading`, held to markdownlint's own MD041 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { Corpus, Depth } from "@effected/testing";
import { Option, Result } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD041 } from "../../src/rules/MD041.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";

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
	{ name: "three byte order marks before front matter", source: "\uFEFF\uFEFF\uFEFF---\ntitle: Doc\n---\n\nIntro\n" },
];

const run = runRule(MD041);

describe("MD041 first-line-heading", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD041, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
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
				if (changes) Depth.whenFull(() => assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT));
				else Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	it(
		"reads front matter after one leading byte order mark only, and diverges where micromark drops a second",
		() => {
			// markdownlint strips exactly one leading byte order mark: a second one is text to its front matter
			// reader, so a block after it is not front matter and its title does not count. micromark then drops one
			// more before it parses, which the kit does not model, so with two or more marks every token text
			// markdownlint reads runs one character behind. Two marks before a heading read as a heading there and as
			// text here; three before a `---` block make its setext underline read as level 1 there, a title. Those
			// two inputs are recorded divergences; the others agree.
			const result = differential(MD041, { extra: [...extra, ...bomExtra] });
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				["two byte order marks before a heading", "three byte order marks before front matter"],
			);
			for (const divergence of result.divergences) {
				assert.match(divergence.reason, /^extra finding 1: kit \{"lineNumber":1,"ruleNames":\["MD041"/);
			}
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT + ORACLE_FINDINGS_BOM);
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

	// markdownlint coerces its settings (`Number(x ?? d)`, `!!x`, `String(x || d)`), so a non-canonical value
	// means to the kit what it means there.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD041,
				[
					{ allow_preamble: 1 },
					{ allow_preamble: "x" },
					{ allow_preamble: 0 },
					{ level: "2" },
					{ level: null },
					{ level: "x" },
					{ front_matter_title: 5 },
					{ front_matter_title: 0 },
				],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Where markdownlint's own reading of a setting throws (a `front_matter_title` that is not a valid regular expression), the kit stays total: it reads the setting
	// as its default pattern and reports what that gives. Recorded as "the kit reads a setting markdownlint throws on".
	it(
		"reads a setting markdownlint throws on as its default pattern",
		() => {
			const result = settingsDifferential(
				MD041,
				[{ front_matter_title: "(" }, { front_matter_title: "[" }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.strictEqual(result.divergences.length, INVALID_TITLE_PATTERN_DIVERGENCES);
			for (const divergence of result.divergences)
				assert.match(divergence.reason, /^markdownlint throws: Invalid regular expression.*; kit: \d+ findings$/);
		},
		DIFFERENTIAL_TIMEOUT,
	);

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
// front matter title and three before a heading (micromark drops only the second, so a third is text); none for
// three before a front matter block, whose setext heading markdownlint reads as a level-1 title.
const ORACLE_FINDINGS_BOM = 4;

// The inputs on which markdownlint throws on an invalid `front_matter_title` (see the test above).
const INVALID_TITLE_PATTERN_DIVERGENCES = 32;

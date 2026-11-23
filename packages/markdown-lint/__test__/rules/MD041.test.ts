// MD041 `first-line-heading`, held to markdownlint's own MD041 over the
// upstream fixture corpus (LF and CRLF) and over inputs each setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { MD041 } from "../../src/rules/MD041.js";
import { differential } from "../helpers/differential.js";

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

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
const DIFFERENTIAL_TIMEOUT = 60_000;

const run = (source: string, settings?: Record<string, unknown>) =>
	MarkdownLint.lint(source, [MD041], { config: { default: false, MD041: settings ?? true } });

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
	});
});

// markdownlint's MD041 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 30;

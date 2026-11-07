// The adapter under a REAL markdownlint, pinned as this package's one
// differential-oracle devDependency (the same copy the workspace root's
// markdownlint-cli2 resolves). It is the differential host: markdownlint
// validates every onError call (line bounds, range bounds, fixInfo bounds) and
// throws on a bad one, applies fixInfo with its own applyFixes, and honours
// inline disable comments, so a mapping bug shows up as markdownlint's
// behaviour, not as our own opinion.
//
// The specifier goes through a variable so that no `src/` type ever resolves
// against markdownlint's declarations: the adapter's local types must stay a
// structural subset checked by this file alone. Only this file imports it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import type { LintDiagnostic } from "../src/LintDiagnostic.js";
import { LintRule } from "../src/LintRule.js";
import { MarkdownLint } from "../src/MarkdownLint.js";
import type { MarkdownlintRule } from "../src/MarkdownlintAdapter.js";
import { MarkdownlintAdapter } from "../src/MarkdownlintAdapter.js";
import { changesetRules } from "./rules/index.js";

interface MarkdownlintResult {
	readonly lineNumber: number;
	readonly ruleNames: ReadonlyArray<string>;
	readonly ruleDescription: string;
	readonly ruleInformation: string | null;
	readonly errorDetail: string | null;
	readonly errorContext: string | null;
	readonly errorRange: ReadonlyArray<number> | null;
	readonly fixInfo: unknown;
	readonly severity?: string;
}

interface MarkdownlintApi {
	readonly lint: (options: {
		readonly strings: Readonly<Record<string, string>>;
		readonly customRules: ReadonlyArray<MarkdownlintRule>;
		readonly config: Readonly<Record<string, unknown>>;
		readonly handleRuleFailures?: boolean;
	}) => Promise<Record<string, ReadonlyArray<MarkdownlintResult>>>;
}

interface MarkdownlintHelpers {
	readonly applyFixes: (input: string, errors: ReadonlyArray<MarkdownlintResult>) => string;
	readonly getVersion: () => string;
}

const promiseSpecifier = "markdownlint/promise";
const helpersSpecifier = "markdownlint";
const markdownlint: MarkdownlintApi = await import(promiseSpecifier);
const helpers: MarkdownlintHelpers = await import(helpersSpecifier);

interface GoldenCase {
	readonly id: number;
	readonly sources: ReadonlyArray<string>;
	readonly markdown: string;
	readonly markdownlint: ReadonlyArray<Omit<MarkdownlintResult, "ruleInformation" | "severity">>;
}

const golden: { readonly cases: ReadonlyArray<GoldenCase> } = JSON.parse(
	readFileSync(join(import.meta.dirname, "fixtures", "changesets", "golden.json"), "utf8"),
);

const lintWith = async (
	text: string,
	rules: ReadonlyArray<LintRule>,
	enabled: Readonly<Record<string, unknown>> = {},
): Promise<ReadonlyArray<MarkdownlintResult>> => {
	const config: Record<string, unknown> = { default: false, ...enabled };
	for (const rule of rules) if (!(rule.name in config)) config[rule.name] = true;
	const results = await markdownlint.lint({
		strings: { input: text },
		customRules: MarkdownlintAdapter.rules(rules),
		config,
	});
	return results.input ?? [];
};

const fromMarkdownlint = ({ lineNumber, errorDetail, errorContext, errorRange }: MarkdownlintResult) => ({
	lineNumber,
	errorDetail,
	errorContext,
	errorRange,
});

const asResult = (finding: LintDiagnostic) => ({
	lineNumber: finding.lineNumber,
	errorDetail: Option.getOrNull(finding.detail),
	errorContext: Option.getOrNull(finding.context),
	errorRange: Option.match(finding.range, { onNone: () => null, onSome: (range) => [...range] }),
});

// A rule whose findings carry every optional field: the heading's text as
// context, its span as the range, and a fix replacing the `#` run with `##`.
const promoteH1 = LintRule.make({
	names: ["promote-h1", "X001"],
	description: "Level-1 headings become level-2",
	tags: ["test"],
	information: "https://example.com/rules/promote-h1",
	check: (context, report) => {
		for (const heading of context.document.findAll("heading")) {
			if (heading.depth !== 1) continue;
			const start = heading.position.start.offset;
			report(
				context.diagnostic({
					at: heading,
					detail: "Use ##",
					context: context.mapping.lineText(context.mapping.nodeLineNumber(heading)),
					range: true,
					fix: { offset: start, length: 1, content: "##" },
				}),
			);
		}
	},
});

// Reports on the frontmatter node itself, with a whole-line delete of its
// first value line.
const frontmatterRule = LintRule.make({
	names: ["frontmatter-note"],
	description: "Notes the frontmatter block",
	tags: ["test"],
	check: (context, report) => {
		for (const frontmatter of Option.toArray(context.frontmatter)) {
			const valueLine = context.mapping.lineText(2);
			const offset = context.source.indexOf(valueLine);
			report(
				context.diagnostic({
					at: { offset, length: valueLine.length },
					detail: `frontmatter of ${frontmatter.lineCount} lines`,
					range: true,
					fix: { offset, length: valueLine.length + 1, content: "" },
				}),
			);
		}
	},
});

describe("MarkdownlintAdapter under markdownlint", () => {
	it("loads a real markdownlint", () => {
		// No minor pin: the copy is whatever the root's markdownlint-cli2
		// resolves, so a pin here would turn red on a toolchain bump that
		// changes nothing in this package. The support window is stated in
		// the README; this asserts only that the oracle is present.
		assert.match(helpers.getVersion(), /^\d+\.\d+\.\d+/);
		assert.strictEqual(typeof markdownlint.lint, "function");
	});

	describe("is byte-identical to systems' markdownlint rules on the golden corpus", () => {
		it("covers the whole corpus", () => {
			assert.strictEqual(golden.cases.length, 113);
		});
		for (const entry of golden.cases) {
			it(`case ${entry.id}: ${entry.sources[0] ?? ""}`, async () => {
				const results = await lintWith(entry.markdown, changesetRules);
				assert.deepStrictEqual(
					// markdownlint's own additions — `ruleInformation` and the
					// configured `severity` — are host configuration, not rule
					// output, and the golden does not carry them.
					results.map(({ ruleInformation: _information, severity: _severity, ...result }) => result),
					[...entry.markdownlint],
				);
			});
		}
	});

	it("reports the same findings as the programmatic host, renumbered by markdownlint itself", async () => {
		const text = "---\ntitle: x\n---\n\n# One\n\nBody\n\n# Two\n";
		const results = await lintWith(text, [promoteH1]);
		const programmatic = MarkdownLint.lint(text, [promoteH1]);
		assert.lengthOf(results, 2);
		assert.deepStrictEqual(
			results.map(({ lineNumber, errorDetail, errorContext, errorRange }) => ({
				lineNumber,
				errorDetail,
				errorContext,
				errorRange,
			})),
			programmatic.map(asResult),
		);
		assert.deepStrictEqual(
			results.map((result) => result.lineNumber),
			[5, 9],
		);
		assert.strictEqual(results[0]?.ruleInformation, "https://example.com/rules/promote-h1");
		assert.deepStrictEqual(results[0]?.errorRange, [1, 5]);
	});

	it("markdownlint applies the mapped fixInfo exactly as MarkdownEdit.applyAll applies the kit edit", async () => {
		for (const text of [
			"# One\n\nBody\n\n# Two\n",
			"# One\r\n\r\nBody\r\n\r\n# Two\r\n",
			"---\ntitle: x\n---\n\n# One\n\nBody\n",
			"Intro with *é* and 😀\n\n# Ünïcödé 😀\n",
		]) {
			const results = await lintWith(text, [promoteH1]);
			const edits = MarkdownLint.lint(text, [promoteH1]).flatMap((finding) => Option.toArray(finding.edit));
			assert.isAbove(results.length, 0, JSON.stringify(text));
			assert.strictEqual(helpers.applyFixes(text, results), MarkdownEdit.applyAll(text, edits), JSON.stringify(text));
		}
	});

	it("reports a finding inside the front matter with frontMatter numbering, and its whole-line delete applies", async () => {
		const text = "---\ntitle: x\nlayout: y\n---\n\n## Features\n";
		const results = await lintWith(text, [frontmatterRule]);
		assert.lengthOf(results, 1);
		assert.strictEqual(results[0]?.lineNumber, 2);
		assert.strictEqual(results[0]?.errorDetail, "frontmatter of 4 lines");
		assert.deepStrictEqual(results[0]?.errorRange, [1, 8]);
		assert.deepStrictEqual(results[0]?.fixInfo, { deleteCount: -1 });
		assert.strictEqual(helpers.applyFixes(text, results), "---\nlayout: y\n---\n\n## Features\n");
	});

	it("honours markdownlint's inline disable comments", async () => {
		const results = await lintWith("<!-- markdownlint-disable-next-line promote-h1 -->\n# One\n\n# Two\n", [promoteH1]);
		assert.deepStrictEqual(
			results.map((result) => result.lineNumber),
			[4],
		);
	});

	it("parses each file once, however many adapted rules run over it", async () => {
		const documents = new Set<unknown>();
		const seeing = (name: string) =>
			LintRule.make({
				names: [name],
				description: "Records the document it saw",
				tags: ["test"],
				check: (context) => {
					documents.add(context.document);
				},
			});
		await lintWith("# a\n", [seeing("seen-a"), seeing("seen-b"), seeing("seen-c")]);
		assert.strictEqual(documents.size, 1);
		await lintWith("# a\n", [seeing("seen-d")]);
		assert.strictEqual(documents.size, 2);
	});

	it("reports a document nested past the hardening cap once per rule, as the programmatic host does", async () => {
		const bomb = `${"> ".repeat(300)}deep\n`;
		const results = await lintWith(bomb, changesetRules);
		assert.lengthOf(results, changesetRules.length);
		for (const result of results)
			assert.match(result.errorDetail ?? "", /^Markdown parse failed: NestingDepthExceeded/);
		assert.deepStrictEqual(
			[...results].map((result) => result.errorDetail).sort(),
			MarkdownLint.lint(bomb, changesetRules)
				.map((finding) => Option.getOrNull(finding.detail))
				.sort(),
		);
	});

	it("forwards a named span on another line than the finding without markdownlint rejecting the range", async () => {
		const text = "# H\n\nA much longer paragraph line here\n";
		const crossRange = LintRule.make({
			names: ["cross-range"],
			description: "Reports at the heading, underlining the paragraph",
			tags: ["test"],
			check: (context, report) => {
				const heading = Option.getOrThrow(context.document.find("heading"));
				const paragraph = Option.getOrThrow(context.document.find("paragraph"));
				report(context.diagnostic({ at: heading, range: { offset: paragraph.position.start.offset + 10, length: 5 } }));
				report(context.diagnostic({ at: heading, range: { offset: heading.position.start.offset + 2, length: 1 } }));
			},
		});
		const results = await lintWith(text, [crossRange]);
		assert.deepStrictEqual(
			results.map(({ lineNumber, errorRange }) => ({ lineNumber, errorRange })),
			[
				{ lineNumber: 1, errorRange: null },
				{ lineNumber: 1, errorRange: [3, 1] },
			],
		);
		assert.deepStrictEqual(results.map(fromMarkdownlint), MarkdownLint.lint(text, [crossRange]).map(asResult));
	});

	it("agrees with the programmatic host on a BOM-prefixed file", async () => {
		const text = "\uFEFF# Title\n\n# Again\n";
		const results = await lintWith(text, [promoteH1]);
		assert.lengthOf(results, 2);
		assert.deepStrictEqual(results.map(fromMarkdownlint), MarkdownLint.lint(text, [promoteH1]).map(asResult));
	});

	it("accepts every adapted rule's metadata through markdownlint's own custom-rule validation", async () => {
		const results = await markdownlint.lint({
			strings: { input: "# x\n" },
			customRules: MarkdownlintAdapter.rules([...changesetRules, promoteH1, frontmatterRule]),
			config: { default: true },
		});
		assert.isDefined(results.input);
	});
});

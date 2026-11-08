// The changeset rules held to savvy-web/systems, which wrote them: the golden
// corpus @effected/markdown-lint captured from systems' two rule engines (its
// programmatic ChangesetLinter and its markdownlint rules) over every input
// systems' own rule tests lint. Read from that package rather than copied, so
// there is one corpus. See packages/markdown-lint/__test__/fixtures/changesets/README.md.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import type { LintDiagnostic, MarkdownlintRule } from "@effected/markdown-lint";
import { MarkdownLint, MarkdownlintAdapter } from "@effected/markdown-lint";
import { Option } from "effect";
import { ChangesetLint } from "../src/ChangesetLint.js";

interface ProgrammaticFinding {
	readonly rule: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
}

interface MarkdownlintFinding {
	readonly lineNumber: number;
	readonly ruleNames: ReadonlyArray<string>;
	readonly ruleDescription: string;
	readonly errorDetail: string | null;
	readonly errorContext: string | null;
	readonly errorRange: ReadonlyArray<number> | null;
	readonly fixInfo: unknown;
}

interface GoldenCase {
	readonly id: number;
	readonly sources: ReadonlyArray<string>;
	readonly markdown: string;
	readonly programmatic: ReadonlyArray<ProgrammaticFinding>;
	readonly markdownlint: ReadonlyArray<MarkdownlintFinding>;
}

const golden: { readonly cases: ReadonlyArray<GoldenCase> } = JSON.parse(
	readFileSync(
		fileURLToPath(new URL("../../markdown-lint/__test__/fixtures/changesets/golden.json", import.meta.url)),
		"utf8",
	),
);

// The markdownlint @effected/markdown-lint pins for its own host test: this
// package takes no dependency on it, and the specifier stays a variable so no
// source type resolves against its declarations.
interface MarkdownlintApi {
	readonly lint: (options: {
		readonly strings: Readonly<Record<string, string>>;
		readonly customRules: ReadonlyArray<MarkdownlintRule>;
		readonly config: Readonly<Record<string, unknown>>;
	}) => Promise<Record<string, ReadonlyArray<MarkdownlintFinding & { readonly ruleInformation: string | null }>>>;
}
const markdownlintSpecifier = new URL(
	"../../markdown-lint/node_modules/markdownlint/lib/exports-promise.mjs",
	import.meta.url,
).href;
const markdownlint: MarkdownlintApi = await import(markdownlintSpecifier);

const asMarkdownlint = (finding: LintDiagnostic) => ({
	lineNumber: finding.lineNumber,
	ruleNames: [...finding.ruleNames],
	errorDetail: Option.getOrNull(finding.detail),
	errorContext: Option.getOrNull(finding.context),
	errorRange: Option.match(finding.range, { onNone: () => null, onSome: (range) => [...range] }),
	fixInfo: Option.getOrNull(finding.fixInfo),
});

const fromGolden = (finding: MarkdownlintFinding) => ({
	lineNumber: finding.lineNumber,
	ruleNames: [...finding.ruleNames],
	errorDetail: finding.errorDetail,
	errorContext: finding.errorContext,
	errorRange: finding.errorRange === null ? null : [...finding.errorRange],
	fixInfo: finding.fixInfo,
});

const asProgrammatic = (finding: LintDiagnostic): ProgrammaticFinding => ({
	rule: finding.ruleNames[0],
	line: finding.lineNumber,
	column: finding.column,
	message: Option.getOrElse(finding.detail, () => ""),
});

/** markdownlint's result order: first rule name, then line, stable. */
const markdownlintOrder = <A extends { readonly ruleNames: ReadonlyArray<string>; readonly lineNumber: number }>(
	findings: ReadonlyArray<A>,
): Array<A> =>
	[...findings].sort(
		(a, b) => (a.ruleNames[0] ?? "").localeCompare(b.ruleNames[0] ?? "") || a.lineNumber - b.lineNumber,
	);

const signature = (findings: ReadonlyArray<{ rule: string; line: number; message: string }>): string =>
	JSON.stringify(findings.map((finding) => `${finding.rule}|${finding.line}|${finding.message}`).sort());

const systemsEnginesAgree = (entry: GoldenCase): boolean =>
	signature(entry.programmatic) ===
	signature(
		entry.markdownlint.map((finding) => ({
			rule: finding.ruleNames[0] ?? "",
			line: finding.lineNumber,
			message: finding.errorDetail ?? "",
		})),
	);

describe("ChangesetLint", () => {
	it("names CSH001 to CSH005, each linking its documentation", () => {
		assert.deepStrictEqual(
			ChangesetLint.rules.map((rule) => [...rule.names]),
			[
				["changeset-heading-hierarchy", "CSH001"],
				["changeset-required-sections", "CSH002"],
				["changeset-content-structure", "CSH003"],
				["changeset-dependency-table-format", "CSH005"],
				["changeset-uncategorized-content", "CSH004"],
			],
		);
		for (const rule of ChangesetLint.rules) {
			assert.strictEqual(
				rule.information,
				`https://github.com/savvy-web/systems/blob/main/packages/silk-effects/docs/rules/${rule.names[1]}.md`,
			);
		}
		assert.strictEqual(ChangesetLint.headingHierarchy, ChangesetLint.rules[0]);
		assert.strictEqual(ChangesetLint.uncategorizedContent, ChangesetLint.rules[4]);
	});

	it("lints a file's text, counting lines from the top of its front matter", () => {
		const findings = ChangesetLint.lint('---\n"@effected/a": patch\n---\n\n# Title\n\nLoose text.\n');
		assert.deepStrictEqual(
			findings.map((finding) => [finding.ruleNames[1], finding.lineNumber]),
			[
				["CSH001", 5],
				["CSH004", 7],
			],
		);
		assert.deepStrictEqual(ChangesetLint.lint('---\n"@effected/a": patch\n---\n\n## Features\n\n- A thing.\n'), []);
	});

	// Input classes the golden corpus lacks, where systems' two engines part.
	// The expected verdicts are systems' markdownlint engine's (systems at the
	// golden's commit, markdownlint 0.42.0), the engine markdownlint-cli2 and the
	// pre-commit hook run, and both hosts must give them.
	describe("follows systems' markdownlint engine where its programmatic one differs", () => {
		const F = '---\n"@x/a": patch\n---\n\n';
		const classes: ReadonlyArray<readonly [string, string, ReadonlyArray<readonly [string, number]>]> = [
			[
				"R1: a formatted h2 is compared as written, so it is no category",
				`${F}## \`Features\`\n\n- x\n\n## *Bug Fixes*\n\n- y\n`,
				[
					["CSH002", 5],
					["CSH002", 9],
				],
			],
			[
				"R2: indented code has no fence, so only the fence is checked",
				`${F}## Features\n\n    const a = 1;\n\n\`\`\`\nb\n\`\`\`\n`,
				[["CSH003", 9]],
			],
			["R3: an item of only an HTML comment is empty", `${F}## Features\n\n- <!-- todo -->\n- real\n`, [["CSH003", 7]]],
			["R4: an item of only an image is not empty", `${F}## Features\n\n- ![](shot.png)\n`, []],
			[
				"R5: a setext h2 inside an item is no section, and leaves the item empty",
				`${F}## Features\n\n- a\n  -\n`,
				[["CSH003", 7]],
			],
			["R6: an h2 inside a block quote is no section", `${F}## Features\n\n> ## Bogus\n> text\n`, []],
			[
				"R7: a setext h2 under a definition reports on the definition's line",
				`${F}## Features\n\n- x\n\n[ref]: https://x.test\nSub\n---\n`,
				[
					["CSH002", 9],
					["CSH003", 9],
				],
			],
			[
				"R9: a short row has too few columns, and cells are read as written",
				`${F}## Dependencies\n\n| Dependency | Type | Action | From | To |\n| --- | --- | --- | --- | --- |\n| effect | dependency |\n| \`effect\` | dependency | updated | \`1.0.0\` | 2.0.0 |\n`,
				[
					["CSH005", 9],
					["CSH005", 10],
				],
			],
			[
				"R10: a multi-line heading reads on one line",
				`${F}## Features\n\n- a\n\nLine one\nLine two\n---\n`,
				[
					["CSH002", 9],
					["CSH003", 9],
				],
			],
		];
		const ordered = (found: ReadonlyArray<readonly [string, number]>) =>
			[...found].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);

		for (const [name, text, expected] of classes) {
			it(name, async () => {
				const programmatic = ChangesetLint.lint(text);
				assert.deepStrictEqual(
					ordered(programmatic.map((d) => [d.ruleNames[1] ?? "", d.lineNumber] as const)),
					ordered(expected),
				);
				const config: Record<string, unknown> = { default: false };
				for (const rule of ChangesetLint.rules) config[rule.name] = true;
				const hosted = await markdownlint.lint({
					strings: { input: text },
					customRules: MarkdownlintAdapter.rules(ChangesetLint.rules),
					config,
				});
				assert.deepStrictEqual(
					(hosted.input ?? []).map(fromGolden),
					markdownlintOrder(programmatic).map(asMarkdownlint),
				);
			});
		}

		it("R1 and R10 name the heading as written, on one line", () => {
			const details = [
				...ChangesetLint.lint(classes[0]?.[1] ?? ""),
				...ChangesetLint.lint(classes[8]?.[1] ?? ""),
			].flatMap((d) => (d.ruleNames[1] === "CSH002" ? [Option.getOrElse(d.detail, () => "")] : []));
			assert.deepStrictEqual(
				details.map((detail) => detail.slice(0, detail.indexOf(". Valid"))),
				['Unknown section "`Features`"', 'Unknown section "*Bug Fixes*"', 'Unknown section "Line one Line two"'],
			);
		});

		it("R9 reads the from cell with its backticks, as markdownlint does", () => {
			const details = ChangesetLint.lint(classes[7]?.[1] ?? "").map((d) => Option.getOrElse(d.detail, () => ""));
			assert.match(details[0] ?? "", /^Dependencies table row has too few columns \(expected 5, got 2\)/);
			assert.match(details[1] ?? "", /^Invalid 'from' value '`1\.0\.0`'/);
		});

		// markdownlint's micromark reads a bare `- ` or `1. ` after an indented
		// code block as a paragraph, where CommonMark (and the kit parser) read an
		// empty list item. A rule over the parsed tree cannot see the difference;
		// pinned so it stays a known parser divergence rather than a rule's.
		for (const marker of ["- ", "1. "]) {
			it(`R8: an empty \`${marker.trim()}\` item after indented code is reported, where markdownlint's parser sees a paragraph`, () => {
				const text = `${F}## Features\n\n    code\n\n${marker}\n`;
				assert.deepStrictEqual(
					ChangesetLint.lint(text).map((d) => [d.ruleNames[1], d.lineNumber]),
					[["CSH003", 9]],
				);
			});
		}
	});

	describe("over the golden corpus", () => {
		it("loads all 113 inputs, with findings from every rule", () => {
			assert.strictEqual(golden.cases.length, 113);
			const ruled = new Set(golden.cases.flatMap((entry) => entry.markdownlint.map((f) => f.ruleNames[1])));
			assert.deepStrictEqual([...ruled].sort(), ["CSH001", "CSH002", "CSH003", "CSH004", "CSH005"]);
		});

		it("equals systems' markdownlint engine on every input and its programmatic engine on the 102 they agree on", () => {
			let agreeing = 0;
			for (const entry of golden.cases) {
				const findings = MarkdownLint.lint(entry.markdown, ChangesetLint.rules);
				assert.deepStrictEqual(
					markdownlintOrder(findings).map(asMarkdownlint),
					entry.markdownlint.map(fromGolden),
					`case ${entry.id}`,
				);
				if (systemsEnginesAgree(entry)) {
					agreeing++;
					assert.deepStrictEqual(findings.map(asProgrammatic), [...entry.programmatic], `case ${entry.id}`);
				}
			}
			assert.strictEqual(agreeing, 102);
		});

		it("the comparison can fail: a changed message does not pass", () => {
			const entry = golden.cases.find((candidate) => candidate.markdownlint.length > 0) as GoldenCase;
			const findings = markdownlintOrder(MarkdownLint.lint(entry.markdown, ChangesetLint.rules)).map(asMarkdownlint);
			const mutated = entry.markdownlint.map(fromGolden).map((f, i) => (i === 0 ? { ...f, errorDetail: "x" } : f));
			assert.throws(() => assert.deepStrictEqual(findings, mutated));
		});

		it("runs in markdownlint through MarkdownlintAdapter with the same output", async () => {
			const config: Record<string, unknown> = { default: false };
			for (const rule of ChangesetLint.rules) config[rule.name] = true;
			const strings = Object.fromEntries(golden.cases.map((entry) => [String(entry.id), entry.markdown]));
			const results = await markdownlint.lint({
				strings,
				customRules: MarkdownlintAdapter.rules(ChangesetLint.rules),
				config,
			});
			for (const entry of golden.cases) {
				const found = results[String(entry.id)] ?? [];
				assert.deepStrictEqual(found.map(fromGolden), entry.markdownlint.map(fromGolden), `case ${entry.id}`);
				for (const finding of found) assert.match(finding.ruleInformation ?? "", /\/CSH00\d\.md$/);
			}
		});
	});
});

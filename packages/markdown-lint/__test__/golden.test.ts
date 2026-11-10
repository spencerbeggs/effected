// The golden corpus, kept as an engine-fidelity corpus: savvy-web's changeset
// house-style rules, which savvy-web owns and the kit does not ship, copied
// under __test__/rules/ as test fixtures only. They are savvy-web/systems' five
// changeset rules, each of which
// systems implements twice (a kit-node rule for its programmatic linter, a
// micromark-token rule for markdownlint-cli2), held to byte-identical output
// by ONE definition per rule under both of this package's hosts.
//
// `programmatic` is systems' ChangesetLinter.validateContent output and
// `markdownlint` is markdownlint's own lint result for systems' markdownlint
// rules, both captured from systems over every markdown input its own rule
// tests lint (see fixtures/changesets/README.md). The two systems engines
// disagree on some CSH005 inputs; one definition can equal only one of them,
// and the port follows the markdownlint engine — pinned below as an exact
// count, so a new disagreement cannot hide inside the exemption.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import type { LintDiagnostic } from "../src/LintDiagnostic.js";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { changesetRules } from "./rules/index.js";

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
	readFileSync(join(import.meta.dirname, "fixtures", "changesets", "golden.json"), "utf8"),
);

const asProgrammatic = (finding: LintDiagnostic): ProgrammaticFinding => ({
	rule: finding.ruleNames[0],
	line: finding.lineNumber,
	column: finding.column,
	message: Option.getOrElse(finding.detail, () => ""),
});

/** The (rule, line, message) multiset two engines are compared on. */
const signature = (findings: ReadonlyArray<{ rule: string; line: number; message: string }>): Array<string> =>
	findings.map((finding) => `${finding.rule}|${finding.line}|${finding.message}`).sort();

/** markdownlint's result order: first rule name, then line, stable. */
const markdownlintOrder = <A extends { readonly ruleNames: ReadonlyArray<string>; readonly lineNumber: number }>(
	findings: ReadonlyArray<A>,
): Array<A> =>
	[...findings].sort(
		(a, b) => (a.ruleNames[0] ?? "").localeCompare(b.ruleNames[0] ?? "") || a.lineNumber - b.lineNumber,
	);

const systemsEnginesAgree = (entry: GoldenCase): boolean =>
	JSON.stringify(signature(entry.programmatic)) ===
	JSON.stringify(
		signature(
			entry.markdownlint.map((finding) => ({
				rule: finding.ruleNames[0] ?? "",
				line: finding.lineNumber,
				message: finding.errorDetail ?? "",
			})),
		),
	);

describe("golden corpus", () => {
	it("loads the whole corpus, with findings from every rule", () => {
		// A silently-empty or truncated corpus would make every loop below vacuous.
		assert.strictEqual(golden.cases.length, 113);
		const ruled = new Set(golden.cases.flatMap((entry) => entry.markdownlint.map((finding) => finding.ruleNames[1])));
		assert.deepStrictEqual([...ruled].sort(), ["CSH001", "CSH002", "CSH003", "CSH004", "CSH005"]);
		assert.isAbove(golden.cases.filter((entry) => entry.markdownlint.length === 0).length, 10);
		assert.isAbove(golden.cases.filter((entry) => entry.markdownlint.length > 0).length, 50);
	});

	it("the systems engines disagree on exactly eleven inputs, all CSH005", () => {
		const disagreeing = golden.cases.filter((entry) => !systemsEnginesAgree(entry));
		assert.strictEqual(disagreeing.length, 11);
		for (const entry of disagreeing) {
			const rules = new Set([
				...entry.programmatic.map((finding) => finding.rule),
				...entry.markdownlint.map((finding) => finding.ruleNames[0]),
			]);
			assert.deepStrictEqual([...rules], ["changeset-dependency-table-format"], `case ${entry.id}`);
		}
	});

	describe("the programmatic host", () => {
		for (const entry of golden.cases) {
			it(`case ${entry.id}: ${entry.sources[0] ?? ""}`, () => {
				const findings = MarkdownLint.lint(entry.markdown, changesetRules);
				// Byte-identical to markdownlint's result, every field it carries.
				assert.deepStrictEqual(
					markdownlintOrder(findings).map((finding) => ({
						lineNumber: finding.lineNumber,
						ruleNames: [...finding.ruleNames],
						errorDetail: Option.getOrNull(finding.detail),
						errorContext: Option.getOrNull(finding.context),
						errorRange: Option.match(finding.range, { onNone: () => null, onSome: (range) => [...range] }),
						fixInfo: Option.getOrNull(finding.fixInfo),
					})),
					entry.markdownlint.map((finding) => ({
						lineNumber: finding.lineNumber,
						ruleNames: [...finding.ruleNames],
						errorDetail: finding.errorDetail,
						errorContext: finding.errorContext,
						errorRange: finding.errorRange === null ? null : [...finding.errorRange],
						fixInfo: finding.fixInfo,
					})),
				);
				// Byte-identical to systems' programmatic linter — order, line,
				// column and message — wherever the two systems engines agree.
				if (systemsEnginesAgree(entry)) {
					assert.deepStrictEqual(findings.map(asProgrammatic), [...entry.programmatic]);
				}
			});
		}
	});

	// Outside the corpus, pinned so it is a decision rather than a surprise:
	// GFM pads a short table row to the header's width, and the kit tree
	// carries the padding as zero-width cells, so the port never sees "too few
	// columns" — where systems' micromark rule does, the port reports the
	// padded cells as empty values instead.
	it("a short dependency row reads as padded empty cells, not as too few columns", () => {
		const markdown = [
			"## Dependencies",
			"",
			"| Dependency | Type | Action | From | To |",
			"| --- | --- | --- | --- | --- |",
			"| effect | dependency |",
			"",
		].join("\n");
		const details = MarkdownLint.lint(markdown, changesetRules).map((finding) => Option.getOrNull(finding.detail));
		assert.lengthOf(details, 1);
		assert.match(details[0] ?? "", /^Invalid dependency action ''/);
		assert.notMatch(details[0] ?? "", /too few columns/);
	});
});

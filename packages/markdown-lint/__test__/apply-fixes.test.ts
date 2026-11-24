// MarkdownLint.applyFixes: markdownlint's fix policy over kit edits. Each case
// runs a probe rule reporting the given edits, applies the findings, and
// requires the text markdownlint's own applyFixes makes of the same fixes
// (reported through the adapter), as well as the text written out here.

import { assert, describe, it } from "@effect/vitest";
import { applyFixesCounted } from "../src/internal/apply-fixes.js";
import { LintRule } from "../src/LintRule.js";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { MarkdownlintAdapter } from "../src/MarkdownlintAdapter.js";
import type { LintEditLike } from "../src/PositionMapping.js";
import { rules } from "../src/rules/all.js";
import { MD012 } from "../src/rules/MD012.js";
import { MD022 } from "../src/rules/MD022.js";
import { markdownlintLint, oracleApplyFixes, oracleLint } from "./helpers/markdownlint-oracle.js";

// Reports one finding per edit, at the edit's offset.
const reporting = (edits: ReadonlyArray<LintEditLike>) =>
	LintRule.make({
		names: ["fixes-probe"],
		description: "Reports the given fixes",
		tags: ["probe"],
		check: (context, report) => {
			for (const fix of edits) report(context.diagnostic({ at: { offset: fix.offset, length: 0 }, fix }));
		},
	});

// What markdownlint's own applyFixes makes of the rule's fixes, reported through the adapter.
const viaMarkdownlint = (source: string, rule: LintRule): string => {
	const results = markdownlintLint({
		strings: { input: source },
		customRules: [MarkdownlintAdapter.rule(rule)],
		config: { default: false, [rule.name]: true },
	}).input;
	return oracleApplyFixes(source, results ?? []);
};

const check = (source: string, edits: ReadonlyArray<LintEditLike>, expected: string) => {
	const rule = reporting(edits);
	const fixed = MarkdownLint.applyFixes(source, MarkdownLint.lint(source, [rule]));
	assert.strictEqual(fixed, expected, "kit");
	assert.strictEqual(viaMarkdownlint(source, rule), expected, "markdownlint");
};

describe("MarkdownLint.applyFixes", () => {
	it("applies fixes that do not meet, anywhere in the text", () => {
		check(
			"one\ntwo\n",
			[
				{ offset: 0, length: 3, content: "ONE" },
				{ offset: 4, length: 0, content: ">" },
			],
			"ONE\n>two\n",
		);
	});

	it("applies an identical fix once", () => {
		check(
			"a\nb\n",
			[
				{ offset: 2, length: 0, content: "\n" },
				{ offset: 2, length: 0, content: "\n" },
			],
			"a\n\nb\n",
		);
	});

	it("applies one insert at a position, the longest", () => {
		check(
			"a\nb\n",
			[
				{ offset: 2, length: 0, content: "\n" },
				{ offset: 2, length: 0, content: "\n\n" },
			],
			"a\n\n\nb\n",
		);
	});

	it("makes an insert and a delete at one column one replace", () => {
		check(
			"abc\n",
			[
				{ offset: 1, length: 0, content: "X" },
				{ offset: 1, length: 1, content: "" },
			],
			"aXc\n",
		);
	});

	it("skips a fix that runs into the one to its right on its line", () => {
		check(
			"abcdef\n",
			[
				{ offset: 1, length: 3, content: "" },
				{ offset: 3, length: 2, content: "" },
			],
			"abcf\n",
		);
	});

	it("lets a whole-line delete take the other fixes on its line", () => {
		check(
			"keep\ndrop me\nkeep\n",
			[
				{ offset: 5, length: 8, content: "" },
				{ offset: 7, length: 2, content: "" },
			],
			"keep\nkeep\n",
		);
	});

	it("applies MD022's two requests for one blank line once each", () => {
		const source = "# A\n## B\n### C\n";
		const findings = MarkdownLint.lint(source, [MD022]);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings), "# A\n\n## B\n\n### C\n");
		const builtIn = oracleLint(source, { default: false, MD022: true });
		assert.strictEqual(oracleApplyFixes(source, builtIn), "# A\n\n## B\n\n### C\n");
	});

	it("deletes every line of an all-blank document under MD012 maximum 0", () => {
		for (const source of ["\n\n", "\n\n\n"]) {
			const findings = MarkdownLint.lint(source, [MD012], { config: { default: false, MD012: { maximum: 0 } } });
			assert.strictEqual(MarkdownLint.applyFixes(source, findings), "", JSON.stringify(source));
		}
	});

	it("returns one line ending throughout, the one the text uses most, as markdownlint's applyFixes does", () => {
		const config = Object.fromEntries([["default", false], ...rules.map((rule) => [rule.name, true])]);
		for (const [source, expected] of [
			["# A\r\n## B\n### C\r\n", "# A\r\n\r\n## B\r\n\r\n### C\r\n"],
			["text\r\n# H\ntext\n", "text\n\n# H\n\ntext\n"],
		] as const) {
			const fixed = MarkdownLint.applyFixes(source, MarkdownLint.lint(source, rules, { config }));
			assert.strictEqual(fixed, expected, JSON.stringify(source));
			assert.strictEqual(oracleApplyFixes(source, oracleLint(source, config)), expected, JSON.stringify(source));
		}
	});

	it("normalizes line endings, a lone CR included, even when no fix applies", () => {
		const source = "a\r\nb\rc\nd\n";
		assert.strictEqual(MarkdownLint.applyFixes(source, []), "a\nb\nc\nd\n");
		assert.strictEqual(oracleApplyFixes(source, []), "a\nb\nc\nd\n");
	});

	it("counts an edit the splice must skip, which markdownlint's policy never reaches", () => {
		// Two cross-line edits on different lines whose spans overlap: the line policy chooses both.
		const source = "ab\ncd\nef\n";
		const rule = reporting([
			{ offset: 1, length: 4, content: "" },
			{ offset: 4, length: 2, content: "" },
		]);
		const counted = applyFixesCounted(source, MarkdownLint.lint(source, [rule]));
		assert.strictEqual(counted.skipped, 1);
		assert.strictEqual(counted.text, "ab\ncef\n");
		// The control: edits that do not overlap skip nothing.
		const clean = reporting([{ offset: 1, length: 1, content: "" }]);
		assert.strictEqual(applyFixesCounted(source, MarkdownLint.lint(source, [clean])).skipped, 0);
	});

	it("addresses a byte-order-marked source as given and ignores findings without a fix", () => {
		const source = "﻿a \n";
		const rule = reporting([{ offset: 0, length: 1, content: "" }]);
		const findings = MarkdownLint.lint(source, [rule]);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings), "﻿ \n");
		assert.strictEqual(MarkdownLint.applyFixes(source, []), source);
		assert.strictEqual(MarkdownLint.applyFixes("\uFEFFa\r\nb\n\n", []), "\uFEFFa\nb\n\n");
	});
});

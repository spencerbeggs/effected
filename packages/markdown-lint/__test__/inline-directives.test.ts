// InlineDirectives: a port of markdownlint's getEnabledRulesPerLineNumber.
// Probe rules A and B come from the LintConfig tests; each case pins one
// directive and reads the per-line state of one rule.

import { assert, describe, it } from "@effect/vitest";
import { InlineDirectives } from "../src/InlineDirectives.js";
import { LintRule } from "../src/LintRule.js";

const A = LintRule.make({ names: ["AAA001", "alpha"], description: "a", tags: ["t1"], check: () => {} });
const B = LintRule.make({ names: ["BBB002"], description: "b", tags: ["t1", "t2"], check: () => {} });
const rules = [A, B];

const run = (lines: ReadonlyArray<string>, config = {}, options?: { readonly noInlineConfig?: boolean }) =>
	InlineDirectives.resolve(lines, config, rules, options);

/** Rule state for lines 1..n. */
const states = (lines: ReadonlyArray<string>, rule: "AAA001" | "BBB002", config = {}) => {
	const { enabledPerLine } = run(lines, config);
	return lines.map((_, index) => enabledPerLine[index + 1]?.get(rule));
};

describe("InlineDirectives.resolve", () => {
	it("disables every rule from a bare disable on, and enable re-enables one by name", () => {
		const lines = ["a", "<!-- markdownlint-disable -->", "b", "<!-- markdownlint-enable alpha -->", "c"];
		assert.deepStrictEqual(states(lines, "AAA001"), [true, false, false, true, true]);
		assert.deepStrictEqual(states(lines, "BBB002"), [true, false, false, false, false]);
	});

	it("limits disable-next-line to the following line", () => {
		const lines = ["<!-- markdownlint-disable-next-line AAA001 -->", "x", "y"];
		assert.deepStrictEqual(states(lines, "AAA001"), [true, false, true]);
	});

	it("limits disable-line to its own line", () => {
		const lines = ["x", "y <!-- markdownlint-disable-line AAA001 -->", "z"];
		assert.deepStrictEqual(states(lines, "AAA001"), [true, false, true]);
	});

	it("returns to the captured state on restore", () => {
		const lines = [
			"<!-- markdownlint-capture -->",
			"<!-- markdownlint-disable AAA001 -->",
			"x",
			"<!-- markdownlint-restore -->",
			"y",
		];
		assert.deepStrictEqual(states(lines, "AAA001"), [true, false, false, true, true]);
	});

	it("applies disable-file on the last line to line 1", () => {
		const lines = ["x", "y", "<!-- markdownlint-disable-file BBB002 -->"];
		assert.deepStrictEqual(states(lines, "BBB002"), [false, false, false]);
		assert.deepStrictEqual(states(lines, "AAA001"), [true, true, true]);
	});

	it("applies configure-file everywhere and reports it in effective", () => {
		const lines = ["x", '<!-- markdownlint-configure-file { "bbb002": false } -->', "y"];
		const result = run(lines);
		assert.deepStrictEqual(states(lines, "BBB002"), [false, false, false]);
		assert.strictEqual(result.effective.enabled.get("BBB002"), false);
		assert.strictEqual(result.effective.enabled.get("AAA001"), true);
	});

	it("ignores configure-file with invalid JSON or a non-object payload", () => {
		for (const payload of ["{ nope", "[1]", "3"]) {
			const lines = [`<!-- markdownlint-configure-file ${payload} -->`];
			assert.deepStrictEqual(states(lines, "BBB002"), [true], payload);
		}
	});

	it("applies two comments on one line left to right", () => {
		const lines = ["<!-- markdownlint-disable AAA001 --> <!-- markdownlint-enable AAA001 -->", "x"];
		assert.deepStrictEqual(states(lines, "AAA001"), [true, true]);
		const reversed = ["<!-- markdownlint-enable AAA001 --> <!-- markdownlint-disable AAA001 -->", "x"];
		assert.deepStrictEqual(states(reversed, "AAA001"), [false, false]);
	});

	it("ignores a comment with no closing -->", () => {
		const lines = ["<!-- markdownlint-disable AAA001", "x"];
		assert.deepStrictEqual(states(lines, "AAA001"), [true, true]);
	});

	it("matches actions and names case-insensitively, and a tag where a rule name goes", () => {
		const lines = ["<!-- MarkdownLint-DISABLE T2 -->", "x"];
		assert.deepStrictEqual(states(lines, "BBB002"), [false, false]);
		assert.deepStrictEqual(states(lines, "AAA001"), [true, true]);
		const byAlias = ["<!-- markdownlint-disable Alpha -->", "x"];
		assert.deepStrictEqual(states(byAlias, "AAA001"), [false, false]);
	});

	it("ignores every comment under noInlineConfig", () => {
		const lines = ["<!-- markdownlint-disable -->", '<!-- markdownlint-configure-file { "aaa001": false } -->', "x"];
		const { enabledPerLine, effective } = run(lines, {}, { noInlineConfig: true });
		assert.deepStrictEqual(
			lines.map((_, index) => enabledPerLine[index + 1]?.get("AAA001")),
			[true, true, true],
		);
		assert.strictEqual(effective.enabled.get("AAA001"), true);
	});

	it("starts each line from the configured state", () => {
		assert.deepStrictEqual(states(["x", "y"], "AAA001", { default: false }), [false, false]);
	});
});

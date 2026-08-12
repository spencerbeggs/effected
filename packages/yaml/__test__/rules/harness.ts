// The shared per-rule fixture harness (#129): one harness, N rule fixture
// sets, each fixture a triple — input → expected diagnostics → expected
// fixed output where a fix exists. Uniform structure is the point: a
// per-rule bespoke test file is how a rule set drifts into thirteen
// dialects of "tested".
//
// The harness also carries the MUTATION PROOFS: for every rule it runs the
// dead-rule mutant (no diagnostics) and — where fixes are expected — the
// unfixing mutant (diagnostics without their fixes), and asserts each
// mutant fails the fixture set. A rule whose fixtures cannot fail is not
// tested.

import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import type { YamlLintRuleSetting, YamlRule } from "../../src/index.js";
import { YamlLint, YamlLintConfig, YamlLintDiagnostic } from "../../src/index.js";

/** Positional subset-match expectation for one diagnostic. */
export interface ExpectedDiagnostic {
	readonly line: number;
	readonly character?: number;
	readonly length?: number;
	readonly severity?: "error" | "warning";
	readonly messageIncludes?: string;
}

/** One rule fixture: input → expected diagnostics (→ fixed output). */
export interface RuleFixture {
	readonly name: string;
	readonly input: string;
	readonly expected: ReadonlyArray<ExpectedDiagnostic>;
	/** Expected `YamlLint.fix` output; present only when the rule fixes this shape. */
	readonly fixed?: string;
	/** Config entry for the rule (defaults to `"error"`). */
	readonly setting?: YamlLintRuleSetting;
	/**
	 * Declares the input DELIBERATELY broken: the harness otherwise fails any
	 * fixture whose input carries parse-validity errors, because an
	 * expectation against a rejected document asserts nothing (the vacuous-
	 * fixture trap). The guard is bidirectional — an opted-out fixture whose
	 * input actually parses cleanly fails too, so opt-outs cannot go stale.
	 */
	readonly expectsParseErrors?: boolean;
}

/**
 * Resolve a built-in rule by id, throwing a named error when absent — the
 * ONE lookup every rule test file shares, so a missing builtin fails the
 * test that uses it instead of surfacing as a module-collection error.
 */
export function builtin(id: string): YamlRule {
	const rule = YamlLint.builtins.find((r) => r.id === id);
	if (rule === undefined) {
		throw new Error(`builtin rule "${id}" is not in YamlLint.builtins`);
	}
	return rule;
}

const configFor = (rule: YamlRule, setting?: YamlLintRuleSetting): YamlLintConfig =>
	rule.id === "parse-validity"
		? YamlLintConfig.make({ rules: {} })
		: YamlLintConfig.make({ rules: { [rule.id]: setting ?? "error" } });

const ruleFindings = (rule: YamlRule, fixture: RuleFixture, impl: YamlRule = rule): ReadonlyArray<YamlLintDiagnostic> =>
	YamlLint.run(fixture.input, [impl], configFor(rule, fixture.setting)).filter((d) => d.rule === rule.id);

/** Register the uniform fixture suite (and mutation proofs) for one rule. */
export function testRule(rule: YamlRule, fixtures: ReadonlyArray<RuleFixture>): void {
	describe(`rule ${rule.id}`, () => {
		for (const fixture of fixtures) {
			it(fixture.name, () => {
				// Parse-clean guard: expectations against a rejected document
				// assert nothing.
				const parseErrors = YamlLint.run(
					fixture.input,
					YamlLint.builtins.filter((r) => r.id === "parse-validity"),
					YamlLintConfig.make({ rules: {} }),
				).filter((d) => d.severity === "error");
				if (fixture.expectsParseErrors === true) {
					assert.isAbove(parseErrors.length, 0, "fixture declares parse errors but its input parses cleanly");
				} else {
					assert.strictEqual(
						parseErrors.length,
						0,
						`fixture input must parse cleanly (or declare expectsParseErrors): ${parseErrors
							.map((d) => `${d.line}:${d.character} ${d.message}`)
							.join(" | ")}`,
					);
				}
				const diagnostics = ruleFindings(rule, fixture);
				assert.strictEqual(
					diagnostics.length,
					fixture.expected.length,
					`expected ${fixture.expected.length} diagnostic(s), got ${diagnostics.length}: ${diagnostics
						.map((d) => `${d.line}:${d.character} ${d.message}`)
						.join(" | ")}`,
				);
				fixture.expected.forEach((expected, i) => {
					const actual = diagnostics[i] as YamlLintDiagnostic;
					assert.strictEqual(actual.line, expected.line, `diagnostic ${i} line`);
					if (expected.character !== undefined) {
						assert.strictEqual(actual.character, expected.character, `diagnostic ${i} character`);
					}
					if (expected.length !== undefined) {
						assert.strictEqual(actual.length, expected.length, `diagnostic ${i} length`);
					}
					if (expected.severity !== undefined) {
						assert.strictEqual(actual.severity, expected.severity, `diagnostic ${i} severity`);
					}
					if (expected.messageIncludes !== undefined) {
						assert.include(actual.message, expected.messageIncludes, `diagnostic ${i} message`);
					}
					// Every reported span must be inside the document.
					assert.isAtLeast(actual.offset, 0);
					assert.isAtMost(actual.offset + actual.length, fixture.input.length);
				});
				if (fixture.fixed !== undefined) {
					const result = YamlLint.fix(fixture.input, [rule], configFor(rule, fixture.setting));
					assert.isTrue(Result.isSuccess(result), "fix must succeed on a parseable fixture");
					if (Result.isSuccess(result)) {
						assert.strictEqual(result.success, fixture.fixed);
					}
				}
			});
		}

		it("mutation proof: the dead-rule mutant fails the fixture set", () => {
			const dead: YamlRule = { id: rule.id, check: () => [] };
			const discriminates = fixtures.some(
				(fixture) => fixture.expected.length !== ruleFindings(rule, fixture, dead).length,
			);
			assert.isTrue(
				discriminates,
				"at least one fixture must expect a diagnostic, or a dead rule passes the whole set",
			);
		});

		const fixing = fixtures.filter((f) => f.fixed !== undefined && f.fixed !== f.input);
		if (fixing.length > 0) {
			it("mutation proof: the unfixing mutant fails the fixed expectations", () => {
				const unfixing: YamlRule = {
					id: rule.id,
					check: (ctx, options) =>
						[...rule.check(ctx, options)].map(({ fix: _fix, ...rest }) => new YamlLintDiagnostic(rest)),
				};
				const discriminates = fixing.some((fixture) => {
					const result = YamlLint.fix(fixture.input, [unfixing], configFor(rule, fixture.setting));
					return Result.isSuccess(result) && result.success !== fixture.fixed;
				});
				assert.isTrue(discriminates, "stripping fixes must change some fixture's fixed output");
			});
		}
	});
}

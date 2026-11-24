// LintConfig: a port of markdownlint's getEffectiveConfig. Two probe rules
// share tag t1; B also carries t2, so tag and name keys can be told apart.

import { assert, describe, it } from "@effect/vitest";
import type { LintConfigRecord } from "../src/LintConfig.js";
import { LintConfig } from "../src/LintConfig.js";
import { LintRule } from "../src/LintRule.js";

const A = LintRule.make({ names: ["AAA001", "alpha"], description: "a", tags: ["t1"], check: () => {} });
const B = LintRule.make({ names: ["BBB002"], description: "b", tags: ["t1", "t2"], check: () => {} });
const rules = [A, B];

const resolve = (config: LintConfigRecord) => {
	const result = LintConfig.effective(config, rules);
	const view = (rule: LintRule) => ({
		enabled: result.enabled.get(LintConfig.key(rule)),
		severity: result.severity.get(LintConfig.key(rule)),
		settings: result.settings.get(LintConfig.key(rule)),
	});
	return { a: view(A), b: view(B) };
};

const on = { enabled: true, severity: "error" as const, settings: {} };
const off = { enabled: false, severity: "error" as const, settings: {} };

describe("LintConfig.effective", () => {
	it("enables every rule as an error with no settings by default", () => {
		assert.deepStrictEqual(resolve({}), { a: on, b: on });
	});

	it("disables every rule for default false, whatever its case", () => {
		assert.deepStrictEqual(resolve({ default: false }), { a: off, b: off });
		assert.deepStrictEqual(resolve({ DeFaULt: false }), { a: off, b: off });
	});

	it("takes the default severity from default: warning", () => {
		const warning = { enabled: true, severity: "warning" as const, settings: {} };
		assert.deepStrictEqual(resolve({ default: "warning" }), { a: warning, b: warning });
	});

	it("lets a rule alias re-enable one rule under default false", () => {
		assert.deepStrictEqual(resolve({ default: false, alpha: true }), { a: on, b: off });
	});

	it("applies a tag to every rule carrying it, then a name's settings", () => {
		assert.deepStrictEqual(resolve({ t1: false, bbb002: { severity: "warning", x: 1 } }), {
			a: off,
			b: { enabled: true, severity: "warning" as const, settings: { x: 1 } },
		});
	});

	it("lets the later key win", () => {
		assert.deepStrictEqual(resolve({ bbb002: true, t2: false }).b, off);
	});

	it("strips enabled and severity from settings", () => {
		assert.deepStrictEqual(resolve({ aaa001: { enabled: false, y: 2 } }).a, {
			enabled: false,
			severity: "error" as const,
			settings: { y: 2 },
		});
	});

	it("reads a null-prototype object as settings, as markdownlint does", () => {
		const value: Record<string, unknown> = Object.create(null);
		value["severity"] = "warning";
		value["style"] = "dash";
		assert.deepStrictEqual(resolve({ default: false, AAA001: value }), {
			a: { enabled: true, severity: "warning", settings: { style: "dash" } },
			b: off,
		});
	});

	it("reads a string value as severity and a falsy value as disabled", () => {
		assert.deepStrictEqual(resolve({ aaa001: "warning" }).a, {
			enabled: true,
			severity: "warning" as const,
			settings: {},
		});
		assert.deepStrictEqual(resolve({ aaa001: 0 }).a, off);
	});

	it("ignores an unknown key and extends without throwing", () => {
		assert.deepStrictEqual(resolve({ nosuchrule: true, extends: "x" }), { a: on, b: on });
	});

	it("freezes every settings object so one rule cannot leak into another", () => {
		const result = LintConfig.effective({ t1: { x: 1 } }, rules);
		for (const rule of rules) {
			assert.isTrue(Object.isFrozen(result.settings.get(LintConfig.key(rule))));
		}
		assert.isTrue(Object.isFrozen(LintConfig.effective({}, rules).settings.get("AAA001")));
	});
});

describe("LintConfig.merge", () => {
	it("merges shallowly and drops extends", () => {
		assert.deepStrictEqual(LintConfig.merge({ a: 1, extends: "p" }, { a: 2 }), { a: 2 });
	});
});

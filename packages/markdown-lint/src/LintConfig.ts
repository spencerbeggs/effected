// Resolves a markdownlint configuration object into per-rule enabled state,
// severity and settings. A port of markdownlint's `getEffectiveConfig` and
// `mapAliasToRuleNames`, quirks included: keys match case-insensitively, a
// rule name or alias maps to that one rule, a tag maps to every rule carrying
// it, and later keys override earlier ones.

import { aliasMap } from "./internal/alias-map.js";
import type { LintRule } from "./LintRule.js";

/**
 * A rule's severity.
 *
 * @public
 */
export type LintSeverity = "error" | "warning";

/**
 * A markdownlint configuration object. Keys match case-insensitively.
 *
 * @public
 */
export type LintConfigRecord = Readonly<Record<string, unknown>>;

/**
 * A configuration resolved against a rule list.
 *
 * @public
 */
export interface EffectiveLintConfig {
	/** Keyed by a rule's first name, upper-cased. */
	readonly enabled: ReadonlyMap<string, boolean>;
	/** Keyed by a rule's first name, upper-cased. */
	readonly severity: ReadonlyMap<string, LintSeverity>;
	/** The rule's settings with `enabled` and `severity` removed. */
	readonly settings: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}

/**
 * Resolves markdownlint configuration objects against a rule list.
 *
 * @remarks
 * Pure and synchronous; a class of static methods with no instances.
 *
 * @public
 */
export class LintConfig {
	/**
	 * Resolve `config` against `rules`: every rule gets an enabled state, a
	 * severity and a settings record, defaulting per the `default` key.
	 */
	static effective(config: LintConfigRecord, rules: ReadonlyArray<LintRule>): EffectiveLintConfig {
		const entries = Object.entries(config);
		let defaultEnabled = true;
		let defaultSeverity: LintSeverity = "error";
		for (const [key, value] of entries) {
			if (key.toUpperCase() === "DEFAULT") {
				defaultEnabled = !!value;
				if (value === "warning") {
					defaultSeverity = "warning";
				}
				break;
			}
		}
		const aliases = aliasMap(rules);
		const enabled = new Map<string, boolean>();
		const severity = new Map<string, LintSeverity>();
		const settings = new Map<string, Readonly<Record<string, unknown>>>();
		const noSettings = Object.freeze({});
		for (const rule of rules) {
			const name = LintConfig.key(rule);
			enabled.set(name, defaultEnabled);
			severity.set(name, defaultSeverity);
			settings.set(name, noSettings);
		}
		for (const [key, value] of entries) {
			let ruleEnabled = false;
			let ruleSeverity: LintSeverity = "error";
			let ruleSettings: Record<string, unknown> = {};
			if (value) {
				if (value instanceof Object) {
					const object = value as { enabled?: unknown; severity?: unknown };
					ruleEnabled = object.enabled === undefined || !!object.enabled;
					ruleSeverity = object.severity === "warning" ? "warning" : "error";
					ruleSettings = Object.fromEntries(Object.entries(value).filter(([k]) => k !== "enabled" && k !== "severity"));
				} else {
					ruleEnabled = true;
					ruleSeverity = value === "warning" ? "warning" : "error";
				}
			}
			Object.freeze(ruleSettings);
			for (const name of aliases.get(key.toUpperCase()) ?? []) {
				settings.set(name, ruleSettings);
				enabled.set(name, ruleEnabled);
				severity.set(name, ruleSeverity);
			}
		}
		return { enabled, severity, settings };
	}

	/** markdownlint's shallow `extends` merge: `{ ...base, ...over }` without `extends`. */
	static merge(base: LintConfigRecord, over: LintConfigRecord): LintConfigRecord {
		const { extends: _extends, ...merged } = { ...base, ...over };
		return merged;
	}

	/** The identity key for a rule: `rule.names[0].toUpperCase()`. */
	static key(rule: LintRule): string {
		return rule.names[0].toUpperCase();
	}
}

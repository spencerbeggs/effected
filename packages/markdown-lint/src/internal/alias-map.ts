// The alias map shared by configuration resolution and inline directives: a
// port of markdownlint's `mapAliasToRuleNames`. Each rule name maps to that
// one rule, each tag to every rule carrying it, all upper-cased.

import type { LintRule } from "../LintRule.js";

/**
 * Map every upper-cased rule name and tag to the upper-cased first names of
 * the rules it selects.
 */
export const aliasMap = (rules: ReadonlyArray<LintRule>): Map<string, Array<string>> => {
	const aliases = new Map<string, Array<string>>();
	for (const rule of rules) {
		const ruleName = (rule.names[0] as string).toUpperCase();
		for (const name of rule.names) {
			aliases.set(name.toUpperCase(), [ruleName]);
		}
		for (const tag of rule.tags) {
			const tagUpper = tag.toUpperCase();
			const existing = aliases.get(tagUpper);
			if (existing === undefined) {
				aliases.set(tagUpper, [ruleName]);
			} else {
				existing.push(ruleName);
			}
		}
	}
	return aliases;
};

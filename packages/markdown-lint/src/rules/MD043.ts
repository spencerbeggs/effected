// MD043 `required-headings`: a port of markdownlint's lib/md043.mjs over the
// kit tree: the document's headings, as `## Text`, walked against the
// configured list with its `*`, `+`, `?`, `%` and `^` entries, step for step
// as markdownlint walks it.

import type * as Lint from "@effected/markdown-lint";
import { headingNodes, headingText } from "../internal/headings.js";
import { flagSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

const headingsItemsRe = /^(?:[*+?]|\^+|[#%]{1,6}\s+\S.*)$/u;
const prefixedHeadingPartsRe = /^([#%]{1,6})\s+(\S.*)$/u;
const loopHeadingRe = /^\^+$/u;
const canMatchNothingHeadingsRe = /^(?:\*|\^+)$/u;
const maximumLoopsAllowed = 1000;

// Where markdownlint throws on a `%` pattern that does not compile (reached at a heading of its level), the kit
// reads `headings` as its default.
class PatternDoesNotCompile {}

const headingIsExpected = (actual: string, expected: string, matchCase: boolean): boolean => {
	if (expected.startsWith("%")) {
		const actualParts = prefixedHeadingPartsRe.exec(actual);
		const expectedParts = prefixedHeadingPartsRe.exec(expected);
		// An empty heading has no text to match, where markdownlint reads a level from the failed match and throws.
		if (actualParts === null || expectedParts === null) return false;
		// The levels first: markdownlint compiles the pattern only for a heading of the entry's level.
		if ((actualParts[1] as string).length !== (expectedParts[1] as string).length) return false;
		let pattern: RegExp;
		try {
			pattern = new RegExp(expectedParts[2] as string, `${matchCase ? "" : "i"}u`);
		} catch {
			throw new PatternDoesNotCompile();
		}
		return pattern.test(actualParts[2] as string);
	}
	return matchCase ? actual === expected : actual.toLowerCase() === expected.toLowerCase();
};

// `String(item)`, as the syntax test reads it; `""` when that throws.
const itemText = (item: unknown): string => {
	try {
		return String(item);
	} catch {
		return "";
	}
};

/**
 * MD043 `required-headings`: the document's headings follow a required
 * structure.
 *
 * @remarks
 * markdownlint's settings: `headings` (default `null`, the rule off), the
 * list of required headings, each `#`-prefixed text, a `%`-prefixed regular
 * expression, `*` (zero or more headings), `+` (one or more), `?` (exactly
 * one) or a `^` loop marker; and `match_case` (default `false`). An item
 * that is none of these reads as `[Invalid syntax]`, as in markdownlint.
 * Where markdownlint throws, the kit stays total: a truthy `headings` that is
 * no list, or a `%` pattern that does not compile when the walk compares it
 * with a heading of its level, reads as the default; an item that is no
 * string reads through `String`; an empty heading read against a `%` entry
 * does not match it.
 *
 * @public
 */
export const MD043: Lint.LintRule = LintRule.make({
	names: ["MD043", "required-headings"],
	description: "Required heading structure",
	tags: ["headings"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md043.md",
	check: (context, report) => {
		const headings = context.config.headings;
		if (!headings || !Array.isArray(headings)) return;
		const requiredHeadings = headings.map((item: unknown) => {
			const text = itemText(item);
			return headingsItemsRe.test(text) ? text : "[Invalid syntax]";
		});
		const matchCase = flagSetting(context.config, "match_case");
		let i = 0;
		let remainingLoopsAllowed = maximumLoopsAllowed;
		let allowAnyMatchFallback = false;
		let finding: Lint.LintReport | undefined;
		let hasError = false;
		const getExpected = (skipLoopHeadings: boolean): string => {
			let expected: string;
			do {
				expected = requiredHeadings[i++] || "[No heading]";
			} while (skipLoopHeadings && loopHeadingRe.test(expected));
			return expected;
		};
		try {
			for (const heading of headingNodes(context)) {
				const at = { offset: heading.position.start.offset, length: 0 };
				const actual = `${"#".repeat(heading.depth)} ${headingText(context, heading)}`;
				let expected = getExpected(false);
				if (expected.startsWith("^")) {
					const current = i;
					const nextExpected = getExpected(true);
					if (headingIsExpected(actual, nextExpected, matchCase)) {
						expected = nextExpected;
					} else {
						remainingLoopsAllowed--;
						let j = current - 2;
						for (; j >= 0; j--) {
							if (requiredHeadings[j] === expected) {
								i = j + 1;
								expected = getExpected(false);
								break;
							}
						}
						if (j < 0) expected = nextExpected;
					}
				}
				if (remainingLoopsAllowed < 0) {
					finding = { at, detail: "Too many loops", context: `Limit: ${maximumLoopsAllowed}` };
					hasError = true;
					break;
				} else if (expected === "*") {
					const nextExpected = getExpected(true);
					if (!headingIsExpected(actual, nextExpected, matchCase)) {
						allowAnyMatchFallback = true;
						i--;
					}
				} else if (expected === "+") {
					allowAnyMatchFallback = true;
				} else if (expected === "?") {
					// Exactly one of anything.
				} else if (headingIsExpected(actual, expected, matchCase)) {
					allowAnyMatchFallback = false;
				} else if (allowAnyMatchFallback) {
					i--;
				} else {
					if (expected !== actual) finding = { at, detail: `Expected: ${expected}; Actual: ${actual}` };
					hasError = true;
					break;
				}
			}
		} catch (error) {
			if (error instanceof PatternDoesNotCompile) return;
			throw error;
		}
		if (finding !== undefined) report(context.diagnostic(finding));
		if (hasError) return;
		const [remaining] = requiredHeadings.slice(i).filter((heading) => !canMatchNothingHeadingsRe.test(heading));
		if (remaining !== undefined) {
			const last = context.lines.length;
			report(
				context.diagnostic({
					at: { offset: context.mapping.lineStart(last), length: 0 },
					detail: `Expected: ${remaining}; Actual: [End of file]`,
				}),
			);
		}
	},
});

// One lint rule, defined once over kit trees and run by either host. The
// metadata mirrors markdownlint's custom-rule object (`names`, `description`,
// `tags`, `information`) and is validated to markdownlint's own rules at
// definition time, so an adapted rule can never be refused by markdownlint's
// custom-rule validation at lint time.

import { Schema } from "effect";
import type { LintContext } from "./LintContext.js";
import type { LintDiagnostic } from "./LintDiagnostic.js";

/**
 * A rule's check: read the context, report each finding through `report`.
 *
 * @remarks
 * Synchronous, because markdownlint calls a custom rule's `function`
 * synchronously. A `throw` is not caught by either host: it is a broken rule,
 * not a finding, and it propagates out of `MarkdownLint.lint` (and, under
 * markdownlint, into markdownlint's own handling of a throwing rule).
 *
 * @public
 */
export type LintCheck = (context: LintContext, report: (diagnostic: LintDiagnostic) => void) => void;

const isUrl = (value: string): boolean => URL.canParse(value);

/**
 * A lint rule: markdownlint-style metadata plus one `check` over a parsed
 * kit document.
 *
 * @remarks
 * Construct with `LintRule.make`. The fields are validated to markdownlint's
 * custom-rule contract, and a violation throws, as a wiring error does:
 *
 * - `names` — at least one non-empty name, unique ignoring case (markdownlint
 *   matches configuration keys case-insensitively). The first name is the
 *   rule's identity in both hosts; the rest are aliases (`"CSH001"`).
 * - `description` — non-empty; markdownlint shows it beside every finding.
 * - `tags` — at least one non-empty tag, none equal to one of the rule's
 *   names ignoring case.
 * - `information` — an absolute URL string, when given; the adapter hands
 *   markdownlint a `URL` built from it.
 *
 * Names must also be unique across the rules one lint run is given;
 * `MarkdownLint.lint` checks that, and markdownlint does the same for adapted
 * rules.
 *
 * @example
 * ```ts
 * import { LintRule, MarkdownLint } from "@effected/markdown-lint";
 * import { Option } from "effect";
 *
 * const noH1 = LintRule.make({
 *   names: ["no-h1"],
 *   description: "No level-1 headings",
 *   tags: ["headings"],
 *   check: (context, report) => {
 *     for (const node of context.root.children) {
 *       if (node.type === "heading" && node.depth === 1) {
 *         report(context.diagnostic({ at: node, detail: "Use ## instead", range: true }));
 *       }
 *     }
 *   },
 * });
 *
 * const [finding] = MarkdownLint.lint("# Title\n", [noH1]);
 * console.log(finding?.lineNumber, finding === undefined ? null : Option.getOrNull(finding.range)); // => 1 [ 1, 7 ]
 * ```
 *
 * @public
 */
export class LintRule extends Schema.Class<LintRule>("LintRule")(
	Schema.Struct({
		/** The rule's names: its identity first, then any aliases. */
		names: Schema.NonEmptyArray(Schema.NonEmptyString),
		/** What the rule checks, in one line. */
		description: Schema.NonEmptyString,
		/** The rule's tags, for grouping in configuration. */
		tags: Schema.NonEmptyArray(Schema.NonEmptyString),
		/** A URL documenting the rule. */
		information: Schema.optionalKey(
			Schema.String.check(Schema.makeFilter((value: string) => isUrl(value) || `Expected a URL, got "${value}"`)),
		),
		/** The check: report each finding the context contains. */
		check: Schema.declare((value: unknown): value is LintCheck => typeof value === "function", {
			expected: "a lint check function",
		}),
	}).check(
		Schema.makeFilter((rule: { readonly names: ReadonlyArray<string>; readonly tags: ReadonlyArray<string> }) => {
			const names = new Set<string>();
			for (const name of rule.names) {
				const upper = name.toUpperCase();
				if (names.has(upper)) return `Rule name "${name}" is used twice`;
				names.add(upper);
			}
			for (const tag of rule.tags) {
				if (names.has(tag.toUpperCase())) return `Tag "${tag}" is already used as a name of the rule`;
			}
			return undefined;
		}),
	),
) {
	/** The rule's identity: its first name. */
	get name(): string {
		return this.names[0];
	}
}

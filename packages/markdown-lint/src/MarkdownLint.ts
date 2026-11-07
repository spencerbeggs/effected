// The programmatic host: lint a markdown string (or an already-parsed
// document) with a list of rules, purely and synchronously, with no
// markdownlint and no unified anywhere in the graph.

import type { MarkdownDialect, MarkdownDocument } from "@effected/markdown";
import { Effect, Result } from "effect";
import { parseDocument, parseSettings, refusalDiagnostic, runRule } from "./internal/host.js";
import type { LintDiagnostic } from "./LintDiagnostic.js";
import type { LintRule } from "./LintRule.js";

/**
 * Options for {@link MarkdownLint.lint}.
 *
 * @public
 */
export interface MarkdownLintOptions {
	/** The name rules see as `LintContext.name`; defaults to `"<input>"`. */
	readonly name?: string;
	/** The dialect to parse with; defaults to `"gfm"`. */
	readonly dialect?: MarkdownDialect;
	/**
	 * Capture a leading frontmatter block as a `frontmatter` node rather than
	 * parsing its fences as markdown; defaults to `true`, as markdownlint
	 * always strips front matter before its rules run.
	 */
	readonly frontmatter?: boolean;
}

/**
 * Options for {@link MarkdownLint.lintDocument}.
 *
 * @public
 */
export interface MarkdownLintDocumentOptions {
	/** The name rules see as `LintContext.name`; defaults to `"<input>"`. */
	readonly name?: string;
}

const requireDistinctNames = (rules: ReadonlyArray<LintRule>): void => {
	const seen = new Map<string, string>();
	for (const rule of rules) {
		for (const name of rule.names) {
			const upper = name.toUpperCase();
			const owner = seen.get(upper);
			if (owner !== undefined) {
				throw new Error(`Rule name "${name}" of rule "${rule.name}" is already used by rule "${owner}"`);
			}
			seen.set(upper, rule.name);
		}
	}
};

/**
 * The programmatic lint host: run {@link LintRule}s over markdown and collect
 * their {@link LintDiagnostic}s. Not instantiable.
 *
 * @example
 * ```ts
 * import { LintRule, MarkdownLint } from "@effected/markdown-lint";
 *
 * const noEmptyHeading = LintRule.make({
 *   names: ["no-empty-heading"],
 *   description: "Headings have text",
 *   tags: ["headings"],
 *   check: (context, report) => {
 *     for (const node of context.document.findAll("heading")) {
 *       if (node.children.length === 0) report(context.diagnostic({ at: node, detail: "Empty heading" }));
 *     }
 *   },
 * });
 *
 * const findings = MarkdownLint.lint("---\ntitle: x\n---\n\n##\n", [noEmptyHeading]);
 * console.log(findings.map((finding) => [finding.ruleNames[0], finding.lineNumber]));
 * // => [ [ "no-empty-heading", 5 ] ]
 * ```
 *
 * @public
 */
export class MarkdownLint {
	private constructor() {}

	/**
	 * Parse `source` and run every rule over it.
	 *
	 * @remarks
	 * Total: a markdown document always parses, except one nested past the
	 * kit's hardening cap. That one is reported rather than thrown — each rule
	 * reports one finding at the refusal, its `detail` the parse error's
	 * message — because markdownlint has no failure channel for a rule either,
	 * and the adapter reports the same refusal the same way, so the two hosts
	 * agree even here.
	 *
	 * A leading byte order mark (U+FEFF) is dropped before the parse, as
	 * markdownlint drops it, so a BOM-prefixed file's first line is markdown
	 * in both hosts and `LintContext.source` starts after the mark.
	 *
	 * Findings come in rule order, then in the order each rule reported them;
	 * markdownlint instead sorts by rule name, then line. Line numbers count
	 * the whole source, frontmatter included.
	 *
	 * Throws, as a wiring error, when two rules share a name (ignoring case),
	 * and lets a rule's own `throw` propagate.
	 *
	 * @param source - The markdown text, frontmatter included.
	 * @param rules - The rules to run, in order.
	 * @param options - The name, dialect and frontmatter capture.
	 * @returns Every finding.
	 */
	static lint(
		source: string,
		rules: ReadonlyArray<LintRule>,
		options?: MarkdownLintOptions,
	): ReadonlyArray<LintDiagnostic> {
		requireDistinctNames(rules);
		const name = options?.name ?? "<input>";
		// markdownlint drops a leading byte order mark before its rules run
		// (and before it numbers lines), so the programmatic host does too.
		const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
		const parsed = parseDocument(text, parseSettings(options));
		if (Result.isFailure(parsed)) return rules.map((rule) => refusalDiagnostic(parsed.failure, rule));
		return rules.flatMap((rule) => runRule(parsed.success, rule, name));
	}

	/**
	 * Run every rule over an already-parsed document.
	 *
	 * @remarks
	 * For a caller that holds a `MarkdownDocument` already — an editor
	 * re-linting the document it just parsed. The rules see exactly this
	 * document, so its parse options (dialect, frontmatter capture) are the
	 * ones that hold. Same ordering, naming check and throws as
	 * {@link MarkdownLint.lint}, and no refusal case: the parse already
	 * happened.
	 *
	 * @param document - The parsed document.
	 * @param rules - The rules to run, in order.
	 * @param options - The name rules see.
	 * @returns Every finding.
	 */
	static lintDocument(
		document: MarkdownDocument,
		rules: ReadonlyArray<LintRule>,
		options?: MarkdownLintDocumentOptions,
	): ReadonlyArray<LintDiagnostic> {
		requireDistinctNames(rules);
		const name = options?.name ?? "<input>";
		return rules.flatMap((rule) => runRule(document, rule, name));
	}

	/**
	 * {@link MarkdownLint.lint} as an `Effect`, under a `MarkdownLint.lint`
	 * span.
	 *
	 * @remarks
	 * Defined in terms of `lint`, so the two cannot disagree. It never fails:
	 * a rule's `throw` or a rule-name clash dies as a defect.
	 *
	 * @param source - The markdown text, frontmatter included.
	 * @param rules - The rules to run, in order.
	 * @param options - The name, dialect and frontmatter capture.
	 * @returns An `Effect` succeeding with every finding.
	 */
	static readonly lintEffect: (
		source: string,
		rules: ReadonlyArray<LintRule>,
		options?: MarkdownLintOptions,
	) => Effect.Effect<ReadonlyArray<LintDiagnostic>> = Effect.fn("MarkdownLint.lint")(
		(source: string, rules: ReadonlyArray<LintRule>, options?: MarkdownLintOptions) =>
			Effect.sync(() => MarkdownLint.lint(source, rules, options)),
	);
}

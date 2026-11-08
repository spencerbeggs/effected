import type { LintDiagnostic, LintRule, MarkdownLintOptions } from "@effected/markdown-lint";
import { MarkdownLint } from "@effected/markdown-lint";
import { ContentStructure } from "./internal/lint/content-structure.js";
import { DependencyTableFormat } from "./internal/lint/dependency-table-format.js";
import { HeadingHierarchy } from "./internal/lint/heading-hierarchy.js";
import { RequiredSections } from "./internal/lint/required-sections.js";
import { UncategorizedContent } from "./internal/lint/uncategorized-content.js";

/**
 * The changeset style rules CSH001 to CSH005, each defined once as a
 * `LintRule` over `@effected/markdown` trees, so one definition runs in
 * `MarkdownLint` and, through `MarkdownlintAdapter`, in markdownlint and
 * markdownlint-cli2.
 *
 * @remarks
 * The rules check a changeset's body, whatever its front matter says:
 *
 * - `CSH001` `changeset-heading-hierarchy`: no `h1`, and no heading that
 *   skips a level.
 * - `CSH002` `changeset-required-sections`: every `h2` names one of the
 *   thirteen categories (`Breaking Changes`, `Features`, `Bug Fixes`,
 *   `Performance`, `Documentation`, `Refactoring`, `Tests`, `Build System`,
 *   `CI`, `Dependencies`, `Maintenance`, `Reverts`, `Other`), ignoring case.
 * - `CSH003` `changeset-content-structure`: no empty section, no code fence
 *   without a language, no empty list item.
 * - `CSH004` `changeset-uncategorized-content`: no content before the first
 *   `h2`.
 * - `CSH005` `changeset-dependency-table-format`: a `Dependencies` section
 *   holds a `Dependency | Type | Action | From | To` table whose cells are
 *   valid.
 *
 * Messages, lines and columns are savvy-web/systems' own, which wrote the
 * rules. systems implements each rule twice, and where its two engines
 * disagree these follow its markdownlint engine, the one markdownlint-cli2
 * and a pre-commit hook run. That engine reads micromark tokens, so:
 *
 * - Only top-level blocks are sections: a heading, list or code block
 *   inside a list item or a block quote is not checked by CSH001, CSH002 or
 *   CSH003.
 * - A heading or table cell is compared as written, with backslash escapes
 *   resolved and inline formatting kept: a heading of `Features` in a code
 *   span and `## *Bug Fixes*` are unknown sections, and a `From` cell of
 *   `1.0.0` in a code span is not a version. That verdict looks stricter than an author
 *   expects, but it is what markdownlint enforces.
 * - CSH003 checks fenced code only, since an indented block has no fence to
 *   name a language on, and calls a list item empty unless it holds a
 *   paragraph: an item of only an HTML comment, a nested list or a heading is
 *   empty, and an item of only an image is not.
 * - A table row shorter than the header has too few columns. The parsed tree
 *   pads it with empty cells, which are not counted.
 * - A setext heading directly under a link reference definition is
 *   reported on the definition's line, where micromark starts its token.
 * - A heading over several lines is named on one line, as markdownlint
 *   writes every detail.
 *
 * One difference remains, and it is the parser's, not a rule's: after an
 * indented code block, markdownlint's micromark reads a bare `- ` line as a
 * paragraph, where CommonMark reads an empty list item, so CSH003 reports an
 * empty item there and markdownlint does not.
 *
 * @example
 * ```ts
 * import { MarkdownlintAdapter } from "@effected/markdown-lint";
 * import { ChangesetLint } from "@effected/changesets/lint";
 *
 * // .markdownlint-cli2.mjs
 * export default { customRules: MarkdownlintAdapter.rules(ChangesetLint.rules) };
 * ```
 *
 * @public
 */
export class ChangesetLint {
	/** CSH001: headings start at `h2` and never skip a level. */
	static readonly headingHierarchy: LintRule = HeadingHierarchy;
	/** CSH002: every `h2` names a changeset category. */
	static readonly requiredSections: LintRule = RequiredSections;
	/** CSH003: sections have content, fences a language, list items text. */
	static readonly contentStructure: LintRule = ContentStructure;
	/** CSH004: nothing comes before the first category heading. */
	static readonly uncategorizedContent: LintRule = UncategorizedContent;
	/** CSH005: a `Dependencies` section holds a valid dependency table. */
	static readonly dependencyTableFormat: LintRule = DependencyTableFormat;

	/**
	 * The five rules in the order savvy-web/systems' linter runs them, CSH005
	 * before CSH004, which is the order `MarkdownLint` reports their findings
	 * in.
	 */
	static readonly rules: ReadonlyArray<LintRule> = [
		HeadingHierarchy,
		RequiredSections,
		ContentStructure,
		DependencyTableFormat,
		UncategorizedContent,
	];

	/**
	 * Lint one changeset file's text with all five rules: `MarkdownLint.lint`
	 * over {@link ChangesetLint.rules}. Line numbers count the whole file, front
	 * matter included.
	 *
	 * @param source - The changeset file's text.
	 * @param options - Parse options, passed to `MarkdownLint.lint`.
	 */
	static lint(source: string, options?: MarkdownLintOptions): ReadonlyArray<LintDiagnostic> {
		return MarkdownLint.lint(source, ChangesetLint.rules, options);
	}
}

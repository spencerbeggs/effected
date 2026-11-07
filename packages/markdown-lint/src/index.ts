/**
 * A markdownlint-compatible lint rule shape over `@effected/markdown` trees:
 * define a rule once, run it programmatically or inside markdownlint.
 *
 * @remarks
 * A {@link LintRule} carries markdownlint-style metadata (`names`,
 * `description`, `tags`, `information`) and one synchronous `check` over a
 * {@link LintContext} — the parsed document, source, lines and frontmatter
 * facts — reporting {@link LintDiagnostic}s whose `lineNumber`, `range` and
 * `fixInfo` {@link PositionMapping} derives from kit offsets. Two hosts run
 * the same definition: {@link MarkdownLint}, a pure programmatic linter, and
 * {@link MarkdownlintAdapter}, which turns a rule into a markdownlint custom
 * rule without importing markdownlint.
 *
 * @packageDocumentation
 */

export type { LintContext, LintFrontmatter, LintReport } from "./LintContext.js";
export type { LintRange } from "./LintDiagnostic.js";
export { LintDiagnostic, LintFixInfo } from "./LintDiagnostic.js";
export type { LintCheck } from "./LintRule.js";
export { LintRule } from "./LintRule.js";
export type { MarkdownLintDocumentOptions, MarkdownLintOptions } from "./MarkdownLint.js";
export { MarkdownLint } from "./MarkdownLint.js";
export type {
	MarkdownlintAdapterOptions,
	MarkdownlintErrorInfo,
	MarkdownlintFixInfo,
	MarkdownlintOnError,
	MarkdownlintRule,
	MarkdownlintRuleParams,
} from "./MarkdownlintAdapter.js";
export { MarkdownlintAdapter } from "./MarkdownlintAdapter.js";
export type { LintEditLike } from "./PositionMapping.js";
export { PositionMapping } from "./PositionMapping.js";

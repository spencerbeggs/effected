/**
 * markdownlint's built-in rules, ported over `@effected/markdown` trees: one
 * free-standing named export per rule, so a consumer imports only the rules
 * it runs. Each is an ordinary `LintRule` with markdownlint's own names,
 * description, tags and documentation link, held finding for finding to the
 * installed markdownlint by a differential test over its fixture corpus.
 *
 * @remarks
 * `@effected/markdown-lint/rules/all` lists which of markdownlint's rules are
 * still `uncovered`.
 *
 * @packageDocumentation
 */

export { MD009 } from "./MD009.js";
export { MD010 } from "./MD010.js";
export { MD012 } from "./MD012.js";

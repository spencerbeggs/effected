/**
 * Lint rules for changeset files that hold under any house style, as
 * `@effected/markdown-lint` rules: the checks the changesets tool itself
 * makes, plus package existence when the workspace's names are given.
 *
 * @remarks
 * A separate entry point, so the root never reaches `@effected/markdown` or
 * `@effected/markdown-lint`: both are optional peers, needed only here.
 *
 * @packageDocumentation
 */

export type { ChangesetLintOptions } from "./ChangesetLint.js";
export { ChangesetLint } from "./ChangesetLint.js";

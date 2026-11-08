/**
 * The changeset style rules CSH001 to CSH005 as `@effected/markdown-lint`
 * rules.
 *
 * @remarks
 * A separate entry point, so the root never reaches `@effected/markdown` or
 * `@effected/markdown-lint`: both are optional peers, needed only here.
 *
 * @packageDocumentation
 */

export { ChangesetLint } from "./ChangesetLint.js";

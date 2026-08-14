import { formatIssue } from "./internal/format.js";

/**
 * Turn a `SchemaIssue` tree into lines a user can act on.
 *
 * @remarks
 * A decode failure arrives as a structured tree; a person needs
 * `unknown key at groups.g.cleanup.rulesetz`.
 *
 * **Core already ships the formatters this wraps, and they are effectively
 * undiscoverable.** They live on `SchemaIssue` rather than `SchemaError` or
 * `Schema`, they are named `makeFormatter*` rather than anything containing
 * "render" or "format issue", and `SchemaError.message` does not use them — so
 * the obvious probe, printing the error, hints at nothing. Two engineers
 * searched for two rounds and concluded core had none. This export exists to
 * end that search, and the one phrasing override is a bonus rather than the
 * point.
 *
 * @example
 * ```ts
 * import { SchemaIssueRenderer } from "@effected/cli"
 * import { Effect, Schema } from "effect"
 *
 * const result = Schema.decodeUnknownEffect(MySchema)(input, {
 *   onExcessProperty: "error",
 *   errors: "all",
 * })
 *
 * const reported = result.pipe(
 *   Effect.catchTag("SchemaError", (error) =>
 *     Effect.forEach(SchemaIssueRenderer.render(error.issue), (line) => Effect.logError(`  ${line}`)),
 *   ),
 * )
 * ```
 *
 * @public
 */
export class SchemaIssueRenderer {
	private constructor() {}

	/**
	 * One line per rejected value, deepest path last.
	 *
	 * @param issue - a `SchemaIssue` tree, or any value
	 * @returns the lines, or empty when `issue` is not an issue tree
	 */
	static readonly render = (issue: unknown): ReadonlyArray<string> => formatIssue(issue);
}

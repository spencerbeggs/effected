import { formatIssueWithHints } from "./internal/format.js";

/**
 * What {@link ConfigIssueRenderer.render} reads: anything that may carry an `issue` tree.
 *
 * @remarks
 * A `@effected/config-file` `ConfigValidationError` is assignable to it, as is any
 * other value with an optional `issue` property.
 *
 * @public
 */
export interface ConfigIssueSource {
	readonly issue?: unknown;
}

/**
 * Turns a `@effected/config-file` `ConfigValidationError` into one line per rejected value.
 *
 * @remarks
 * `ConfigValidationError` carries the structured `issue` tree rather than a
 * string, so a caller holds a tree it has to turn into sentences. This is that
 * step, the same treatment {@link SchemaIssueRenderer} gives a bare issue.
 *
 * `ConfigValidationError.message` names the file but not the value, and the
 * value is the diagnostic: printing only the message tells a user their config
 * is invalid without saying which value is wrong or how it is shaped.
 *
 * The parameter is {@link ConfigIssueSource}, a structural type, so this module
 * names nothing from `@effected/config-file` and the package is not a peer. A
 * real `ConfigValidationError` is assignable to it.
 *
 * @example
 * ```ts
 * import { ConfigIssueRenderer } from "@effected/cli-kit"
 * import { Effect } from "effect"
 *
 * const load = configFile.load.pipe(
 *   Effect.catchTag("ConfigValidationError", (error) =>
 *     Effect.gen(function* () {
 *       yield* Effect.logError(String(error))
 *       for (const line of ConfigIssueRenderer.render(error)) yield* Effect.logError(`  ${line}`)
 *     }),
 *   ),
 * )
 * ```
 *
 * @public
 */
export class ConfigIssueRenderer {
	private constructor() {}

	/**
	 * One line per rejected value.
	 *
	 * @remarks
	 * Takes the **error**, not its `issue`, because that is what a `catchTag`
	 * hands you and because `issue` is typed `Schema.Defect`, which every call
	 * site would otherwise have to reach into. Inside
	 * `Effect.catchTag("ConfigValidationError", …)` the error is already this
	 * shape.
	 *
	 * An unknown key the schema has a near match for at the same path ends in a
	 * hint, `unknown key at theme.colour (did you mean "color"?)`, drawn from the
	 * keys the struct declares there (every branch's, under a union) with
	 * {@link Fmt.suggest}'s threshold. A key with no near match is drawn exactly
	 * as {@link SchemaIssueRenderer} draws it.
	 *
	 * It cannot throw on a malformed value: the issue tree is validated by
	 * a guard before it is read, so a renderer on an error path never becomes the
	 * reason a program dies.
	 */
	static readonly render = (error: ConfigIssueSource): ReadonlyArray<string> =>
		// A non-object reaching a typed parameter at runtime must still not throw.
		formatIssueWithHints((error as ConfigIssueSource | null | undefined)?.issue);
}

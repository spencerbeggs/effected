import type { ConfigValidationError } from "@effected/config-file";
import { formatIssue } from "./internal/format.js";

/**
 * Render a `@effected/config-file` validation failure.
 *
 * @remarks
 * `ConfigValidationError` carries the structured `issue` tree rather than a
 * string, which is the right design and leaves the consumer holding a tree it
 * has to turn into sentences. This is that step, and it is the same treatment
 * {@link SchemaIssueRenderer} gives a bare issue.
 *
 * **This module is the only thing in the package that references
 * `@effected/config-file`, deliberately.** The peer is declared optional, and
 * an optional peer whose import is reachable from a shared module is not
 * optional — it is a crash for every consumer who took the manifest at its word
 * and did not install it. So nothing else in this package imports this module;
 * only the entrypoint re-exports it, and the shared rendering lives in
 * `internal/format`.
 *
 * The import is additionally `import type`, so it is erased at build time and
 * the runtime reach is **zero** — a consumer without `@effected/config-file`
 * installed can import this module and call `render` on any value without the
 * resolver ever being asked for the package.
 *
 * ## Why this and not just the error's message
 *
 * `ConfigValidationError.message` names the file. It does not name the value,
 * and the difference is the whole diagnostic: a consumer that printed only the
 * message told users "your config is invalid, run the doctor command", and the
 * doctor command — which guessed from a hand-written list of known keys — could
 * only ever find a *misspelling*. A wrongly **shaped** value left the two
 * commands pointing at each other and neither saying what was wrong.
 *
 * @example
 * ```ts
 * import { ConfigIssueRenderer } from "@effected/cli"
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
	 * hands you and because `issue` is typed `Schema.Defect` — reaching into it
	 * at every call site is exactly the ceremony this removes.
	 *
	 * The parameter is the **typed** error rather than `unknown`. An earlier
	 * draft wrote `ConfigValidationError | unknown` to be accommodating, which
	 * collapses to plain `unknown` in TypeScript — so it accepted anything, said
	 * nothing, and left the type import in the `.d.ts` earning nothing. Inside
	 * `Effect.catchTag("ConfigValidationError", …)` the error is already this
	 * type, which is where this is called.
	 *
	 * It still cannot throw on a malformed value: the issue tree is validated by
	 * a guard before it is read, so a renderer on an error path never becomes the
	 * reason a program dies.
	 */
	static readonly render = (error: ConfigValidationError): ReadonlyArray<string> =>
		formatIssue((error as { readonly issue?: unknown } | null)?.issue);
}

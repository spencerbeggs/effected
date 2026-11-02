import { DistributionField } from "@effected/kit";
import { Effect, Schema } from "effect";
import effectPackage from "effect/package.json" with { type: "json" };

/**
 * What the `effected` tool reports about itself.
 *
 * @public
 */
export class IdentityReport extends Schema.Class<IdentityReport>("IdentityReport")({
	/** The tool name; always `"effected"`. */
	tool: Schema.Literal("effected"),
	/** The reporting front end's own version. */
	version: Schema.String,
	/** The carrier distribution the front end was installed through, or `null` for a direct install. */
	distribution: DistributionField,
	/** The resolved `effect` package version. */
	effect: Schema.String,
}) {}

/**
 * The `effected` tool's identity program.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Identity } from "@effected/engine"
 *
 * const program = Effect.gen(function* () {
 *   const report = yield* Identity.report({ version: "0.12.0", distribution: null })
 *   // { tool: "effected", version: "0.12.0", distribution: null, effect: "<the resolved effect version>" }
 *   return report
 * })
 * ```
 *
 * @public
 */
export class Identity {
	private constructor() {}

	/**
	 * Build the identity report for a front end.
	 *
	 * @remarks
	 * `options.version` is the front end's own version and `options.distribution` the carrier it was installed
	 * through, or `null`. The `effect` field is read from the resolved `effect` package.
	 */
	static readonly report = (options: {
		readonly version: string;
		readonly distribution: IdentityReport["distribution"];
	}): Effect.Effect<IdentityReport> =>
		Effect.sync(() =>
			IdentityReport.make({
				tool: "effected",
				version: options.version,
				distribution: options.distribution,
				effect: effectPackage.version,
			}),
		);
}

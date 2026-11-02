import { DistributionField } from "@effected/kit";
import { Effect, Schema } from "effect";
import effectPackage from "effect/package.json" with { type: "json" };

/**
 * What the `effected` tool reports about itself.
 *
 * @public
 */
export class IdentityReport extends Schema.Class<IdentityReport>("IdentityReport")({
	tool: Schema.Literal("effected"),
	version: Schema.String,
	distribution: DistributionField,
	effect: Schema.String,
}) {}

/**
 * The `effected` tool's identity program.
 *
 * @public
 */
export const Identity = {
	/**
	 * Build the identity report for a front end.
	 *
	 * @param options - The front end's own `version` and the carrier `distribution` it was installed through, or `null`.
	 * @returns The report, with `effect` read from the resolved `effect` package.
	 */
	report: (options: {
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
		),
};

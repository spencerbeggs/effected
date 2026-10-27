import { Context, Effect, Option, Schema } from "effect";

/**
 * The carrier package a tool's bins were installed through.
 *
 * @remarks
 * A carrier (`@scope/plugin`) re-exposes its front ends' bins and passes its
 * own identity down to each front end's `main`. A plain struct rather than a
 * `Schema.Class`, because it travels in JSON envelopes as a plain object and
 * is compared structurally.
 *
 * @public
 */
export const Distribution = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
});

/**
 * A decoded {@link (Distribution:variable)}.
 *
 * @public
 */
export type Distribution = typeof Distribution.Type;

/**
 * The `distribution` field of a machine-readable envelope: `null` when the
 * front end was installed directly rather than through a carrier.
 *
 * @public
 */
export const DistributionField = Schema.NullOr(Distribution);

/**
 * The carrier this run was installed through, read anywhere without
 * appearing in `R`.
 *
 * @remarks
 * A `Context.Reference`, not a `Context.Service`: it carries its own default
 * (`Option.none()`), so a direct install needs no provision at all. A front
 * end's `main` provides it once, at the top of the program, with
 * `Effect.provideService(CurrentDistribution, Option.fromNullishOr(options.distribution))`.
 *
 * @public
 */
export const CurrentDistribution: Context.Reference<Option.Option<Distribution>> = Context.Reference(
	"@effected/engine/CurrentDistribution",
	{ defaultValue: () => Option.none() },
);

/**
 * The `via <name> <version>` suffix (prefixed with a space) a `--version`
 * line or a startup log line appends, or `""` for a direct install.
 *
 * @public
 */
export const distributionSuffix = (distribution: Option.Option<Distribution>): string =>
	Option.match(distribution, {
		onNone: () => "",
		onSome: ({ name, version }) => ` via ${name} ${version}`,
	});

/**
 * Decorates a `--version` line formatter so its line ends with
 * {@link distributionSuffix}: `formatVersion(name, version)` followed by
 * a space and `via <carrier> <version>` when installed through a carrier,
 * unchanged for a direct install.
 *
 * @remarks
 * Shaped around `effect/cli`'s `CliOutput.Formatter["formatVersion"]`: it
 * wraps whatever formatter is in effect (a coloured default or a custom one)
 * rather than replacing it. The suffix is computed once, when the decorator is
 * applied, because the distribution is known at `main`. Data-last, for `pipe`.
 *
 * @example
 * ```ts
 * import { withDistributionVersion } from "@effected/engine";
 * import { Option } from "effect";
 *
 * const formatVersion = withDistributionVersion(Option.some({ name: "@scope/plugin", version: "2.0.0" }))(
 * 	(name, version) => `${name} ${version}`,
 * );
 * formatVersion("tool", "1.0.0"); // "tool 1.0.0 via @scope/plugin 2.0.0"
 * ```
 *
 * @public
 */
export const withDistributionVersion = (
	distribution: Option.Option<Distribution>,
): ((formatVersion: (name: string, version: string) => string) => (name: string, version: string) => string) => {
	const suffix = distributionSuffix(distribution);
	return (formatVersion) => (name, version) => `${formatVersion(name, version)}${suffix}`;
};

/**
 * Provides {@link CurrentDistribution} to `self`: `Option.some` of a carrier,
 * `Option.none()` for `null` or `undefined` (a direct install).
 *
 * @remarks
 * The one-line form of what a front end's `main` does once at the top of its
 * program. Data-last, for `pipe`.
 *
 * @public
 */
export const withDistribution =
	(distribution: Distribution | null | undefined) =>
	<A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Effect.provideService(self, CurrentDistribution, Option.fromNullishOr(distribution));

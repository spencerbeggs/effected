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
 * A `--version` line formatter that appends {@link distributionSuffix}:
 * `(name, version) => "<name> <version>[ via <carrier> <version>]"`.
 *
 * @remarks
 * Shaped like `effect/cli`'s `CliOutput.Formatter["formatVersion"]`, so a CLI
 * front end can install it directly. The suffix is computed once, when the
 * formatter is made, because the distribution is known at `main`.
 *
 * @public
 */
export const distributionFormatter = (
	distribution: Option.Option<Distribution>,
): ((name: string, version: string) => string) => {
	const suffix = distributionSuffix(distribution);
	return (name, version) => `${name} ${version}${suffix}`;
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

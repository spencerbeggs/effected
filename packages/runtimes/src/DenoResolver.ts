/**
 * Resolving Deno versions.
 *
 * @packageDocumentation
 */

import type { InvalidRangeError } from "@effected/semver";
import { SemVer } from "@effected/semver";
import type { Effect, Layer } from "effect";
import { Context, Schema } from "effect";
import type { GitHubClient, GitHubError } from "./GitHub.js";
import { denoDefaults } from "./internal/defaults/deno.js";
import type { GitHubRuntimeShape } from "./internal/githubRuntime.js";
import { build } from "./internal/githubRuntime.js";
import type { ReleaseIndex } from "./internal/releaseIndex.js";
import { populateAuto, populateFresh, populateOffline } from "./internal/strategy.js";
import type {
	FreshnessError,
	NoMatchingVersionError,
	ResolvedVersions,
	UnresolvableDefaultError,
} from "./ResolvedVersions.js";
import { Increments } from "./ResolvedVersions.js";

/**
 * One published Deno release.
 *
 * @public
 */
export class DenoRelease extends Schema.Class<DenoRelease>("DenoRelease")({
	/** The released version. */
	version: SemVer,
	/** When it was published. */
	date: Schema.DateTimeUtc,
}) {}

/**
 * How to resolve Deno versions.
 *
 * @public
 */
export const DenoResolverOptions = Schema.Struct({
	/** The semver range to match. Defaults to `*`. */
	range: Schema.optionalKey(Schema.String),
	/** How to group matches. Defaults to `latest`. */
	increments: Schema.optionalKey(Increments),
	/** A range whose newest match becomes the `default` field. */
	defaultVersion: Schema.optionalKey(Schema.String),
});

/**
 * How to resolve Deno versions.
 *
 * @public
 */
export type DenoResolverOptions = typeof DenoResolverOptions.Type;

/**
 * The Deno resolver.
 *
 * @example
 * ```ts
 * import { DenoResolver } from "@effected/runtimes";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const resolver = yield* DenoResolver;
 *   return (yield* resolver.resolve({ range: "^2.0.0" })).latest;
 * }).pipe(Effect.provide(DenoResolver.layerOffline));
 * ```
 *
 * @public
 */
export class DenoResolver extends Context.Service<
	DenoResolver,
	{
		readonly resolve: (
			options?: DenoResolverOptions,
		) => Effect.Effect<ResolvedVersions, InvalidRangeError | NoMatchingVersionError | UnresolvableDefaultError>;
	}
>()("@effected/runtimes/DenoResolver") {
	/** Try GitHub, fall back to the bundled snapshot. */
	static readonly layer: Layer.Layer<DenoResolver, never, GitHubClient> = mk(this, (index, live, offline) =>
		populateAuto(index, "deno", live, offline),
	);

	/** GitHub or nothing. Fails with `FreshnessError` when it cannot be reached. */
	static readonly layerFresh: Layer.Layer<DenoResolver, FreshnessError, GitHubClient> = mk(this, (index, live) =>
		populateFresh(index, "deno", live),
	);

	/** The bundled snapshot only. Performs no IO and requires nothing. */
	static readonly layerOffline: Layer.Layer<DenoResolver> = mk(this, (index, _live, offline) =>
		populateOffline(index, offline),
	);
}

/**
 * The tag arrives as `this` rather than by name.
 *
 * A static initializer runs while the module-scope `DenoResolver` binding is
 * still in its temporal dead zone, so naming the class here throws "Cannot
 * access 'DenoResolver' before initialization" at import time. Inside a static
 * initializer `this` *is* the class, which is why `Layer.effect(this, ...)` is
 * the idiomatic v4 spelling.
 */
function mk<E, RIn>(
	tag: Context.Key<DenoResolver, GitHubRuntimeShape>,
	strategy: (
		index: ReleaseIndex<DenoRelease>,
		live: Effect.Effect<ReadonlyArray<DenoRelease>, GitHubError, GitHubClient>,
		offline: Effect.Effect<ReadonlyArray<DenoRelease>>,
	) => Effect.Effect<void, E, RIn>,
): Layer.Layer<DenoResolver, E, RIn> {
	return build(
		{
			tag,
			runtime: "deno",
			owner: "denoland",
			repo: "deno",
			spanName: "DenoResolver.resolve",
			defaults: denoDefaults,
			make: (fields) => DenoRelease.make(fields),
		},
		strategy,
	);
}

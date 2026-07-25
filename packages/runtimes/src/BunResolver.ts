/**
 * Resolving Bun versions.
 *
 * @packageDocumentation
 */

import type { InvalidRangeError } from "@effected/semver";
import { SemVer } from "@effected/semver";
import type { Effect, Layer } from "effect";
import { Context, Schema } from "effect";
import type { GitHubClient, GitHubError } from "./GitHub.js";
import { bunDefaults } from "./internal/defaults/bun.js";
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
 * One published Bun release.
 *
 * @public
 */
export class BunRelease extends Schema.Class<BunRelease>("BunRelease")({
	/** The released version. */
	version: SemVer,
	/** When it was published. */
	date: Schema.DateTimeUtc,
}) {}

/**
 * How to resolve Bun versions.
 *
 * @public
 */
export const BunResolverOptions = Schema.Struct({
	/** The semver range to match. Defaults to `*`. */
	range: Schema.optionalKey(Schema.String),
	/** How to group matches. Defaults to `latest`. */
	increments: Schema.optionalKey(Increments),
	/** A range whose newest match becomes the `default` field. */
	defaultVersion: Schema.optionalKey(Schema.String),
});

/**
 * How to resolve Bun versions.
 *
 * @public
 */
export type BunResolverOptions = typeof BunResolverOptions.Type;

/**
 * The Bun resolver.
 *
 * @example
 * ```ts
 * import { BunResolver } from "@effected/runtimes";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const resolver = yield* BunResolver;
 *   return (yield* resolver.resolve({ range: "^1.0.0" })).latest;
 * }).pipe(Effect.provide(BunResolver.layerOffline));
 * ```
 *
 * @public
 */
export class BunResolver extends Context.Service<
	BunResolver,
	{
		readonly resolve: (
			options?: BunResolverOptions,
		) => Effect.Effect<
			ResolvedVersions,
			InvalidRangeError | NoMatchingVersionError | UnresolvableDefaultError | FreshnessError
		>;
	}
>()("@effected/runtimes/BunResolver") {
	/**
	 * Try GitHub, fall back to the bundled snapshot.
	 *
	 * Lazy: building the layer performs no IO. The feed is fetched by the first
	 * `resolve` and shared by every later (and concurrent) one; a fallback to
	 * the snapshot is memoized like any other successful population.
	 */
	static readonly layer: Layer.Layer<BunResolver, never, GitHubClient> = mk(this, (index, live, offline) =>
		populateAuto(index, "bun", live, offline),
	);

	/**
	 * GitHub or nothing.
	 *
	 * Lazy: building the layer performs no IO, so an unreachable feed surfaces
	 * as a `FreshnessError` from `resolve`, not from layer acquisition. A failed
	 * fetch is not memoized — the next `resolve` retries; a successful one is.
	 */
	static readonly layerFresh: Layer.Layer<BunResolver, never, GitHubClient> = mk(this, (index, live) =>
		populateFresh(index, "bun", live),
	);

	/**
	 * The bundled snapshot only. Requires nothing and performs no IO — the
	 * snapshot is decoded lazily by the first `resolve`, like the live layers.
	 */
	static readonly layerOffline: Layer.Layer<BunResolver> = mk(this, (index, _live, offline) =>
		populateOffline(index, offline),
	);
}

/**
 * The tag arrives as `this` rather than by name.
 *
 * A static initializer runs while the module-scope `BunResolver` binding is
 * still in its temporal dead zone, so naming the class here throws "Cannot
 * access 'BunResolver' before initialization" at import time. Inside a static
 * initializer `this` *is* the class, which is why `Layer.effect(this, ...)` is
 * the idiomatic v4 spelling.
 */
function mk<E extends FreshnessError, RIn>(
	tag: Context.Key<BunResolver, GitHubRuntimeShape>,
	strategy: (
		index: ReleaseIndex<BunRelease>,
		live: Effect.Effect<ReadonlyArray<BunRelease>, GitHubError, GitHubClient>,
		offline: Effect.Effect<ReadonlyArray<BunRelease>>,
	) => Effect.Effect<void, E, RIn>,
): Layer.Layer<BunResolver, never, RIn> {
	return build(
		{
			tag,
			runtime: "bun",
			owner: "oven-sh",
			repo: "bun",
			spanName: "BunResolver.resolve",
			defaults: bunDefaults,
			make: (fields) => BunRelease.make(fields),
		},
		strategy,
	);
}

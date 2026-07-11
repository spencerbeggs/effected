/**
 * The three cache strategies, parameterized once.
 *
 * v3 shipped nine layer files for this: {auto, fresh, offline} × {node, bun,
 * deno}, where the Bun and Deno "fresh" layers differed by a repository name.
 * The strategy is a property of *how the index is populated*, not of which
 * runtime it holds, so it is one function per strategy taking a loader.
 *
 * Each is typed exactly, which is the point: `offline` requires nothing and
 * cannot fail, `auto` requires the feed but still cannot fail, and only `fresh`
 * carries a `FreshnessError`. A single function switching on a kind would union
 * all three channels together and force every layer to advertise failures it
 * cannot have.
 *
 * @internal
 */

import { Effect } from "effect";
import type { Runtime } from "../ResolvedVersions.js";
import { FreshnessError } from "../ResolvedVersions.js";
import type { ReleaseIndex, Versioned } from "./releaseIndex.js";

/** Which strategy a layer implements. */
export type StrategyKind = "auto" | "fresh" | "offline";

/**
 * Load the bundled snapshot. No IO, no failure, no requirements.
 */
export const populateOffline = <R extends Versioned>(
	index: ReleaseIndex<R>,
	offline: Effect.Effect<ReadonlyArray<R>>,
): Effect.Effect<void> => offline.pipe(Effect.flatMap((releases) => index.load(releases, "cache")));

/**
 * Live data or a typed failure.
 *
 * The caller chose this strategy to say that a snapshot is not an acceptable
 * substitute, so the feed's failure becomes theirs.
 */
export const populateFresh = <R extends Versioned, E, RIn>(
	index: ReleaseIndex<R>,
	runtime: Runtime,
	live: Effect.Effect<ReadonlyArray<R>, E, RIn>,
): Effect.Effect<void, FreshnessError, RIn> =>
	live.pipe(
		Effect.mapError((cause) => new FreshnessError({ runtime, cause })),
		Effect.flatMap((releases) => index.load(releases, "api")),
	);

/**
 * Try the live feed; fall back to the bundled snapshot.
 *
 * The fallback is **visible**: provenance becomes `"cache"` and a warning is
 * logged. v3 fell back silently and then reported the result as `source: "api"`,
 * so a caller had no way to tell a live answer from a stale one served after a
 * network failure.
 */
export const populateAuto = <R extends Versioned, E, RIn>(
	index: ReleaseIndex<R>,
	runtime: Runtime,
	live: Effect.Effect<ReadonlyArray<R>, E, RIn>,
	offline: Effect.Effect<ReadonlyArray<R>>,
): Effect.Effect<void, never, RIn> =>
	live.pipe(
		Effect.flatMap((releases) => index.load(releases, "api")),
		Effect.catch((cause) =>
			Effect.gen(function* () {
				yield* Effect.logWarning("Live release feed unavailable; falling back to the bundled snapshot", {
					runtime,
					cause,
				});
				const releases = yield* offline;
				yield* index.load(releases, "cache");
			}),
		),
	);

/**
 * The release index: releases plus the provenance of the load that produced them.
 *
 * Generic over any release carrying a `SemVer`, so one implementation serves
 * Node, Bun and Deno — the v3 code had three near-identical release caches on
 * top of a generic core it could not quite commit to.
 *
 * Two v3 defects are fixed here:
 *
 * 1. **Provenance.** v3 advertised `source: "api" | "cache"` and hardcoded
 *    `"api"` in all three resolvers, because the Auto layer's knowledge of
 *    whether it had fallen back died at the layer boundary. Provenance is now
 *    part of the index's state, set by whichever strategy loaded it.
 * 2. **Concurrency.** v3 held a bare closure `Map` with a comment admitting
 *    "load is not concurrency-safe". State lives in a `Ref`; `load` is one
 *    atomic write.
 *
 * @internal
 */

import type { Range, SemVer } from "@effected/semver";
import { Effect, Option, Ref } from "effect";
import type { RawSource } from "./types.js";

/** The minimum a release must carry to be indexed. */
export interface Versioned {
	readonly version: SemVer;
}

/** Granularity at which matching releases are grouped. Mirrors the public `Increments`. */
export type RawIncrements = "latest" | "minor" | "patch";

interface IndexState<R> {
	readonly releases: ReadonlyArray<R>;
	readonly source: RawSource;
}

/**
 * A loaded set of releases and where it came from.
 *
 * @internal
 */
export interface ReleaseIndex<R extends Versioned> {
	/** Replace the contents, recording the provenance of this load. */
	readonly load: (releases: ReadonlyArray<R>, source: RawSource) => Effect.Effect<void>;
	/** Every indexed release, newest first. */
	readonly releases: Effect.Effect<ReadonlyArray<R>>;
	/** Whether the current contents came from a live feed or the bundled snapshot. */
	readonly source: Effect.Effect<RawSource>;
	/** Releases satisfying `range`, newest first. */
	readonly filter: (range: Range) => Effect.Effect<ReadonlyArray<R>>;
	/** The newest release satisfying `range`, if any. */
	readonly resolve: (range: Range) => Effect.Effect<Option.Option<R>>;
}

/** Newest first. */
const byVersionDescending = <R extends Versioned>(releases: ReadonlyArray<R>): ReadonlyArray<R> =>
	[...releases].sort((a, b) => b.version.compare(a.version));

/**
 * Build an empty index.
 *
 * The index starts empty and `"cache"`: an index nobody loaded has certainly
 * not been served from an API.
 */
export const make = <R extends Versioned>(): Effect.Effect<ReleaseIndex<R>> =>
	Effect.gen(function* () {
		const state = yield* Ref.make<IndexState<R>>({ releases: [], source: "cache" });

		const filter = (range: Range): Effect.Effect<ReadonlyArray<R>> =>
			Ref.get(state).pipe(Effect.map(({ releases }) => releases.filter((r) => range.test(r.version))));

		return {
			load: (releases, source) => Ref.set(state, { releases: byVersionDescending(releases), source }),
			releases: Ref.get(state).pipe(Effect.map(({ releases }) => releases)),
			source: Ref.get(state).pipe(Effect.map(({ source }) => source)),
			filter,
			// `filter` is already newest-first, so the first match is the newest.
			resolve: (range) => filter(range).pipe(Effect.map((matches) => Option.fromUndefinedOr(matches[0]))),
		};
	});

/**
 * Collapse releases to one per major, one per minor, or leave every patch.
 *
 * Input is newest-first, so the first release seen for a group key is that
 * group's winner and later ones are older — no comparison needed.
 */
export const groupByIncrements = <R extends Versioned>(
	releases: ReadonlyArray<R>,
	increments: RawIncrements,
): ReadonlyArray<R> => {
	if (increments === "patch") return releases;

	const seen = new Map<string, R>();
	for (const release of releases) {
		const key =
			increments === "latest" ? String(release.version.major) : `${release.version.major}.${release.version.minor}`;
		if (!seen.has(key)) seen.set(key, release);
	}
	return [...seen.values()];
};

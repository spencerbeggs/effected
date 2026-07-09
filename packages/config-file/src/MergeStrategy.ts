import { Effect } from "effect";
import { deepMerge, isPlainObject } from "./internal/deepMerge.js";

/**
 * A single configuration source discovered during a resolver-chain pass.
 *
 * @public
 */
export interface ConfigSource<A> {
	/** The filesystem path the value was read from. */
	readonly path: string;
	/** The name of the resolver that found it. */
	readonly resolver: string;
	/** The decoded, validated configuration value. */
	readonly value: A;
}

/** A source list guaranteed non-empty by the caller. @public */
export type NonEmptySources<A> = readonly [ConfigSource<A>, ...ConfigSource<A>[]];

/**
 * Strategy for combining several {@link ConfigSource} entries into one value.
 *
 * @remarks
 * Sources arrive in priority order, highest first. The list is non-empty by
 * construction — the empty case is the pipeline's concern and raises
 * `ConfigFileNotFoundError` before a strategy is ever consulted — so a strategy
 * cannot fail.
 *
 * @public
 */
export interface MergeStrategy<A> {
	readonly name: string;
	readonly resolve: (sources: NonEmptySources<A>) => Effect.Effect<A>;
}

const firstMatch = <A>(): MergeStrategy<A> => ({
	name: "first-match",
	resolve: (sources) => Effect.succeed(sources[0].value),
});

const layeredMerge = <A>(): MergeStrategy<A> => ({
	name: "layered-merge",
	resolve: (sources) => {
		// Fold from lowest priority upward so higher-priority keys overwrite.
		let merged: unknown = sources[sources.length - 1]?.value;
		for (let i = sources.length - 2; i >= 0; i--) {
			const higher = sources[i]?.value;
			merged = isPlainObject(merged) && isPlainObject(higher) ? deepMerge(higher, merged) : higher;
		}
		return Effect.succeed(merged as A);
	},
});

/**
 * Built-in merge strategies.
 *
 * @remarks
 * Renamed from v3's `ConfigWalkStrategy`, which never walked anything — the
 * thing that walks is the `upwardWalk` resolver.
 *
 * @public
 */
export const MergeStrategy = { firstMatch, layeredMerge } as const;

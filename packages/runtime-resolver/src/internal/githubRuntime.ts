/**
 * The layer builder shared by the two GitHub-hosted runtimes.
 *
 * Bun and Deno are the same resolver pointed at a different repository. v3
 * expressed that with two release-cache services, two fetcher services, two
 * resolver services and six strategy layers whose only textual difference was
 * the string `"oven-sh"` versus `"denoland"`.
 *
 * @internal
 */

import type { InvalidRangeError, SemVer } from "@effected/semver";
import type { Context, DateTime } from "effect";
import { Effect, Layer, Option } from "effect";
import type { GitHubError } from "../GitHub.js";
import { GitHubClient } from "../GitHub.js";
import type {
	Increments,
	NoMatchingVersionError,
	ResolvedVersions,
	UnresolvableDefaultError,
} from "../ResolvedVersions.js";
import { buildReleases, fetchGitHubReleases } from "./feeds.js";
import * as ReleaseIndex from "./releaseIndex.js";
import { resolveWith } from "./resolve.js";
import type { RawRelease } from "./types.js";

/** Options accepted by the Bun and Deno resolvers. Neither has phases or LTS. */
export interface GitHubRuntimeOptions {
	readonly range?: string;
	readonly increments?: Increments;
	readonly defaultVersion?: string;
}

/** The service shape both resolvers expose. */
export interface GitHubRuntimeShape {
	readonly resolve: (
		options?: GitHubRuntimeOptions,
	) => Effect.Effect<ResolvedVersions, InvalidRangeError | NoMatchingVersionError | UnresolvableDefaultError>;
}

/** What a resolver needs to know about its runtime, independent of strategy. */
export interface GitHubRuntimeSpec<Self, R extends { readonly version: SemVer }> {
	readonly tag: Context.Key<Self, GitHubRuntimeShape>;
	readonly runtime: "bun" | "deno";
	readonly owner: string;
	readonly repo: string;
	readonly spanName: string;
	readonly defaults: ReadonlyArray<RawRelease>;
	readonly make: (fields: { readonly version: SemVer; readonly date: DateTime.Utc }) => R;
}

/**
 * Build a layer for a GitHub-hosted runtime around a strategy.
 *
 * The strategy's channels flow out into the layer's, so `layerOffline` requires
 * no `GitHubClient` and `layer` cannot fail — stated by the types, not asserted
 * by a cast.
 */
export const build = <Self, R extends { readonly version: SemVer }, E, RIn>(
	spec: GitHubRuntimeSpec<Self, R>,
	strategy: (
		index: ReleaseIndex.ReleaseIndex<R>,
		live: Effect.Effect<ReadonlyArray<R>, GitHubError, GitHubClient>,
		offline: Effect.Effect<ReadonlyArray<R>>,
	) => Effect.Effect<void, E, RIn>,
): Layer.Layer<Self, E, RIn> => {
	const { tag, runtime, owner, repo, spanName, defaults, make } = spec;

	return Layer.effect(
		tag,
		Effect.gen(function* () {
			const index = yield* ReleaseIndex.make<R>();

			// The client is pulled from the context inside `live`, so only the
			// strategies that actually fetch carry a `GitHubClient` requirement.
			const live = Effect.gen(function* () {
				const client = yield* GitHubClient;
				const raw = yield* fetchGitHubReleases(client, owner, repo);
				return yield* buildReleases(raw, make);
			});

			const offline = buildReleases(defaults, make);

			yield* strategy(index, live, offline);

			return {
				resolve: Effect.fn(spanName)(function* (options?: GitHubRuntimeOptions) {
					const range = options?.range ?? "*";
					yield* Effect.annotateCurrentSpan({ runtime, range });

					return yield* resolveWith({
						index,
						runtime,
						constraint: range,
						increments: options?.increments ?? "latest",
						defaultVersion: options?.defaultVersion,
						defaultsToLts: false,
						refine: (releases) => releases,
						pickLts: () => Option.none(),
					});
				}),
			};
		}),
	);
};

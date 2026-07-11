/**
 * Resolve semver-compatible Node.js, Bun and Deno runtime versions.
 *
 * Three resolver services, each available in three cache strategies:
 *
 * - `layer` — fetch live, fall back to the bundled snapshot (and say so).
 * - `layerFresh` — live data or a typed failure.
 * - `layerOffline` — the bundled snapshot, no IO, no requirements.
 *
 * Every result carries honest provenance in its `source` field.
 *
 * @example
 * ```ts
 * import { GitHubClient, BunResolver, NodeResolver } from "@effected/runtime-resolver";
 * import { Effect, Layer } from "effect";
 * import { FetchHttpClient } from "effect/unstable/http";
 *
 * const program = Effect.gen(function* () {
 *   const node = yield* NodeResolver;
 *   const bun = yield* BunResolver;
 *   return {
 *     node: (yield* node.resolve({ range: ">=20", phases: ["active-lts"] })).latest,
 *     bun: (yield* bun.resolve({ range: "^1.0.0" })).latest,
 *   };
 * });
 *
 * const layer = Layer.mergeAll(
 *   NodeResolver.layer.pipe(Layer.provide(FetchHttpClient.layer)),
 *   BunResolver.layer.pipe(Layer.provide(GitHubClient.layerDefault)),
 * );
 *
 * Effect.runPromise(program.pipe(Effect.provide(layer)));
 * ```
 *
 * @see {@link https://effect.website | Effect}
 *
 * @packageDocumentation
 */

export { BunRelease, BunResolver, BunResolverOptions } from "./BunResolver.js";
export { DenoRelease, DenoResolver, DenoResolverOptions } from "./DenoResolver.js";
export {
	AuthenticationError,
	GitHubAuth,
	type GitHubAuthShape,
	GitHubClient,
	type GitHubClientShape,
	type GitHubError,
	GitHubRelease,
	GitHubTag,
	type ListOptions,
	NetworkError,
	RateLimitError,
	ResponseParseError,
} from "./GitHub.js";
export { NodeRelease } from "./NodeRelease.js";
export { NodeResolver, NodeResolverOptions } from "./NodeResolver.js";
export {
	InvalidScheduleDateError,
	NodePhase,
	type NodeReleaseLine,
	NodeSchedule,
	NodeScheduleData,
	NodeScheduleEntry,
	isLtsPhase,
	nodeReleaseLine,
} from "./NodeSchedule.js";
export {
	FreshnessError,
	Increments,
	NoMatchingVersionError,
	ResolvedVersions,
	Runtime,
	Source,
	UnresolvableDefaultError,
} from "./ResolvedVersions.js";

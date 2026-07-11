/**
 * Resolving Node.js versions.
 *
 * @packageDocumentation
 */

import type { InvalidRangeError } from "@effected/semver";
import { Context, DateTime, Effect, Layer, Option, Ref, Schema } from "effect";
import type { HttpClient } from "effect/unstable/http";
import type { GitHubError } from "./GitHub.js";
import { nodeDefaults, nodeScheduleDefaults } from "./internal/defaults/node.js";
import { buildNodeReleases, fetchNodeReleases, fetchNodeSchedule } from "./internal/feeds.js";
import * as ReleaseIndex from "./internal/releaseIndex.js";
import { resolveWith } from "./internal/resolve.js";
import { populateAuto, populateFresh, populateOffline } from "./internal/strategy.js";
import type { NodeRelease } from "./NodeRelease.js";
import type { InvalidScheduleDateError } from "./NodeSchedule.js";
import { NodePhase, NodeSchedule } from "./NodeSchedule.js";
import type { FreshnessError, NoMatchingVersionError, ResolvedVersions } from "./ResolvedVersions.js";
import { Increments } from "./ResolvedVersions.js";

/**
 * How to resolve Node.js versions.
 *
 * @public
 */
export const NodeResolverOptions = Schema.Struct({
	/** The semver range to match. Defaults to `*`. */
	range: Schema.optionalKey(Schema.String),
	/** Lifecycle phases to accept. Defaults to `current` and `active-lts`. */
	phases: Schema.optionalKey(Schema.Array(NodePhase)),
	/** How to group matches. Defaults to `latest`. */
	increments: Schema.optionalKey(Increments),
	/** A range whose newest match becomes the `default` field. Defaults to the LTS pick. */
	defaultVersion: Schema.optionalKey(Schema.String),
	/** The moment to evaluate lifecycle phases at. Defaults to now, read from `Clock`. */
	date: Schema.optionalKey(Schema.DateTimeUtc),
});

/**
 * How to resolve Node.js versions.
 *
 * @public
 */
export type NodeResolverOptions = typeof NodeResolverOptions.Type;

const DEFAULT_PHASES: ReadonlyArray<NodePhase> = ["current", "active-lts"];

/**
 * The Node.js resolver.
 *
 * @example
 * ```ts
 * import { NodeResolver } from "@effected/runtime-resolver";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const resolver = yield* NodeResolver;
 *   const result = yield* resolver.resolve({ range: ">=20", phases: ["active-lts"] });
 *   return result.latest;
 * }).pipe(Effect.provide(NodeResolver.layerOffline));
 * ```
 *
 * @public
 */
export class NodeResolver extends Context.Service<
	NodeResolver,
	{
		readonly resolve: (
			options?: NodeResolverOptions,
		) => Effect.Effect<ResolvedVersions, InvalidRangeError | NoMatchingVersionError>;
	}
>()("@effected/runtime-resolver/NodeResolver") {
	/**
	 * Try the live feeds, fall back to the bundled snapshot.
	 *
	 * A fallback is recorded as `source: "cache"` and logged, so a caller can
	 * always tell a live answer from a snapshot.
	 */
	static readonly layer: Layer.Layer<NodeResolver, never, HttpClient.HttpClient> = build(this, (index, live, offline) =>
		populateAuto(index, "node", live, offline),
	);

	/**
	 * Live feeds or nothing. Fails with `FreshnessError` when they cannot be reached.
	 */
	static readonly layerFresh: Layer.Layer<NodeResolver, FreshnessError, HttpClient.HttpClient> = build(
		this,
		(index, live) => populateFresh(index, "node", live),
	);

	/**
	 * The bundled snapshot only. Performs no IO and requires nothing.
	 */
	static readonly layerOffline: Layer.Layer<NodeResolver> = build(this, (index, _live, offline) =>
		populateOffline(index, offline),
	);
}

/** The live feed, and the snapshot. Both also refresh the schedule the resolver reads. */
type Load = Effect.Effect<ReadonlyArray<NodeRelease>, InvalidScheduleDateError | GitHubError, HttpClient.HttpClient>;

/** What `NodeResolver` puts in the context. */
interface NodeResolverShape {
	readonly resolve: (
		options?: NodeResolverOptions,
	) => Effect.Effect<ResolvedVersions, InvalidRangeError | NoMatchingVersionError>;
}

/**
 * Assemble a Node resolver layer around a strategy.
 *
 * The strategy's own error and requirement channels flow straight out into the
 * layer's, so `layerOffline` genuinely requires nothing and `layer` genuinely
 * cannot fail — no casts, and the types say what is true.
 *
 * The tag arrives as `this`: a static initializer runs while the module-scope
 * `NodeResolver` binding is still in its temporal dead zone, so naming the class
 * here throws at import time.
 */
function build<E, RIn>(
	tag: Context.Key<NodeResolver, NodeResolverShape>,
	strategy: (
		index: ReleaseIndex.ReleaseIndex<NodeRelease>,
		live: Load,
		offline: Effect.Effect<ReadonlyArray<NodeRelease>>,
	) => Effect.Effect<void, E, RIn>,
): Layer.Layer<NodeResolver, E, RIn> {
	return Layer.effect(
		tag,
		Effect.gen(function* () {
			const index = yield* ReleaseIndex.make<NodeRelease>();
			const scheduleRef = yield* Ref.make(NodeSchedule.empty);

			const live: Load = Effect.gen(function* () {
				const [raw, scheduleData] = yield* Effect.all([fetchNodeReleases(), fetchNodeSchedule()]);
				yield* Ref.set(scheduleRef, yield* NodeSchedule.fromData(scheduleData));
				return yield* buildNodeReleases(raw);
			}).pipe(
				// A release whose version string is unparseable is skipped upstream, so
				// this cannot surface; keeping it out of the channel keeps the strategy
				// honest about what a caller can actually see.
				Effect.catchTag("InvalidVersionError", (cause) => Effect.die(cause)),
			);

			const offline = Effect.gen(function* () {
				yield* Ref.set(scheduleRef, yield* NodeSchedule.fromData(nodeScheduleDefaults));
				return yield* buildNodeReleases(nodeDefaults);
			}).pipe(
				// The bundled snapshot ships with the package and is generated from these
				// same feeds. If it does not parse, that is a build-time bug, not a data
				// condition a caller could recover from.
				Effect.orDie,
			);

			yield* strategy(index, live, offline);

			return {
				resolve: Effect.fn("NodeResolver.resolve")(function* (options?: NodeResolverOptions) {
					const range = options?.range ?? "*";
					const phases = options?.phases ?? DEFAULT_PHASES;
					const now = options?.date ?? (yield* DateTime.now);
					const schedule = yield* Ref.get(scheduleRef);

					yield* Effect.annotateCurrentSpan({ runtime: "node", range });

					return yield* resolveWith({
						index,
						runtime: "node",
						constraint: range,
						increments: options?.increments ?? "latest",
						defaultVersion: options?.defaultVersion,
						phases,
						defaultsToLts: true,
						refine: (releases) =>
							releases.filter((release) =>
								Option.match(release.phase(schedule, now), {
									onNone: () => false,
									onSome: (phase) => phases.includes(phase),
								}),
							),
						pickLts: (releases) => Option.fromUndefinedOr(releases.find((release) => release.isLts(schedule, now))),
					});
				}),
			};
		}),
	);
}

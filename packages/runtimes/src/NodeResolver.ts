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
import { once } from "./internal/once.js";
import * as ReleaseIndex from "./internal/releaseIndex.js";
import { resolveWith } from "./internal/resolve.js";
import { populateAuto, populateFresh, populateOffline } from "./internal/strategy.js";
import type { NodeRelease } from "./NodeRelease.js";
import type { InvalidScheduleDateError } from "./NodeSchedule.js";
import { NodePhase, NodeSchedule } from "./NodeSchedule.js";
import type {
	FreshnessError,
	NoMatchingVersionError,
	ResolvedVersions,
	UnresolvableDefaultError,
} from "./ResolvedVersions.js";
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
 * import { NodeResolver } from "@effected/runtimes";
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
		) => Effect.Effect<
			ResolvedVersions,
			InvalidRangeError | NoMatchingVersionError | UnresolvableDefaultError | FreshnessError
		>;
	}
>()("@effected/runtimes/NodeResolver") {
	/**
	 * Try the live feeds, fall back to the bundled snapshot.
	 *
	 * Lazy: building the layer performs no IO. The feeds are fetched by the
	 * first `resolve` and shared by every later (and concurrent) one; a
	 * fallback to the snapshot is memoized like any other successful
	 * population, recorded as `source: "cache"` and logged, so a caller can
	 * always tell a live answer from a snapshot.
	 */
	static readonly layer: Layer.Layer<NodeResolver, never, HttpClient.HttpClient> = build(this, (index, live, offline) =>
		populateAuto(index, "node", live, offline),
	);

	/**
	 * Live feeds or nothing.
	 *
	 * Lazy: building the layer performs no IO, so unreachable feeds surface as
	 * a `FreshnessError` from `resolve`, not from layer acquisition. A failed
	 * fetch is not memoized — the next `resolve` retries; a successful one is.
	 */
	static readonly layerFresh: Layer.Layer<NodeResolver, never, HttpClient.HttpClient> = build(this, (index, live) =>
		populateFresh(index, "node", live),
	);

	/**
	 * The bundled snapshot only. Requires nothing and performs no IO — the
	 * snapshot is decoded lazily by the first `resolve`, like the live layers.
	 */
	static readonly layerOffline: Layer.Layer<NodeResolver> = build(this, (index, _live, offline) =>
		populateOffline(index, offline),
	);
}

/** The live feed, and the snapshot. Both also refresh the schedule the resolver reads. */
type Load = Effect.Effect<ReadonlyArray<NodeRelease>, InvalidScheduleDateError | GitHubError, HttpClient.HttpClient>;

/**
 * What `NodeResolver` puts in the context.
 *
 * This restates the shape written inline in the `Context.Service` generic above,
 * and the duplication is load-bearing rather than an oversight. Referencing this
 * interface from the heritage clause instead makes API Extractor emit
 * `ae-forgotten-export` — *"The symbol NodeResolverShape needs to be exported by
 * the entry point index.d.ts"*, `ciFatal: true` — because the synthesized
 * `NodeResolver_base` then names a symbol no consumer can import. The `_base`
 * suppression in `savvy.build.ts` deliberately does not cover that: it is scoped
 * to the synthesized bases themselves, so a genuine surface leak still fails the
 * gate. (Measured: deduping takes `dist/prod/issues.json` from 0 warnings to 1.)
 *
 * The alternatives are worse than the repetition: exporting the shape would put a
 * second name for the service contract on the public API, and the two GitHub-hosted
 * resolvers already make this same trade for the same reason. Nothing can drift —
 * `build` takes a `Context.Key<NodeResolver, NodeResolverShape>`, so the two
 * spellings must agree or the module does not compile.
 */
interface NodeResolverShape {
	readonly resolve: (
		options?: NodeResolverOptions,
	) => Effect.Effect<
		ResolvedVersions,
		InvalidRangeError | NoMatchingVersionError | UnresolvableDefaultError | FreshnessError
	>;
}

/**
 * Assemble a **lazy** Node resolver layer around a strategy.
 *
 * Acquisition performs no IO: it builds the empty index, captures the
 * strategy's requirements from the layer scope, and gates the strategy behind
 * a run-once memo (see `internal/once.ts`). The first `resolve` runs the
 * population; concurrent first resolves share it; success is memoized for the
 * layer's lifetime while a failure (only the fresh strategy can produce one)
 * is retried by the next resolve.
 *
 * The strategy's requirement channel still flows straight out into the
 * layer's, so `layerOffline` genuinely requires nothing, and its error channel
 * flows into `resolve`'s — no casts, and the types say what is true.
 *
 * The tag arrives as `this`: a static initializer runs while the module-scope
 * `NodeResolver` binding is still in its temporal dead zone, so naming the class
 * here throws at import time.
 */
function build<E extends FreshnessError, RIn>(
	tag: Context.Key<NodeResolver, NodeResolverShape>,
	strategy: (
		index: ReleaseIndex.ReleaseIndex<NodeRelease>,
		live: Load,
		offline: Effect.Effect<ReadonlyArray<NodeRelease>>,
	) => Effect.Effect<void, E, RIn>,
): Layer.Layer<NodeResolver, never, RIn> {
	return Layer.effect(
		tag,
		Effect.gen(function* () {
			const index = yield* ReleaseIndex.make<NodeRelease>();
			const scheduleRef = yield* Ref.make(NodeSchedule.empty);

			const live: Load = Effect.gen(function* () {
				// `Effect.all` defaults to `concurrency: 1` (sequential). These two
				// network calls are independent, so we must opt into overlap explicitly.
				const [raw, scheduleData] = yield* Effect.all([fetchNodeReleases(), fetchNodeSchedule()], {
					concurrency: 2,
				});
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

			const populate = yield* once(strategy(index, live, offline));

			return {
				resolve: Effect.fn("NodeResolver.resolve")(function* (options?: NodeResolverOptions) {
					yield* populate;
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

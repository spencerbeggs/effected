import { Context, Effect, Layer, Option, Schema } from "effect";

/**
 * Discriminated union of typed progress events emitted during registry
 * operations.
 *
 * @remarks
 * The consumer-facing progress surface. Emission is opt-in and zero-cost:
 * internal call sites resolve the {@link RegistryObserver} via
 * `Effect.serviceOption`, so no requirement is added to any signature and
 * absence is a no-op. The library performs no `Effect.log` of its own — the
 * host owns presentation.
 *
 * Schema-backed (the store `CacheEventPayload` precedent) because events
 * cross the library/host boundary and hosts ship them to telemetry. Narrow
 * with `switch (event._tag)` or `Match`.
 *
 * @public
 */
export const RegistryEvent = Schema.Union([
	/** A version reference (range, tag, or exact) was resolved to a pinned version. */
	Schema.TaggedStruct("VersionResolved", {
		package: Schema.String,
		requested: Schema.String,
		resolved: Schema.String,
	}),
	/** A version reference could not be resolved, classified from typed error fields. */
	Schema.TaggedStruct("VersionResolveFailed", {
		package: Schema.String,
		requested: Schema.String,
		kind: Schema.Literals(["not-found", "no-match", "network"]),
	}),
	/** A package was found live in the cache. */
	Schema.TaggedStruct("CacheHit", {
		package: Schema.String,
		version: Schema.String,
		/** How long ago the entry was cached. */
		age: Schema.Duration,
	}),
	/** Files are on disk but the metadata entry expired — the cache is stale. */
	Schema.TaggedStruct("CacheStale", { package: Schema.String, version: Schema.String }),
	/** A package was not present in the cache. */
	Schema.TaggedStruct("CacheMiss", { package: Schema.String, version: Schema.String }),
	/** A network fetch began for a package. */
	Schema.TaggedStruct("FetchStart", { package: Schema.String, version: Schema.String }),
	/** A single HTTP request returned a non-2xx response. */
	Schema.TaggedStruct("FetchFailed", {
		url: Schema.String,
		status: Schema.Number,
		bodySnippet: Schema.String,
	}),
	/** A package was loaded successfully (from cache or network). */
	Schema.TaggedStruct("PackageLoaded", {
		package: Schema.String,
		version: Schema.String,
		files: Schema.Number,
		source: Schema.Literals(["cache", "network"]),
		duration: Schema.Duration,
	}),
	/** Loading a package failed, classified from typed error tags and fields. */
	Schema.TaggedStruct("PackageLoadFailed", {
		package: Schema.String,
		version: Schema.String,
		kind: Schema.Literals(["not-found", "version-range", "schema", "network", "cache", "unknown"]),
		/** The typed error itself, preserved structurally. */
		error: Schema.Defect(),
	}),
	/** A batch load started for multiple packages. */
	Schema.TaggedStruct("BatchStart", {
		total: Schema.Number,
		packages: Schema.Array(Schema.String),
	}),
	/** A batch load completed with summary statistics. */
	Schema.TaggedStruct("BatchComplete", {
		loaded: Schema.Number,
		failed: Schema.Number,
		total: Schema.Number,
		totalFiles: Schema.Number,
		duration: Schema.Duration,
	}),
]);

/**
 * The decoded form of {@link (RegistryEvent:variable)}: a tagged union the
 * host narrows with `switch (event._tag)`.
 *
 * @public
 */
export type RegistryEvent = typeof RegistryEvent.Type;

/**
 * The service shape {@link RegistryObserver} provides: a single `emit` the
 * host implements.
 *
 * @public
 */
export interface RegistryObserverShape {
	/** Handle one {@link (RegistryEvent:type)}. */
	readonly emit: (event: RegistryEvent) => Effect.Effect<void>;
}

/**
 * The opt-in registry event observer.
 *
 * @remarks
 * Providing no observer layer is the default and costs nothing — every
 * internal emission site resolves this service via `Effect.serviceOption`
 * and no-ops on absence. Events here are progress reporting for a host UI —
 * a push callback with no subscription lifecycle or `Scope`, usable from
 * non-Effect hosts. (The store `Cache` exposes a `PubSub` instead because
 * its events are intrinsic to an eviction-bearing store; the two postures
 * are deliberate and should not be unified.)
 *
 * @example
 * ```ts
 * import { RegistryObserver } from "@effected/ts-vfs";
 *
 * const ObserverLayer = RegistryObserver.layerCallback((event) => {
 *   if (event._tag === "PackageLoadFailed") console.warn(event.package, event.kind);
 * });
 * ```
 *
 * @public
 */
export class RegistryObserver extends Context.Service<RegistryObserver, RegistryObserverShape>()(
	"@effected/ts-vfs/RegistryObserver",
) {
	/**
	 * Build an observer layer from a plain callback — the lowest-friction
	 * bridge for non-Effect hosts.
	 *
	 * @remarks
	 * A throwing callback is a programmer bug and stays a defect; it is not
	 * laundered into any typed error channel.
	 */
	static layerCallback(onEvent: (event: RegistryEvent) => void): Layer.Layer<RegistryObserver> {
		return Layer.succeed(RegistryObserver, {
			emit: (event) => Effect.sync(() => onEvent(event)),
		});
	}

	/**
	 * A no-op observer. Equivalent to providing nothing, but explicit — makes
	 * "events are intentionally dropped" visible in a composition.
	 */
	static readonly layerNoop: Layer.Layer<RegistryObserver> = Layer.succeed(RegistryObserver, {
		emit: () => Effect.void,
	});
}

/**
 * Emit a {@link (RegistryEvent:type)} to the host's observer, if one is
 * provided. Internal emission sites use this; it adds no requirement to the
 * caller's signature and is a no-op when no observer layer is in scope.
 *
 * @internal
 */
export const emit = (event: RegistryEvent): Effect.Effect<void> =>
	Effect.serviceOption(RegistryObserver).pipe(
		Effect.flatMap(
			Option.match({
				onNone: () => Effect.void,
				onSome: (observer) => observer.emit(event),
			}),
		),
	);

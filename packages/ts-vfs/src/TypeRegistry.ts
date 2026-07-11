import { Range, SemVer } from "@effected/semver";
import type { Duration } from "effect";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { packageJsonUrl } from "./internal/jsdelivr.js";
import {
	FetchError,
	PackageFetcher,
	PackageManifest,
	PackageNotFoundError,
	VersionNotFoundError,
} from "./PackageFetcher.js";
import type { PackageSpec } from "./PackageSpec.js";
import type { RegistryEvent } from "./RegistryEvent.js";
import { emit } from "./RegistryEvent.js";
import type { CachePruneResult, TypeCacheError } from "./TypeCache.js";
import { TypeCache, TypeCacheMetadata } from "./TypeCache.js";
import type { ResolvedModule } from "./TypeResolver.js";
import { TypeResolver } from "./TypeResolver.js";
import type { Vfs } from "./Vfs.js";
import { mergeVfs } from "./Vfs.js";

/**
 * Raised by {@link TypeRegistryShape.getVfs} when **every** requested package
 * fails.
 *
 * @remarks
 * Carries the per-package failures structurally. v3 abused
 * `PackageNotFoundError` for this case, with a comma-joined `name` and an
 * empty `version`.
 *
 * @public
 */
export class BatchLoadError extends Schema.TaggedErrorClass<BatchLoadError>()("BatchLoadError", {
	/** One entry per failed package, with its typed error preserved. */
	failures: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			version: Schema.String,
			error: Schema.Defect(),
		}),
	),
}) {
	override get message(): string {
		return `Failed to load type definitions for all ${this.failures.length} requested package(s)`;
	}
}

/**
 * Options for {@link TypeRegistryShape.getPackageVfs} and
 * {@link TypeRegistryShape.getVfs}.
 *
 * @public
 */
export interface PackageVfsOptions {
	/**
	 * Fetch from the CDN when the package is missing or stale. Defaults to
	 * `true`. With `false`, a stale entry is served from disk and a miss fails
	 * with `PackageNotFoundError`.
	 */
	readonly autoFetch?: boolean;
	/** Time-to-live recorded for newly cached entries; absent = never expires. */
	readonly ttl?: Duration.Duration;
}

/**
 * The service shape {@link TypeRegistry} provides.
 *
 * @public
 */
export interface TypeRegistryShape {
	/** Report whether the package's files are already on disk. */
	readonly hasCached: (pkg: PackageSpec) => Effect.Effect<boolean, TypeCacheError>;
	/** Fetch a pinned package's manifest and declaration files and cache them. */
	readonly fetchAndCache: (
		pkg: PackageSpec,
		options?: { readonly ttl?: Duration.Duration },
	) => Effect.Effect<void, FetchError | PackageNotFoundError | TypeCacheError>;
	/**
	 * Build the {@link Vfs} for one package, fetching it first when missing or
	 * stale (the stale-vs-miss ladder: live metadata → hit; files on disk with
	 * no live metadata → stale, refetched when `autoFetch`, served as-is
	 * otherwise; nothing → miss, fetched or failed typed on
	 * `autoFetch: false`).
	 */
	readonly getPackageVfs: (
		pkg: PackageSpec,
		options?: PackageVfsOptions,
	) => Effect.Effect<Vfs, FetchError | PackageNotFoundError | TypeCacheError>;
	/**
	 * Build a merged {@link Vfs} for several packages, best-effort.
	 *
	 * @remarks
	 * Loads concurrently (limit 5), accumulates per-package failures, merges
	 * the partial results, and fails — with a structured
	 * {@link BatchLoadError} — only when every package fails. An empty
	 * `packages` array is not an error: it yields an empty `Vfs`.
	 */
	readonly getVfs: (
		packages: ReadonlyArray<PackageSpec>,
		options?: PackageVfsOptions,
	) => Effect.Effect<Vfs, BatchLoadError>;
	/**
	 * Resolve an import specifier against a cached package's manifest.
	 * `Option.none()` when the manifest offers no evidence for the subpath.
	 */
	readonly resolveImport: (
		pkg: PackageSpec,
		specifier: string,
	) => Effect.Effect<Option.Option<ResolvedModule>, TypeCacheError | FetchError>;
	/** Enumerate a cached package's type entry points. */
	readonly getTypeEntries: (
		pkg: PackageSpec,
	) => Effect.Effect<ReadonlyArray<ResolvedModule>, TypeCacheError | FetchError>;
	/**
	 * Resolve a version reference — dist-tag, exact version or semver range —
	 * to a pinned version string, locally.
	 *
	 * @remarks
	 * Dist-tags resolve through the CDN's tag map; exact versions match the
	 * published list; ranges resolve with `@effected/semver`
	 * (max-satisfying). No CDN `/resolve` endpoint, no error-prose parsing —
	 * an unmatched ref fails as a typed {@link VersionNotFoundError}.
	 */
	readonly resolveVersion: (name: string, ref: string) => Effect.Effect<string, FetchError | VersionNotFoundError>;
	/** Remove one package from the cache (metadata first, then files). */
	readonly clearCache: (pkg: PackageSpec) => Effect.Effect<void, TypeCacheError>;
	/** Evict every expired package from the cache. */
	readonly pruneCache: Effect.Effect<CachePruneResult, TypeCacheError>;
}

/**
 * Classify a per-package load failure into a stable `PackageLoadFailed`
 * event kind — from typed error tags and structured fields, never from
 * message substrings (v3's `classifyLoadError` did substring matching over
 * stringified errors; it is dead).
 */
const classify = (error: unknown): (RegistryEvent & { readonly _tag: "PackageLoadFailed" })["kind"] => {
	if (typeof error !== "object" || error === null || !("_tag" in error)) return "unknown";
	switch (error._tag) {
		case "PackageNotFoundError":
			return "not-found";
		case "VersionNotFoundError":
			return "version-range";
		case "TypeCacheError":
			return "cache";
		case "FetchError": {
			const fetchError = error as FetchError;
			if (fetchError.status === 404) return "not-found";
			if (fetchError.kind === "schema") return "schema";
			return "network";
		}
		default:
			return "unknown";
	}
};

const make: Effect.Effect<TypeRegistryShape, never, TypeCache | PackageFetcher> = Effect.gen(function* () {
	const cache = yield* TypeCache;
	const fetcher = yield* PackageFetcher;

	const fetchAndCacheImpl = (
		pkg: PackageSpec,
		options?: { readonly ttl?: Duration.Duration },
	): Effect.Effect<void, FetchError | PackageNotFoundError | TypeCacheError> =>
		Effect.gen(function* () {
			yield* emit({ _tag: "FetchStart", package: pkg.name, version: pkg.version });
			const manifest = yield* fetcher.getPackageJson(pkg);
			const typeFiles = yield* fetcher.getTypeFiles(pkg);
			yield* cache.write(pkg, "package.json", JSON.stringify(manifest, null, 2));
			for (const [filePath, content] of typeFiles) {
				const normalized = filePath.replace(/^\/+/, "");
				if (normalized !== "package.json") {
					yield* cache.write(pkg, normalized, content);
				}
			}
			const now = yield* DateTime.now;
			yield* cache.writeMetadata(
				pkg,
				TypeCacheMetadata.make({
					version: pkg.version,
					cachedAt: now,
					...(options?.ttl !== undefined ? { ttl: options.ttl } : {}),
				}),
			);
		});

	const getPackageVfsImpl = (
		pkg: PackageSpec,
		options?: PackageVfsOptions,
	): Effect.Effect<Vfs, FetchError | PackageNotFoundError | TypeCacheError> =>
		Effect.gen(function* () {
			const autoFetch = options?.autoFetch ?? true;
			const [duration, result] = yield* Effect.timed(
				Effect.gen(function* () {
					// Metadata lives in the store; `readMetadata` returns `None` when the
					// entry is absent or its TTL has expired (expiry evicts on read).
					// Disk presence then distinguishes stale (files present, metadata
					// gone) from an outright miss.
					const metadata = yield* cache.readMetadata(pkg);
					const diskExists = yield* cache.exists(pkg);
					let source: "cache" | "network" = "cache";

					if (Option.isSome(metadata)) {
						const now = yield* DateTime.now;
						yield* emit({
							_tag: "CacheHit",
							package: pkg.name,
							version: pkg.version,
							age: DateTime.distance(metadata.value.cachedAt, now),
						});
					} else if (diskExists) {
						yield* emit({ _tag: "CacheStale", package: pkg.name, version: pkg.version });
						if (autoFetch) {
							yield* fetchAndCacheImpl(pkg, options);
							source = "network";
						}
						// autoFetch: false serves the on-disk files without refetching.
					} else if (autoFetch) {
						yield* emit({ _tag: "CacheMiss", package: pkg.name, version: pkg.version });
						yield* fetchAndCacheImpl(pkg, options);
						source = "network";
					} else {
						return yield* Effect.fail(new PackageNotFoundError({ name: pkg.name, version: pkg.version }));
					}

					const vfs = yield* cache.getVfs(pkg);
					return { vfs, source };
				}),
			);
			yield* emit({
				_tag: "PackageLoaded",
				package: pkg.name,
				version: pkg.version,
				files: result.vfs.size,
				source: result.source,
				duration,
			});
			return result.vfs;
		});

	const readManifest = (pkg: PackageSpec): Effect.Effect<PackageManifest, TypeCacheError | FetchError> =>
		Effect.gen(function* () {
			const content = yield* cache.read(pkg, "package.json");
			const parsed = yield* Effect.try({
				try: () => JSON.parse(content) as unknown,
				catch: (cause) => new FetchError({ url: packageJsonUrl(pkg), kind: "schema", cause }),
			});
			return yield* Schema.decodeUnknownEffect(PackageManifest)(parsed).pipe(
				Effect.mapError((cause) => new FetchError({ url: packageJsonUrl(pkg), kind: "schema", cause })),
			);
		});

	const hasCached = Effect.fn("TypeRegistry.hasCached")(function* (pkg: PackageSpec) {
		return yield* cache.exists(pkg);
	});

	const fetchAndCache = Effect.fn("TypeRegistry.fetchAndCache")(function* (
		pkg: PackageSpec,
		options?: { readonly ttl?: Duration.Duration },
	) {
		return yield* fetchAndCacheImpl(pkg, options);
	});

	const getPackageVfs = Effect.fn("TypeRegistry.getPackageVfs")(function* (
		pkg: PackageSpec,
		options?: PackageVfsOptions,
	) {
		return yield* getPackageVfsImpl(pkg, options);
	});

	const getVfs = Effect.fn("TypeRegistry.getVfs")(function* (
		packages: ReadonlyArray<PackageSpec>,
		options?: PackageVfsOptions,
	) {
		yield* emit({ _tag: "BatchStart", total: packages.length, packages: packages.map((pkg) => pkg.toString()) });
		const [duration, results] = yield* Effect.timed(
			Effect.forEach(
				packages,
				(pkg) =>
					getPackageVfsImpl(pkg, options).pipe(
						Effect.map((vfs) => ({ ok: true as const, pkg, vfs })),
						Effect.catch((error) =>
							emit({
								_tag: "PackageLoadFailed",
								package: pkg.name,
								version: pkg.version,
								kind: classify(error),
								error,
							}).pipe(Effect.as({ ok: false as const, pkg, error })),
						),
					),
				{ concurrency: 5 },
			),
		);

		const succeeded = results.filter((result) => result.ok);
		const failed = results.filter((result) => !result.ok);
		const merged = mergeVfs(...succeeded.map((result) => result.vfs));

		yield* emit({
			_tag: "BatchComplete",
			loaded: succeeded.length,
			failed: failed.length,
			total: packages.length,
			totalFiles: merged.size,
			duration,
		});

		if (failed.length === packages.length && packages.length > 0) {
			return yield* Effect.fail(
				new BatchLoadError({
					failures: failed.map((result) => ({
						name: result.pkg.name,
						version: result.pkg.version,
						error: result.error,
					})),
				}),
			);
		}
		return merged;
	});

	const resolveImport = Effect.fn("TypeRegistry.resolveImport")(function* (pkg: PackageSpec, specifier: string) {
		const manifest = yield* readManifest(pkg);
		return TypeResolver.resolveImport(specifier, manifest, pkg);
	});

	const getTypeEntries = Effect.fn("TypeRegistry.getTypeEntries")(function* (pkg: PackageSpec) {
		const manifest = yield* readManifest(pkg);
		return TypeResolver.resolveTypeEntries(manifest, pkg);
	});

	const resolveVersion = Effect.fn("TypeRegistry.resolveVersion")(function* (name: string, ref: string) {
		const resolved = yield* Effect.gen(function* () {
			const meta = yield* fetcher.getVersions(name);
			const tagged = meta.tags[ref];
			if (tagged !== undefined) return tagged;
			if (meta.versions.includes(ref)) return ref;
			const range = yield* Range.parse(ref).pipe(
				Effect.mapError(() => new VersionNotFoundError({ name, ref, available: meta.versions.slice(0, 20) })),
			);
			const published = yield* Effect.forEach(meta.versions, (version) => SemVer.parse(version).pipe(Effect.option));
			const best = Range.maxSatisfying(
				published.filter(Option.isSome).map((option) => option.value),
				range,
			);
			if (Option.isNone(best)) {
				return yield* Effect.fail(new VersionNotFoundError({ name, ref, available: meta.versions.slice(0, 20) }));
			}
			return best.value.toString();
		}).pipe(
			Effect.tapError((error) =>
				emit({
					_tag: "VersionResolveFailed",
					package: name,
					requested: ref,
					kind: error._tag === "VersionNotFoundError" ? "no-match" : error.status === 404 ? "not-found" : "network",
				}),
			),
		);
		yield* emit({ _tag: "VersionResolved", package: name, requested: ref, resolved });
		return resolved;
	});

	const clearCache = Effect.fn("TypeRegistry.clearCache")(function* (pkg: PackageSpec) {
		return yield* cache.remove(pkg);
	});

	const pruneCache = cache.prune.pipe(Effect.withSpan("TypeRegistry.pruneCache"));

	return {
		hasCached,
		fetchAndCache,
		getPackageVfs,
		getVfs,
		resolveImport,
		getTypeEntries,
		resolveVersion,
		clearCache,
		pruneCache,
	} satisfies TypeRegistryShape;
});

/**
 * The facade: one service collapsing the cache, fetcher and resolver behind
 * the operations documentation tooling actually calls.
 *
 * @remarks
 * `yield* TypeRegistry` replaces the v3 floating-function namespace (which
 * the rspress consumer immediately re-wrapped in its own service). Per-method
 * error unions stay precise. Compose at the edge: platform layers + store
 * `Cache.layerSqlite` + `TypeCache.layerXdg` + `PackageFetcher.layer` +
 * `TypeRegistry.layer`.
 *
 * @example
 * ```ts
 * import { PackageSpec, TypeRegistry } from "@effected/ts-vfs";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const registry = yield* TypeRegistry;
 *   return yield* registry.getVfs([PackageSpec.fromString("zod@3.23.8")]);
 * });
 * ```
 *
 * @public
 */
export class TypeRegistry extends Context.Service<TypeRegistry, TypeRegistryShape>()("@effected/ts-vfs/TypeRegistry") {
	/** The live facade over {@link TypeCache} and {@link PackageFetcher}. */
	static readonly layer: Layer.Layer<TypeRegistry, never, TypeCache | PackageFetcher> = Layer.effect(
		TypeRegistry,
		make,
	);
}

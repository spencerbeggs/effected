import type { CacheError, CacheOptions, CacheShape } from "@effected/store";
import { Cache } from "@effected/store";
import type { AppDirsError } from "@effected/xdg";
import { AppDirs } from "@effected/xdg";
import type { Context } from "effect";
import { Effect, Layer, Path } from "effect";
import { badFilename } from "./internal/filename.js";

/**
 * Options for {@link AppCache.layer}.
 *
 * @public
 */
export interface AppCacheOptions extends CacheOptions {
	/**
	 * File name within the app's cache directory. Default `"cache.db"`.
	 *
	 * @remarks
	 * A single path component. An empty name, or one containing a separator,
	 * would escape the namespace directory, so it **dies** at layer
	 * construction — it can only come from code, never from user input.
	 */
	readonly filename?: string;
}

/** The shared body of `layer` and `layerAs`; `context` names the caller in a guard die. */
const build = (
	context: string,
	options: AppCacheOptions | undefined,
): Layer.Layer<Cache, AppDirsError | CacheError, AppDirs | Path.Path> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const opts = options ?? {};
			const filename = opts.filename ?? "cache.db";
			const invalid = badFilename(context, filename);
			if (invalid !== undefined) return yield* Effect.die(invalid);

			const appDirs = yield* AppDirs;
			const path = yield* Path.Path;
			const cacheDir = yield* appDirs.ensureCache;
			return Cache.layerSqlite({ ...opts, filename: path.join(cacheDir, filename) });
		}),
	);

// Implementation of AppCache.layer; the public contract lives on the static.
const layer = (options?: AppCacheOptions): Layer.Layer<Cache, AppDirsError | CacheError, AppDirs | Path.Path> =>
	build("AppCache.layer", options);

// Implementation of AppCache.layerAs; the public contract lives on the static.
const layerAs = <I, S extends CacheShape>(
	tag: Context.Key<I, S> & ([CacheShape] extends [S] ? unknown : never),
	options: AppCacheOptions & { readonly filename: string },
): Layer.Layer<I, AppDirsError | CacheError, AppDirs | Path.Path> =>
	// The constraint pins S to exactly CacheShape, so the key may be read at it.
	Layer.effect(tag as Context.Key<I, CacheShape>, Cache).pipe(Layer.provide(build("AppCache.layerAs", options)));

/**
 * The cache-directory database glue: a TTL `Cache` whose file lives in the
 * ambient `AppDirs` cache directory.
 *
 * @public
 */
export class AppCache {
	private constructor() {}

	/**
	 * Build the cache-directory database layer: `AppDirs.ensureCache`, then
	 * `Cache.layerSqlite` at `<cache dir>/<filename>`.
	 *
	 * @remarks
	 * The same ensure-before-open ordering as `AppStore.layer`, and it matters
	 * *more* here: the cache directory is the one an operator is most likely to
	 * have deleted between runs. `options` is optional because every
	 * `CacheOptions` field is.
	 *
	 * This is a layer-returning function: bind the result to a `const` and reuse
	 * that binding, or memoization by reference is lost and the database is
	 * opened twice.
	 */
	static readonly layer = layer;

	/**
	 * Build an additional cache-directory database under a service key the
	 * consumer defines: the same ensure-before-open glue as {@link AppCache.layer},
	 * provided as `I` instead of `Cache`.
	 *
	 * @remarks
	 * For an application that keeps more than one cache — each with its own
	 * file, size bound, TTL default and `CacheEvent` stream. `tag` is a
	 * consumer-defined `Context.Service` whose service type is exactly
	 * `CacheShape`; a key with any other shape is rejected at compile time —
	 * a wider shape (`CacheShape & { … }`) as an argument "not assignable to
	 * parameter of type 'never'", since this layer could not supply the extra
	 * members. The
	 * output is `I` alone: the `Cache` built internally never leaks, so
	 * `layerAs` composes beside `AppCache.layer` without either shadowing the
	 * other.
	 *
	 * `filename` is **required** here, unlike on `AppCache.layer`. A defaulted
	 * `cache.db` would silently land on the primary cache's file — two
	 * connections onto one database, with two independent eviction passes and
	 * two event streams that each see half the writes. Give each cache its own
	 * name. The same single-path-component guard applies, and a bad name dies
	 * at construction.
	 *
	 * This is a layer-returning function: bind the result to a `const` once and
	 * reuse that binding, or memoization by reference is lost and the database
	 * is opened twice.
	 *
	 * @example
	 * ```ts
	 * import { AppCache } from "@effected/app";
	 * import type { CacheShape } from "@effected/store";
	 * import { Context } from "effect";
	 *
	 * class TarballCache extends Context.Service<TarballCache, CacheShape>()("myapp/TarballCache") {}
	 *
	 * // Bound once, to a const: <cache dir>/tarballs.db, provided as TarballCache.
	 * const TarballCacheLive = AppCache.layerAs(TarballCache, { filename: "tarballs.db", maxEntries: 200 });
	 * // Requires AppDirs and Path — App.layerDirs and the platform layer supply them.
	 * ```
	 */
	static readonly layerAs = layerAs;
}

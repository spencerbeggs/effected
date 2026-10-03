import type { CacheError, CacheOptions, CacheShape, CacheSqliteOptions } from "@effected/store";
import { Cache } from "@effected/store";
import type { AppDirs, AppDirsError } from "@effected/xdg";
import type { Context, FileSystem } from "effect";
import { Effect, Layer, Path } from "effect";
import { badFilename, badSubdir } from "./internal/filename.js";
import { ensureLocation } from "./internal/location.js";

/**
 * Options for {@link AppCache.layer} and {@link AppCache.layerAs}.
 *
 * @remarks
 * `CacheOptions` plus the SQLite driver passthrough — `client`,
 * `checkpointOnClose` — exactly as `Cache.layerSqlite` takes them. Only the
 * path is this package's: a directory kind, an optional subdirectory under
 * it, and a file name.
 *
 * @public
 */
export interface AppCacheOptions extends CacheOptions, Pick<CacheSqliteOptions, "client" | "checkpointOnClose"> {
	/**
	 * File name within the database's directory. Default `"cache.db"` on
	 * `AppCache.layer`; required on `AppCache.layerAs`.
	 *
	 * @remarks
	 * A single path component. An empty name, one containing a separator, or
	 * `.` / `..` would escape the namespace directory, so it **dies** at layer
	 * construction — it can only come from code, never from user input.
	 */
	readonly filename?: string;
	/**
	 * Which of the app's directories holds the file. Default `"cache"`.
	 *
	 * @remarks
	 * The matching `AppDirs.ensure*` member creates it before the database
	 * opens.
	 */
	readonly directory?: "state" | "data" | "cache";
	/**
	 * A relative subdirectory under `directory`, created (`mkdir -p`) before
	 * the database opens.
	 *
	 * @remarks
	 * `/`-separated single path components: no empty component, no `.` or
	 * `..`, no leading `/`, no `\`. Anything else would escape the namespace
	 * directory, so it **dies** at layer construction. A failure to create it
	 * is a typed `AppDirsError` naming `directory` and the full path.
	 *
	 * A subdir derived from runtime data — a project path, a user-supplied
	 * name — must come from a derivation that can only produce a valid
	 * component, such as a hash:
	 * `subdir: createHash("sha256").update(projectRoot).digest("hex").slice(0, 16)`.
	 * Passed raw, an unexpected value is a defect, not a typed failure.
	 */
	readonly subdir?: string;
}

/**
 * Guard the path options, ensure the location, and hand a resolved
 * `CacheSqliteOptions` to `open`. Shared by `layer` and `layerAs`; `context`
 * names the caller in a guard die.
 */
const build = <A, E>(
	context: string,
	options: AppCacheOptions | undefined,
	open: (resolved: CacheSqliteOptions) => Layer.Layer<A, E>,
): Layer.Layer<A, E | AppDirsError, AppDirs | Path.Path | FileSystem.FileSystem> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const { filename = "cache.db", directory = "cache", subdir, ...cache } = options ?? {};
			const invalid = badFilename(context, filename) ?? (subdir === undefined ? undefined : badSubdir(context, subdir));
			if (invalid !== undefined) return yield* Effect.die(invalid);

			const path = yield* Path.Path;
			const dir = yield* ensureLocation(directory, subdir);
			return open({ ...cache, filename: path.join(dir, filename) });
		}),
	);

// Implementation of AppCache.layer; the public contract lives on the static.
const layer = (
	options?: AppCacheOptions,
): Layer.Layer<Cache, AppDirsError | CacheError, AppDirs | Path.Path | FileSystem.FileSystem> =>
	build("AppCache.layer", options, Cache.layerSqlite);

// Implementation of AppCache.layerAs; the public contract lives on the static.
const layerAs = <I, S extends CacheShape>(
	tag: Context.Key<I, S> & ([CacheShape] extends [S] ? unknown : never),
	options: AppCacheOptions & { readonly filename: string },
): Layer.Layer<I, AppDirsError | CacheError, AppDirs | Path.Path | FileSystem.FileSystem> =>
	build("AppCache.layerAs", options, (resolved) => Cache.layerSqliteAs<I, S>(tag, resolved));

/**
 * The cache database glue: a TTL `Cache` whose file lives in one of the
 * ambient `AppDirs` directories — the cache directory unless told otherwise.
 *
 * @public
 */
export class AppCache {
	private constructor() {}

	/**
	 * Build the cache database layer: ensure `<directory>[/<subdir>]`, then
	 * `Cache.layerSqlite` at `<directory>[/<subdir>]/<filename>` — by default
	 * `AppDirs.ensureCache` and `<cache dir>/cache.db`.
	 *
	 * @remarks
	 * The same ensure-before-open ordering as `AppStore.layer`, and it matters
	 * *more* here: the cache directory is the one an operator is most likely to
	 * have deleted between runs. `options` is optional because every
	 * `CacheOptions` field is. A `subdir` is created with a recursive `mkdir`
	 * after the directory is ensured — that is why `FileSystem` is in `R` — and
	 * its failure lands on the same typed `AppDirsError`.
	 *
	 * This is a layer-returning function: bind the result to a `const` and reuse
	 * that binding, or memoization by reference is lost and the database is
	 * opened twice.
	 */
	static readonly layer = layer;

	/**
	 * Build an additional cache under a service key the consumer defines: the
	 * same ensure-before-open glue as {@link AppCache.layer}, over
	 * `Cache.layerSqliteAs`, provided as `I` instead of `Cache`.
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
	 * // Requires AppDirs, Path and FileSystem — App.layerDirs and the platform layer supply them.
	 * ```
	 */
	static readonly layerAs = layerAs;
}

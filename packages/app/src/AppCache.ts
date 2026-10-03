import type { CacheError, CacheOptions, CacheShape, CacheSqliteOptions } from "@effected/store";
import { Cache } from "@effected/store";
import type { AppDirs, AppDirsError } from "@effected/xdg";
import type { Context, FileSystem, Path } from "effect";
import { Effect, Layer } from "effect";
import { ensureLocation, resolveLocation } from "./internal/location.js";

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
export interface AppCacheOptions
	extends CacheOptions,
		Pick<CacheSqliteOptions, "client" | "checkpointOnClose" | "onConnect"> {
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

/** The one derivation of the file's location, shared by `location` and both layers. */
const locate = (context: string, options: AppCacheOptions | undefined) => {
	const { filename = "cache.db", directory = "cache", subdir } = options ?? {};
	return resolveLocation(context, directory, subdir, filename);
};

const build = <A, E>(
	context: string,
	options: AppCacheOptions | undefined,
	open: (resolved: CacheSqliteOptions) => Layer.Layer<A, E>,
): Layer.Layer<A, E | AppDirsError, AppDirs | Path.Path | FileSystem.FileSystem> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const { filename: _filename, directory: _directory, subdir: _subdir, ...rest } = options ?? {};
			const location = yield* locate(context, options);
			yield* ensureLocation(location);
			return open({ ...rest, filename: location.file });
		}),
	);

// Implementation of AppCache.location; the public contract lives on the static.
const location = (options?: AppCacheOptions): Effect.Effect<string, never, AppDirs | Path.Path> =>
	Effect.map(locate("AppCache.location", options), (resolved) => resolved.file);

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
	 * consumer-defined `Context.Service` whose service type is `CacheShape`.
	 * An incompatible shape is a compile error, and so is one that adds members
	 * (`CacheShape & { … }`), reported as an argument "not assignable to
	 * parameter of type 'never'". The check cannot see through method-syntax
	 * parameter bivariance: a member redeclared as a method with a wider
	 * parameter still compiles. The
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

	/**
	 * Resolve the absolute path of the database file the layers would open for
	 * these options — `directory`, `subdir` and `filename` — without creating
	 * anything.
	 *
	 * @remarks
	 * The same derivation `AppCache.layer` and `AppCache.layerAs` use, not a copy of
	 * it, so the path a consumer reports or persists is the path the layer
	 * opens. Requires only `AppDirs` and `Path`: nothing is touched on disk.
	 * `filename` defaults to `"cache.db"` as on `AppCache.layer`; pass the same
	 * options you pass the layer. A bad `filename` or `subdir` dies, exactly as
	 * it would at layer construction.
	 *
	 * @example
	 * ```ts
	 * import { AppCache } from "@effected/app";
	 * import { Effect } from "effect";
	 *
	 * const options = { filename: "registry.db", directory: "data" } as const;
	 *
	 * const program = Effect.gen(function* () {
	 * 	const file = yield* AppCache.location(options); // e.g. ~/.local/share/myapp/registry.db
	 * 	yield* Effect.log(`database: ${file}`);
	 * });
	 * ```
	 */
	static readonly location = location;
}

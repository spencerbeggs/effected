import type { CacheError, CacheOptions } from "@effected/store";
import { Cache } from "@effected/store";
import type { AppDirsError } from "@effected/xdg";
import { AppDirs } from "@effected/xdg";
import { Effect, Layer, Path } from "effect";
import { badFilename } from "./internal/filename.js";

/**
 * Options for {@link (AppCache:variable).layer}.
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
const layer = (options?: AppCacheOptions): Layer.Layer<Cache, AppDirsError | CacheError, AppDirs | Path.Path> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const opts = options ?? {};
			const filename = opts.filename ?? "cache.db";
			const invalid = badFilename("AppCache.layer", filename);
			if (invalid !== undefined) return yield* Effect.die(invalid);

			const appDirs = yield* AppDirs;
			const path = yield* Path.Path;
			const cacheDir = yield* appDirs.ensureCache;
			return Cache.layerSqlite({ ...opts, filename: path.join(cacheDir, filename) });
		}),
	);

/**
 * The cache-directory database glue: a TTL `Cache` whose file lives in the
 * ambient `AppDirs` cache directory.
 *
 * @public
 */
export const AppCache = { layer } as const;

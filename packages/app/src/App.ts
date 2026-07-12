import type { CacheError, CacheOptions, StoreError, StoreMigrationError, StoreOptions } from "@effected/store";
import { Cache, Store } from "@effected/store";
import type { AppDirsError, AppDirsOptions, XdgEnvError } from "@effected/xdg";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { FileSystem, Layer, Path } from "effect";
import type { AppCacheOptions } from "./AppCache.js";
import { AppCache } from "./AppCache.js";
import type { AppStoreOptions } from "./AppStore.js";
import { AppStore } from "./AppStore.js";

/**
 * Everything that can come out of the control plane, for the application
 * edge's `catchTags` block.
 *
 * @remarks
 * A **type-only** alias — it erases, so it costs nothing in the module graph
 * and creates no runtime binding to tree-shake around. It is a convenience
 * over the constituent packages' errors, not a new error model: every tag in
 * it is defined and documented by the package that raises it, and each flows
 * through unwrapped with its structure intact.
 *
 * @public
 */
export type AppError = XdgEnvError | AppDirsError | StoreError | StoreMigrationError | CacheError;

/**
 * Options for {@link (App:variable).layer}.
 *
 * @remarks
 * The `AppDirsOptions` fields — `namespace`, `native`, `fallbackDir`, `dirs` —
 * are pass-through: they mean exactly what `@effected/xdg` documents,
 * including the five-level precedence ladder.
 *
 * @public
 */
export interface AppOptions extends AppDirsOptions {
	/** The state database's options; `migrations` is the consumer's schema. */
	readonly store: AppStoreOptions;
	/** The cache database's options. Absence means defaults, not absence. */
	readonly cache?: AppCacheOptions;
}

/**
 * Options for {@link (App:variable).layerTest}.
 *
 * @public
 */
export interface AppTestOptions {
	/** The application namespace — one path component. */
	readonly namespace: string;
	/** Pin real XDG paths; defaults to a synthetic set under a fake home. */
	readonly paths?: XdgPaths;
	/** The in-memory state database's options. Default: no migrations. */
	readonly store?: StoreOptions;
	/** The in-memory cache's options. */
	readonly cache?: CacheOptions;
}

/** The synthetic default XDG environment `layerTest` resolves against. */
const testPaths = (): XdgPaths =>
	XdgPaths.make({
		home: "/home/test",
		configHome: "/home/test/.config",
		dataHome: "/home/test/.local/share",
		cacheHome: "/home/test/.cache",
		stateHome: "/home/test/.local/state",
		configDirs: ["/etc/xdg"],
		dataDirs: ["/usr/local/share", "/usr/share"],
	});

/**
 * Build the application control plane: namespaced directories, the state
 * database and the cache database, all pointed at the same place.
 *
 * @remarks
 * Composition is `AppDirs.layer(options)` `provideMerge` `Xdg.layer`, with the
 * {@link AppStore} and {@link AppCache} glue `provideMerge`d over the result,
 * so all four services come out and only `FileSystem` and `Path` stay in `R` —
 * the two the consumer's platform layer supplies once, at the edge.
 *
 * `App.layer` always provides **both** databases: an application that wants
 * only one composes `AppStore.layer` or `AppCache.layer` directly and never
 * opens the other file. Passing no `cache` options still opens `cache.db`,
 * because `CacheOptions` are all-optional and absence means defaults.
 *
 * This is a layer-returning function: bind the result to a `const` once and
 * reuse that binding. Calling it inline at two provide sites opens two
 * databases — two connections onto one file, two migration ledgers, and two
 * independent `CacheEvent` PubSubs whose subscribers each see half the events.
 */
const layer = (
	options: AppOptions,
): Layer.Layer<Xdg | AppDirs | Store | Cache, AppError, FileSystem.FileSystem | Path.Path> => {
	const { store, cache, ...dirOptions } = options;
	const dirs = Layer.provideMerge(AppDirs.layer(dirOptions), Xdg.layer);
	const databases = Layer.mergeAll(AppStore.layer(store), AppCache.layer(cache));
	return Layer.provideMerge(databases, dirs);
};

/**
 * The hermetic control plane: fixed XDG paths, `:memory:` databases, and the
 * platform layers provided internally.
 *
 * @remarks
 * `Xdg.layerFrom` over a synthetic default {@link XdgPaths}, `Store.layerTest`
 * and `Cache.layerTest`, with `Path.layer` and `FileSystem.layerNoop` provided
 * **internally** via `Layer.provide` — not merged into the output, not
 * exposed. A consumer's first test needs no platform package at all.
 *
 * The documented limit: code paths that actually exercise `ensure*` **die**
 * against `FileSystem.layerNoop` — it is a stub, not a working filesystem.
 * `layerTest` is for testing logic that *uses* the control plane; a test of
 * real directory behaviour uses {@link (App:variable).layer} with a
 * temp-directory `HOME`.
 */
const layerTest = (options: AppTestOptions): Layer.Layer<Xdg | AppDirs | Store | Cache, AppError> => {
	const dirs = Layer.provideMerge(
		AppDirs.layer({ namespace: options.namespace }),
		Xdg.layerFrom(options.paths ?? testPaths()),
	);
	const databases = Layer.mergeAll(
		Store.layerTest(options.store ?? { migrations: [] }),
		Cache.layerTest(options.cache),
	);
	return Layer.provide(Layer.mergeAll(databases, dirs), Layer.mergeAll(Path.layer, FileSystem.layerNoop({})));
};

/**
 * The application control plane: one layer wiring `Xdg`, `AppDirs`, `Store`
 * and `Cache` to the same namespace.
 *
 * @public
 */
export const App = { layer, layerTest } as const;

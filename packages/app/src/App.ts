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
 * Options for {@link App.layer}.
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
 * Options for {@link App.layerTest}.
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

// Implementation of App.layerDirs; the public contract lives on the static.
const layerDirs = (
	options: AppDirsOptions,
): Layer.Layer<Xdg | AppDirs, XdgEnvError, FileSystem.FileSystem | Path.Path> =>
	Layer.provideMerge(AppDirs.layer(options), Xdg.layer);

// Implementation of App.layer; the public contract lives on the static.
const layer = (
	options: AppOptions,
): Layer.Layer<Xdg | AppDirs | Store | Cache, AppError, FileSystem.FileSystem | Path.Path> => {
	const { store, cache, ...dirOptions } = options;
	const databases = Layer.mergeAll(AppStore.layer(store), AppCache.layer(cache));
	return Layer.provideMerge(databases, layerDirs(dirOptions));
};

// Implementation of App.layerTest; the public contract lives on the static.
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
export class App {
	private constructor() {}

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
	 * `App.layer` always provides **both** databases, and **building it opens
	 * and migrates both eagerly** — `store.db` and `cache.db` exist on disk the
	 * moment the layer is built, whether or not the program ever touches them.
	 * Passing no `cache` options still opens `cache.db`, because `CacheOptions`
	 * are all-optional and absence means defaults. An application that wants
	 * only one composes {@link App.layerDirs} with `AppStore.layer` or
	 * `AppCache.layer` and never opens the other file.
	 *
	 * A CLI should therefore not provide `App.layer` at its entry point: every
	 * command, `--help`-adjacent paths included, would create and migrate both
	 * databases, and a command that deletes the app's files would delete a
	 * database its own process holds open. Provide {@link App.layerDirs} once at
	 * the platform edge instead, bind `AppStore.layer(...)` / `AppCache.layer(...)`
	 * once at module scope, and attach them with `Command.provide` only on the
	 * commands that use them — see the second example.
	 *
	 * A module-scope binding such as `StoreLive` stays ONE connection however
	 * many composites reuse it inside one provided layer graph —
	 * `Layer.mergeAll(StoreLive, …)` beside `Repo.pipe(Layer.provide(StoreLive))`
	 * — because a layer graph memoises by reference, and an `Effect.provide`
	 * nested inside another reuses what the enclosing one already built.
	 * Provides that are not nested — one after another, or side by side under a
	 * common parent — each build it, and so open the database, again.
	 *
	 * This is a layer-returning function: bind the result to a `const` once and
	 * reuse that binding. Calling it inline at two provide sites opens two
	 * databases — two connections onto one file, two migration ledgers, and two
	 * independent `CacheEvent` PubSubs whose subscribers each see half the events.
	 *
	 * Testing cache expiry against this layer has one ordering rule: provide
	 * `TestClock.layer()` **outside** the `Effect.provide` that supplies this
	 * layer, never beneath it. Underneath, the test body has no `TestClock` in
	 * its own context and `TestClock.adjust` dies as a defect — so the entries
	 * under test carry real timestamps and nothing ever expires.
	 *
	 * @example
	 * ```ts
	 * import { App } from "@effected/app";
	 * import { NodeServices } from "@effect/platform-node";
	 * import { Layer } from "effect";
	 *
	 * const migrations = [
	 * 	{ id: 1, name: "runs", up: (sql) => sql`CREATE TABLE runs (id TEXT PRIMARY KEY)` },
	 * ];
	 *
	 * // Bound once, to a const: XDG dirs for "myapp", store.db and cache.db.
	 * const AppLive = App.layer({ namespace: "myapp", store: { migrations } }).pipe(
	 * 	Layer.provide(NodeServices.layer),
	 * );
	 * ```
	 *
	 * @example
	 * Databases per command, directories everywhere — the CLI shape:
	 * ```ts
	 * import { App, AppStore } from "@effected/app";
	 * import { CliRuntime } from "@effected/cli";
	 * import type { StoreMigration } from "@effected/store";
	 * import { Store } from "@effected/store";
	 * import { NodeRuntime, NodeServices } from "@effect/platform-node";
	 * import { Effect, Layer } from "effect";
	 * import { Command } from "effect/cli";
	 *
	 * const migrations: ReadonlyArray<StoreMigration> = [
	 * 	{ id: 1, name: "runs", up: (sql) => sql`CREATE TABLE runs (id TEXT PRIMARY KEY)` },
	 * ];
	 *
	 * // Module scope, bound once: built once per provided layer graph.
	 * const StoreLive = AppStore.layer({ migrations });
	 *
	 * // Opens store.db — only when `history` runs.
	 * const history = Command.make("history", {}, () =>
	 * 	Effect.gen(function* () {
	 * 		const store = yield* Store;
	 * 		yield* store.client`SELECT id FROM runs`;
	 * 	}),
	 * ).pipe(Command.provide(StoreLive));
	 *
	 * // Opens no database at all.
	 * const where = Command.make("where", {}, () => Effect.void);
	 *
	 * const cli = Command.make("myapp").pipe(Command.withSubcommands([history, where]));
	 *
	 * // Directories at the edge, once; AppDirs satisfies StoreLive's requirement.
	 * const PlatformLive = App.layerDirs({ namespace: "myapp" }).pipe(Layer.provideMerge(NodeServices.layer));
	 *
	 * NodeRuntime.runMain(CliRuntime.main(Command.run(cli, { version: "1.0.0" }), { platform: PlatformLive }));
	 * ```
	 */
	static readonly layer = layer;

	/**
	 * Build the directories half of the control plane alone: `Xdg` and
	 * `AppDirs` for one namespace, with no database opened.
	 *
	 * @remarks
	 * Exactly the directory composition {@link App.layer} builds on —
	 * `AppDirs.layer(options)` `provideMerge` `Xdg.layer` — lifted out so an
	 * application can provide "directories everywhere" at its edge and attach
	 * the databases only where they are used. Building it resolves the XDG
	 * environment and nothing else: no directory is created until an `ensure*`
	 * member runs, and no SQLite file is touched. Its output satisfies the
	 * `AppDirs` requirement of `AppStore.layer`, `AppStore.layerAs`,
	 * `AppCache.layer`, `AppCache.layerAs` and `AppConfig.layer`.
	 *
	 * The error channel is `XdgEnvError` alone — an unset `HOME` — and `R` is
	 * the `FileSystem` and `Path` a platform layer supplies once. `options` is
	 * `AppDirsOptions` pass-through: `namespace`, `native`, `fallbackDir` and
	 * `dirs` mean exactly what `@effected/xdg` documents.
	 *
	 * This is a layer-returning function: bind the result to a `const` once and
	 * reuse that binding.
	 *
	 * @example
	 * ```ts
	 * import { App, AppStore } from "@effected/app";
	 * import { NodeServices } from "@effect/platform-node";
	 * import { AppDirs } from "@effected/xdg";
	 * import { Effect, Layer } from "effect";
	 *
	 * // Bound once, to a const: XDG directories for "myapp", no databases.
	 * const DirsLive = App.layerDirs({ namespace: "myapp" }).pipe(Layer.provideMerge(NodeServices.layer));
	 *
	 * const program = Effect.gen(function* () {
	 * 	const dirs = yield* AppDirs;
	 * 	return dirs.dirs.state; // resolved, not created
	 * });
	 *
	 * // A database, attached where it is wanted, over the same directories.
	 * const StoreLive = AppStore.layer({ migrations: [] });
	 * const withStore = program.pipe(Effect.provide(StoreLive), Effect.provide(DirsLive));
	 * ```
	 */
	static readonly layerDirs = layerDirs;

	/**
	 * The hermetic control plane: fixed XDG paths, `:memory:` databases, and the
	 * platform layers provided internally.
	 *
	 * @remarks
	 * `Xdg.layerFrom` over a synthetic default `XdgPaths`, `Store.layerTest`
	 * and `Cache.layerTest`, with `Path.layer` and `FileSystem.layerNoop` provided
	 * **internally** via `Layer.provide` — not merged into the output, not
	 * exposed. A consumer's first test needs no platform package at all.
	 *
	 * The documented limit: code paths that actually exercise `ensure*` **die**
	 * against `FileSystem.layerNoop` — it is a stub, not a working filesystem.
	 * `layerTest` is for testing logic that *uses* the control plane. A test of
	 * real directory behaviour composes `AppDirs.layer` over `@effected/memfs`,
	 * whose `ensure*` members then create directories on an in-memory volume.
	 * The databases are the exception: `Store` and `Cache` open their SQLite
	 * files through the native binding, which never sees the `FileSystem`
	 * service, so a test of {@link App.layer} end to end still needs a
	 * temp-directory `HOME`.
	 */
	static readonly layerTest = layerTest;
}

import type { MemoryFileSystemSeed, MemoryFileSystemVolume } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { CacheError, CacheOptions, StoreError, StoreMigrationError, StoreOptions } from "@effected/store";
import { Cache, Store } from "@effected/store";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import type { FileSystem } from "effect";
import { Layer, Path } from "effect";

/**
 * Options for {@link AppTest.layer}.
 *
 * @public
 */
export interface AppTestOptions {
	/** The application namespace — one path component. */
	readonly namespace: string;
	/** Pin real XDG paths; defaults to a synthetic set under a fake home. */
	readonly paths?: XdgPaths;
	/**
	 * Seed the in-memory filesystem: absolute POSIX paths mapped to file
	 * content, or to `MemoryFileSystem.file` / `.directory` / `.symlink`
	 * entries. Default: an empty volume.
	 *
	 * @remarks
	 * The volume is `@effected/memfs`'s, so a path nothing seeded is honestly
	 * absent and every `ensure*` creates real directories on it. Seed a config
	 * file under the namespace's config directory — `/home/test/.config/<ns>/`
	 * on the default paths — and an `AppConfig.layer` composed over this layer
	 * loads it. Inspect what the program wrote through the
	 * `MemoryFileSystem.Volume` service the layer also provides.
	 */
	readonly files?: MemoryFileSystemSeed;
	/** The in-memory state database's options. Default: no migrations. */
	readonly store?: StoreOptions;
	/** The in-memory cache's options. */
	readonly cache?: CacheOptions;
}

/** The synthetic default XDG environment `AppTest.layer` resolves against. */
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
 * Everything {@link AppTest.layer} provides: the four control-plane services
 * and the in-memory platform they run on.
 *
 * @remarks
 * `FileSystem` and `Path` are the memfs-backed platform the directories live
 * on, and `MemoryFileSystemVolume` is `@effected/memfs`'s synchronous view of
 * that same volume, resolved in a test with `yield* MemoryFileSystem.Volume`.
 *
 * @public
 */
export type AppTestServices =
	| Xdg
	| AppDirs
	| Store
	| Cache
	| FileSystem.FileSystem
	| Path.Path
	| MemoryFileSystemVolume;

/**
 * The hermetic application control plane for tests, from
 * `@effected/app/testing`.
 *
 * @remarks
 * A separate entrypoint so an application's runtime import graph never loads
 * `@effected/memfs`, which is an optional peer needed only here.
 *
 * @public
 */
export class AppTest {
	private constructor() {}

	/**
	 * The hermetic control plane: fixed XDG paths, `:memory:` databases, and an
	 * in-memory filesystem, with `R = never`.
	 *
	 * @remarks
	 * `Xdg.layerFrom` over a synthetic default `XdgPaths` (or `options.paths`),
	 * `Store.layerTest` and `Cache.layerTest`, over `Path.layer` and
	 * `@effected/memfs`'s `MemoryFileSystem.layerWith(options.files)`. A
	 * consumer's first test needs no platform package at all, and `R` is
	 * `never` by construction — the layer satisfies the platform requirements
	 * rather than imposing them.
	 *
	 * The platform is **merged into the output**, not hidden: `FileSystem`,
	 * `Path` and `MemoryFileSystem.Volume` come out beside the four services.
	 * That is what lets an `AppConfig.layer` — or anything else that needs
	 * `FileSystem | Path | AppDirs | Xdg` — compose over this layer with a
	 * single `Layer.provide`, on the same volume the directories live on. Every
	 * `AppDirs.ensure*` creates real directories on that volume; `files` seeds
	 * it; the `Volume` service reads back what the program wrote, synchronously
	 * and without an `Effect`.
	 *
	 * One `AppTest.layer(...)` call is one volume. Under `@effect/vitest`'s
	 * `layer(...)` the layer is built once for the block, so its tests share
	 * the volume and see each other's writes; a test that needs a clean
	 * filesystem calls `AppTest.layer` again or scopes its own `layer(...)` block.
	 *
	 * The databases are not on the volume: `Store` and `Cache` are `:memory:`
	 * here, and under `App.layer` they open SQLite files through the
	 * native binding, which never sees the `FileSystem` service. For the same
	 * reason, do not compose `AppStore.layer` or `AppCache.layer` over this
	 * layer: their `ensure*` succeeds on the volume, then the binding opens the
	 * same path on the **host**. On the synthetic defaults `/home/test/...` does
	 * not exist there, so the layer fails with a setup `StoreError`; with real
	 * `paths` it would write a database onto the host disk. A test of
	 * `App.layer` end to end — real files under real directories — still runs
	 * against a temp-directory `HOME`.
	 *
	 * @example
	 * ```ts
	 * import { AppConfig } from "@effected/app";
	 * import { AppTest } from "@effected/app/testing";
	 * import { ConfigFile, JsonCodec } from "@effected/config-file";
	 * import { MemoryFileSystem } from "@effected/memfs";
	 * import { AppDirs } from "@effected/xdg";
	 * import { assert, layer } from "@effect/vitest";
	 * import { Effect, Layer, Schema } from "effect";
	 *
	 * class Settings extends Schema.Class<Settings>("Settings")({ port: Schema.Number }) {}
	 * class SettingsFile extends ConfigFile.Service<SettingsFile, Settings>()("myapp/Settings") {}
	 *
	 * const TestPlane = AppTest.layer({
	 * 	namespace: "myapp",
	 * 	files: { "/home/test/.config/myapp/config.json": `{"port":4242}` },
	 * });
	 * const ConfigLive = AppConfig.layer(SettingsFile, { filename: "config.json", schema: Settings, codec: JsonCodec });
	 *
	 * layer(Layer.provideMerge(ConfigLive, TestPlane))("myapp", (it) => {
	 * 	it.effect("loads the seeded config and creates the state directory", () =>
	 * 		Effect.gen(function* () {
	 * 			const settings = yield* (yield* SettingsFile).load;
	 * 			assert.strictEqual(settings.port, 4242);
	 * 			const state = yield* (yield* AppDirs).ensureState;
	 * 			const volume = yield* MemoryFileSystem.Volume;
	 * 			assert.isTrue(volume.has(state));
	 * 		}),
	 * 	);
	 * });
	 * ```
	 */
	static readonly layer = (
		options: AppTestOptions,
	): Layer.Layer<AppTestServices, StoreError | StoreMigrationError | CacheError> => {
		// One volume per AppTest.layer(...) call, shared by every service built from it
		// and by the test body — so what AppDirs.ensure* creates and what a config
		// layer composed on top writes are on the same filesystem the test inspects.
		const platform = Layer.mergeAll(Path.layer, MemoryFileSystem.layerWith(options.files ?? {}));
		const dirs = Layer.provideMerge(
			AppDirs.layer({ namespace: options.namespace }),
			Xdg.layerFrom(options.paths ?? testPaths()),
		);
		const databases = Layer.mergeAll(
			Store.layerTest(options.store ?? { migrations: [] }),
			Cache.layerTest(options.cache),
		);
		return Layer.provideMerge(Layer.mergeAll(databases, dirs), platform);
	};
}

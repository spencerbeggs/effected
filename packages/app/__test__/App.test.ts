import { assert, describe, it, layer } from "@effect/vitest";
import { ConfigFile, JsonCodec } from "@effected/config-file";
import type { MemoryFileSystemVolume } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { StoreMigration } from "@effected/store";
import { Cache, Store, StoreError } from "@effected/store";
import type { XdgEnvError } from "@effected/xdg";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { Cause, Effect, Exit, FileSystem, Layer, Option, Path, Schema } from "effect";
import type { AppError } from "../src/index.js";
import { App, AppConfig, AppStore } from "../src/index.js";

const migrations: ReadonlyArray<StoreMigration> = [
	{ id: 1, name: "create-notes", up: (sql) => sql`CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)` },
];

describe("App.layerTest", () => {
	// The whole point: this fixture typechecks with R = never. If it ever needs
	// a NodeFileSystem import, the layer has stopped doing its job.
	layer(App.layerTest({ namespace: "myapp", store: { migrations } }))((it) => {
		it.effect("provides a working Store with zero platform layers", () =>
			Effect.gen(function* () {
				const store = yield* Store;
				yield* store.client`INSERT INTO notes (id, body) VALUES ('a', 'hello')`;
				const rows = yield* store.client<{ body: string }>`SELECT body FROM notes WHERE id = 'a'`;
				assert.strictEqual(rows[0]?.body, "hello");
			}),
		);

		it.effect("provides a working Cache with zero platform layers", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "greeting", value: new TextEncoder().encode("hi") });
				const entry = yield* cache.get("greeting");
				assert.isTrue(Option.isSome(entry));
				assert.strictEqual(new TextDecoder().decode(Option.getOrThrow(entry).value), "hi");
			}),
		);

		it.effect("resolves AppDirs against the synthetic default paths", () =>
			Effect.gen(function* () {
				const appDirs = yield* AppDirs;
				assert.strictEqual(appDirs.namespace, "myapp");
				assert.strictEqual(appDirs.dirs.state, "/home/test/.local/state/myapp");
				assert.strictEqual(appDirs.dirs.cache, "/home/test/.cache/myapp");
				assert.strictEqual(appDirs.dirs.config, "/home/test/.config/myapp");
				const paths = yield* Xdg;
				assert.strictEqual(paths.home, "/home/test");
			}),
		);

		it.effect("ensure* creates real directories on the in-memory volume instead of dying", () =>
			Effect.gen(function* () {
				// The volume starts empty: nothing is fabricated.
				const volume = yield* MemoryFileSystem.Volume;
				assert.isFalse(volume.has("/home/test/.local/state/myapp"));
				const appDirs = yield* AppDirs;
				const state = yield* appDirs.ensureState;
				assert.strictEqual(state, "/home/test/.local/state/myapp");
				assert.isTrue(volume.has(state));
				const resolved = yield* appDirs.ensure;
				for (const dir of [resolved.config, resolved.data, resolved.cache, resolved.state]) {
					assert.isTrue(volume.has(dir), dir);
				}
			}),
		);

		it.effect("exposes the FileSystem and Path it runs on, so a test writes to the same volume", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const appDirs = yield* AppDirs;
				const target = path.join(yield* appDirs.ensureData, "note.txt");
				yield* fs.writeFileString(target, "hello");
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(target), "hello");
			}),
		);
	});

	class Settings extends Schema.Class<Settings>("Settings")({ port: Schema.Number }) {}
	class SettingsFile extends ConfigFile.Service<SettingsFile, Settings>()("app-test/Settings") {}

	const seeded = App.layerTest({
		namespace: "myapp",
		files: { "/home/test/.config/myapp/config.json": `{"port":4242}` },
	});
	const ConfigLive = AppConfig.layer(SettingsFile, { filename: "config.json", schema: Settings, codec: JsonCodec });

	// AppConfig needs FileSystem | Path | AppDirs | Xdg — all of which layerTest now
	// provides — so the preset composes over it with ONE provide, on ONE volume.
	layer(Layer.provideMerge(ConfigLive, seeded))((it) => {
		it.effect("loads a config file seeded through `files`", () =>
			Effect.gen(function* () {
				const settings = yield* (yield* SettingsFile).load;
				assert.strictEqual(settings.port, 4242);
			}),
		);

		it.effect("save lands in the namespace's config directory on the volume", () =>
			Effect.gen(function* () {
				const saved = yield* (yield* SettingsFile).save(Settings.make({ port: 9000 }));
				assert.strictEqual(saved, "/home/test/.config/myapp/config.json");
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(saved), `{\n  "port": 9000\n}`);
			}),
		);
	});

	it("provides the platform and the volume beside the four services, with R = never", () => {
		const live = App.layerTest({ namespace: "myapp" });
		const exact: Layer.Layer<
			Xdg | AppDirs | Store | Cache | FileSystem.FileSystem | Path.Path | MemoryFileSystemVolume,
			AppError
		> = live;
		// Narrower outputs still hold: a consumer that only wants the four services is unaffected.
		const four: Layer.Layer<Xdg | AppDirs | Store | Cache, AppError> = live;
		for (const value of [exact, four]) assert.isDefined(value);
	});

	const pinned = XdgPaths.make({
		home: "/pinned",
		stateHome: "/pinned/state",
		configDirs: ["/etc/xdg"],
		dataDirs: ["/usr/share"],
	});

	layer(App.layerTest({ namespace: "other", paths: pinned }))((it) => {
		it.effect("pins real XDG paths when given, and store defaults to no migrations", () =>
			Effect.gen(function* () {
				const appDirs = yield* AppDirs;
				assert.strictEqual(appDirs.dirs.state, "/pinned/state/other");
				// No configHome in the pinned set: config falls back to $HOME/.<ns>.
				assert.strictEqual(appDirs.dirs.config, "/pinned/.other");
				const store = yield* Store;
				const status = yield* store.status;
				assert.deepStrictEqual(status, []);
			}),
		);
	});

	// The documented trap: AppStore.layer's ensure* passes on the volume, then the
	// native binding opens the same path on the HOST, where the synthetic
	// /home/test does not exist. The layer must fail with a typed StoreError, not
	// write a database anywhere.
	it.effect("composing AppStore.layer over layerTest fails at setup instead of opening a host file", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.provide(
					Effect.void,
					AppStore.layer({ migrations: [], filename: "trap.db" }).pipe(
						Layer.provide(App.layerTest({ namespace: "myapp" })),
					),
				),
			);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				const failure = Cause.findErrorOption(exit.cause);
				assert.isTrue(Option.isSome(failure));
				if (Option.isSome(failure)) {
					assert.isTrue(failure.value instanceof StoreError);
					assert.strictEqual((failure.value as StoreError).operation, "setup");
				}
			}
		}),
	);
});

describe("App.layerDirs", () => {
	it("provides Xdg | AppDirs on XdgEnvError, requiring only FileSystem | Path — and no database", () => {
		// Compile-time contract; the runtime #923 property lives in the integration suite.
		const live = App.layerDirs({ namespace: "myapp" });
		const exact: Layer.Layer<Xdg | AppDirs, XdgEnvError, FileSystem.FileSystem | Path.Path> = live;
		// @ts-expect-error no Store comes out — building layerDirs opens no database
		const withStore: Layer.Layer<Xdg | AppDirs | Store, XdgEnvError, FileSystem.FileSystem | Path.Path> = live;
		// @ts-expect-error no Cache comes out either
		const withCache: Layer.Layer<Xdg | AppDirs | Cache, XdgEnvError, FileSystem.FileSystem | Path.Path> = live;
		// @ts-expect-error the platform is still required: R is FileSystem | Path, not never
		const closed: Layer.Layer<Xdg | AppDirs, XdgEnvError> = live;
		// @ts-expect-error an unset HOME stays on the typed channel
		const infallible: Layer.Layer<Xdg | AppDirs, never, FileSystem.FileSystem | Path.Path> = live;
		for (const value of [exact, withStore, withCache, closed, infallible]) assert.isDefined(value);
	});
});

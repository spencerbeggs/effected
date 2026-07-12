import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { ConfigFile, JsonCodec } from "@effected/config-file";
import type { StoreMigration } from "@effected/store";
import { Cache, Store } from "@effected/store";
import { Cause, ConfigProvider, Effect, Exit, Layer, Option, Path, Schema } from "effect";
import type { AppOptions } from "../../src/index.js";
import { App, AppConfig } from "../../src/index.js";

const Platform = Layer.mergeAll(NodeFileSystem.layer, Path.layer);

const migrations: ReadonlyArray<StoreMigration> = [
	{ id: 1, name: "create-runs", up: (sql) => sql`CREATE TABLE runs (id TEXT PRIMARY KEY, at TEXT)` },
];

/** Run `f` against a scratch HOME on the real filesystem, always cleaning up. */
const withTempHome = <A, E>(f: (tmp: string) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
	Effect.gen(function* () {
		const tmp = yield* Effect.promise(() => nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "effected-app-")));
		return yield* f(tmp).pipe(Effect.ensuring(Effect.promise(() => nodeFs.rm(tmp, { recursive: true, force: true }))));
	});

/** Drive `Config` from a record instead of mutating the real environment. */
const env = (vars: Record<string, string>) => ConfigProvider.layer(ConfigProvider.fromUnknown(vars));

const homeEnv = (tmp: string) =>
	env({
		HOME: tmp,
		XDG_CONFIG_HOME: nodePath.join(tmp, "config-home"),
		XDG_STATE_HOME: nodePath.join(tmp, "state-home"),
		XDG_CACHE_HOME: nodePath.join(tmp, "cache-home"),
	});

const appLive = (tmp: string, options?: Partial<AppOptions>) =>
	App.layer({ namespace: "myapp", store: { migrations }, ...options }).pipe(
		Layer.provide(homeEnv(tmp)),
		Layer.provide(Platform),
	);

const existsOnDisk = (target: string): Effect.Effect<boolean> =>
	Effect.promise(() =>
		nodeFs.access(target).then(
			() => true,
			() => false,
		),
	);

describe("App.layer (integration)", () => {
	it.effect("the databases land in the state and cache directories", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				yield* Effect.gen(function* () {
					const store = yield* Store;
					yield* store.client`INSERT INTO runs (id, at) VALUES ('r1', 'now')`;
					const cache = yield* Cache;
					yield* cache.set({ key: "k", value: new TextEncoder().encode("v") });
				}).pipe(Effect.provide(appLive(tmp)));

				// Assert on the FILE existing at the joined path, not an echoed option.
				assert.isTrue(yield* existsOnDisk(nodePath.join(tmp, "state-home", "myapp", "store.db")));
				assert.isTrue(yield* existsOnDisk(nodePath.join(tmp, "cache-home", "myapp", "cache.db")));
			}),
		),
	);

	it.effect("custom filenames are honored within the same directories", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				yield* Effect.provide(
					Effect.void,
					appLive(tmp, { store: { migrations, filename: "state.sqlite" }, cache: { filename: "objects.sqlite" } }),
				);
				assert.isTrue(yield* existsOnDisk(nodePath.join(tmp, "state-home", "myapp", "state.sqlite")));
				assert.isTrue(yield* existsOnDisk(nodePath.join(tmp, "cache-home", "myapp", "objects.sqlite")));
			}),
		),
	);

	it.effect("a fresh namespace with no pre-existing directories builds without a defect", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				// CONTROL, watched failing: the naive composition — layerSqlite with no
				// ensureState — DEFECTS on the missing parent directory. This is the
				// difference between this package and a two-line README snippet.
				const missing = nodePath.join(tmp, "state-home", "myapp", "store.db");
				const naive = Store.layerSqlite({ migrations, filename: missing });
				const naiveExit = yield* Effect.exit(Effect.provide(Effect.void, naive));
				const naiveCause = Exit.getCause(naiveExit);
				assert.isTrue(Option.isSome(naiveCause));
				assert.isTrue(Option.getOrThrow(naiveCause).reasons.some(Cause.isDieReason));

				// The ensure-before-open composition succeeds against the very same
				// absent directories.
				const exit = yield* Effect.exit(Effect.provide(Effect.void, appLive(tmp)));
				assert.isTrue(Exit.isSuccess(exit));
			}),
		),
	);

	it.effect("an unwritable ancestor surfaces a typed AppDirsError, never a die", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				// Root ignores file modes; under root this test cannot mean anything.
				if (typeof process.getuid === "function" && process.getuid() === 0) return;

				const locked = nodePath.join(tmp, "locked");
				yield* Effect.promise(() => nodeFs.mkdir(locked, { mode: 0o555 }));

				const layerUnderLock = App.layer({ namespace: "myapp", store: { migrations } }).pipe(
					Layer.provide(
						env({
							HOME: tmp,
							XDG_STATE_HOME: nodePath.join(locked, "state-home"),
							XDG_CACHE_HOME: nodePath.join(tmp, "cache-home"),
						}),
					),
					Layer.provide(Platform),
				);

				const exit = yield* Effect.exit(Effect.provide(Effect.void, layerUnderLock)).pipe(
					Effect.ensuring(Effect.promise(() => nodeFs.chmod(locked, 0o755))),
				);

				const cause = Exit.getCause(exit);
				assert.isTrue(Option.isSome(cause));
				const reasons = Option.getOrThrow(cause).reasons;
				// The anti-orDie regression test, aimed squarely at v3's
				// SqliteStateXdgLive: a typed FAILURE, and no die anywhere.
				assert.isFalse(reasons.some(Cause.isDieReason));
				const fail = reasons.find(Cause.isFailReason);
				assert.isDefined(fail);
				const error = fail?.error as { _tag?: string; directory?: string };
				assert.strictEqual(error._tag, "AppDirsError");
				assert.strictEqual(error.directory, "state");
			}),
		),
	);
});

class Settings extends Schema.Class<Settings>("Settings")({
	registry: Schema.String,
	concurrency: Schema.Number,
}) {}
class SettingsFile extends ConfigFile.Service<SettingsFile, Settings>()("app-int/SettingsFile") {}

describe("AppConfig.layer (integration)", () => {
	it.effect("discovers from $XDG_CONFIG_HOME, saves to the app config dir, namespace typed once", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				// Seed a config file under the namespace App.layer will be given.
				const configDir = nodePath.join(tmp, "config-home", "myapp");
				yield* Effect.promise(() => nodeFs.mkdir(configDir, { recursive: true }));
				yield* Effect.promise(() =>
					nodeFs.writeFile(
						nodePath.join(configDir, "settings.json"),
						`{"registry":"https://a.example","concurrency":2}`,
					),
				);

				// NO namespace here — it comes from the ambient AppDirs. If AppConfig
				// ever grows a namespace option "for flexibility", this test must fail.
				const ConfigLive = AppConfig.layer(SettingsFile, {
					filename: "settings.json",
					schema: Settings,
					codec: JsonCodec,
				});
				const MainLive = ConfigLive.pipe(Layer.provideMerge(appLive(tmp)), Layer.provide(Platform));

				const savedTo = yield* Effect.gen(function* () {
					const cfg = yield* SettingsFile;
					const loaded = yield* cfg.load;
					assert.instanceOf(loaded, Settings);
					assert.strictEqual(loaded.registry, "https://a.example");
					assert.strictEqual(loaded.concurrency, 2);
					return yield* cfg.save(Settings.make({ registry: "https://b.example", concurrency: 4 }));
				}).pipe(Effect.provide(MainLive));

				// The save target is <app config dir>/<filename> under the ONE namespace.
				assert.strictEqual(savedTo, nodePath.join(configDir, "settings.json"));
				const raw = yield* Effect.promise(() => nodeFs.readFile(savedTo, "utf8"));
				assert.include(raw, "https://b.example");
			}),
		),
	);
});

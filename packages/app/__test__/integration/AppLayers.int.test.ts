import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { CacheShape, StoreMigration, StoreShape } from "@effected/store";
import { Cache, Store } from "@effected/store";
import { AppDirs, Xdg } from "@effected/xdg";
import { ConfigProvider, Context, Effect, Layer, Option, Path } from "effect";
import { App, AppCache, AppStore } from "../../src/index.js";

const Platform = Layer.mergeAll(NodeFileSystem.layer, Path.layer);

/** Run `f` against a scratch HOME on the real filesystem, always cleaning up. */
const withTempHome = <A, E>(f: (tmp: string) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
	Effect.gen(function* () {
		const tmp = yield* Effect.promise(() => nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "effected-app-layers-")));
		return yield* f(tmp).pipe(Effect.ensuring(Effect.promise(() => nodeFs.rm(tmp, { recursive: true, force: true }))));
	});

const homeEnv = (tmp: string) =>
	ConfigProvider.layer(
		ConfigProvider.fromUnknown({
			HOME: tmp,
			XDG_CONFIG_HOME: nodePath.join(tmp, "config-home"),
			XDG_STATE_HOME: nodePath.join(tmp, "state-home"),
			XDG_CACHE_HOME: nodePath.join(tmp, "cache-home"),
		}),
	);

const existsOnDisk = (target: string): Effect.Effect<boolean> =>
	Effect.promise(() =>
		nodeFs.access(target).then(
			() => true,
			() => false,
		),
	);

const stateDir = (tmp: string) => nodePath.join(tmp, "state-home", "myapp");
const cacheDir = (tmp: string) => nodePath.join(tmp, "cache-home", "myapp");

/** The directories half, closed over a temp HOME and the real platform. */
const dirsLive = (tmp: string) =>
	App.layerDirs({ namespace: "myapp" }).pipe(Layer.provide(homeEnv(tmp)), Layer.provideMerge(Platform));

const primaryMigrations: ReadonlyArray<StoreMigration> = [
	{ id: 1, name: "create-runs", up: (sql) => sql`CREATE TABLE runs (id TEXT PRIMARY KEY)` },
];
const registryMigrations: ReadonlyArray<StoreMigration> = [
	{ id: 1, name: "create-packages", up: (sql) => sql`CREATE TABLE packages (name TEXT PRIMARY KEY)` },
	{ id: 2, name: "add-version", up: (sql) => sql`ALTER TABLE packages ADD COLUMN version TEXT` },
];
const sessionMigrations: ReadonlyArray<StoreMigration> = [
	{ id: 1, name: "create-sessions", up: (sql) => sql`CREATE TABLE sessions (id TEXT PRIMARY KEY)` },
];

class RegistryStore extends Context.Service<RegistryStore, StoreShape>()("app-int/RegistryStore") {}
class SessionStore extends Context.Service<SessionStore, StoreShape>()("app-int/SessionStore") {}
class TarballCache extends Context.Service<TarballCache, CacheShape>()("app-int/TarballCache") {}

/** Every table in a store's database, sorted, so presence and absence are both assertable. */
const tables = (store: StoreShape) =>
	Effect.map(
		store.client<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
		(rows) => rows.map((row) => row.name),
	);

/** The ledger's own rows — what this file believes it has applied. */
const ledger = (store: StoreShape) =>
	Effect.map(store.client<{ name: string }>`SELECT name FROM _store_migrations ORDER BY id`, (rows) =>
		rows.map((row) => row.name),
	);

describe("App.layerDirs (integration)", () => {
	it.effect("provides Xdg and AppDirs for the namespace", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				const appDirs = yield* AppDirs;
				assert.strictEqual(appDirs.namespace, "myapp");
				assert.strictEqual(appDirs.dirs.state, stateDir(tmp));
				const paths = yield* Xdg;
				assert.strictEqual(paths.home, tmp);
			}).pipe(Effect.provide(dirsLive(tmp))),
		),
	);

	it.effect("opens no database, even with the state and cache directories ensured (#923)", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				// Exercise AppDirs fully: the directories exist afterwards, so an absent
				// database file is about the layer, not about a missing directory.
				yield* Effect.gen(function* () {
					const appDirs = yield* AppDirs;
					yield* appDirs.ensureState;
					yield* appDirs.ensureCache;
				}).pipe(Effect.provide(dirsLive(tmp)));

				assert.isTrue(yield* existsOnDisk(stateDir(tmp)));
				assert.isTrue(yield* existsOnDisk(cacheDir(tmp)));
				assert.isFalse(yield* existsOnDisk(nodePath.join(stateDir(tmp), "store.db")));
				assert.isFalse(yield* existsOnDisk(nodePath.join(cacheDir(tmp), "cache.db")));
			}),
		),
	);

	it.effect("positive control: App.layer, built and unused, DOES create both database files", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				// Same probe as above, aimed at the eager layer: if these were false,
				// the absence assertions above would prove nothing.
				const eager = App.layer({ namespace: "myapp", store: { migrations: primaryMigrations } }).pipe(
					Layer.provide(homeEnv(tmp)),
					Layer.provide(Platform),
				);
				yield* Effect.provide(Effect.void, eager);
				assert.isTrue(yield* existsOnDisk(nodePath.join(stateDir(tmp), "store.db")));
				assert.isTrue(yield* existsOnDisk(nodePath.join(cacheDir(tmp), "cache.db")));
			}),
		),
	);
});

describe("AppStore.layerAs (integration)", () => {
	it.effect("a primary store and two keyed stores coexist, each with its own tables and ledger", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				const databases = Layer.mergeAll(
					AppStore.layer({ migrations: primaryMigrations }),
					AppStore.layerAs(RegistryStore, { filename: "registry.db", migrations: registryMigrations }),
					AppStore.layerAs(SessionStore, { filename: "sessions.db", migrations: sessionMigrations }),
				);

				yield* Effect.gen(function* () {
					const primary = yield* Store;
					const registry = yield* RegistryStore;
					const sessions = yield* SessionStore;

					// Writes land in the database the key names.
					yield* primary.client`INSERT INTO runs (id) VALUES ('r1')`;
					yield* registry.client`INSERT INTO packages (name, version) VALUES ('effect', '4.0.0')`;
					yield* sessions.client`INSERT INTO sessions (id) VALUES ('s1')`;

					// Each file holds its own schema and nothing of the others'.
					assert.deepStrictEqual(yield* tables(primary), ["_store_migrations", "runs"]);
					assert.deepStrictEqual(yield* tables(registry), ["_store_migrations", "packages"]);
					assert.deepStrictEqual(yield* tables(sessions), ["_store_migrations", "sessions"]);

					// Each ledger records exactly its own migrations.
					assert.deepStrictEqual(yield* ledger(primary), ["create-runs"]);
					assert.deepStrictEqual(yield* ledger(registry), ["create-packages", "add-version"]);
					assert.deepStrictEqual(yield* ledger(sessions), ["create-sessions"]);

					const rows = yield* registry.client<{ version: string }>`SELECT version FROM packages`;
					assert.deepStrictEqual(
						rows.map((row) => row.version),
						["4.0.0"],
					);
				}).pipe(Effect.provide(databases), Effect.provide(dirsLive(tmp)));

				// Files land in the state directory under the given names.
				assert.isTrue(yield* existsOnDisk(nodePath.join(stateDir(tmp), "store.db")));
				assert.isTrue(yield* existsOnDisk(nodePath.join(stateDir(tmp), "registry.db")));
				assert.isTrue(yield* existsOnDisk(nodePath.join(stateDir(tmp), "sessions.db")));
			}),
		),
	);

	it.effect("a keyed store alone does not provide Store and opens no store.db", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				const leaked = yield* Effect.gen(function* () {
					yield* RegistryStore;
					// The inner Store must not leak into the output context.
					return yield* Effect.serviceOption(Store);
				}).pipe(
					Effect.provide(AppStore.layerAs(RegistryStore, { filename: "registry.db", migrations: registryMigrations })),
					Effect.provide(dirsLive(tmp)),
				);
				assert.isTrue(Option.isNone(leaked));
				assert.isTrue(yield* existsOnDisk(nodePath.join(stateDir(tmp), "registry.db")));
				assert.isFalse(yield* existsOnDisk(nodePath.join(stateDir(tmp), "store.db")));
			}),
		),
	);
});

describe("AppCache.layerAs (integration)", () => {
	it.effect("a keyed cache coexists with the primary cache, each with its own entries", () =>
		withTempHome((tmp) =>
			Effect.gen(function* () {
				const databases = Layer.mergeAll(
					AppCache.layer(),
					AppCache.layerAs(TarballCache, { filename: "tarballs.db", maxEntries: 10 }),
				);
				const bytes = (text: string) => new TextEncoder().encode(text);

				yield* Effect.gen(function* () {
					const primary = yield* Cache;
					const tarballs = yield* TarballCache;
					yield* primary.set({ key: "only-primary", value: bytes("p") });
					yield* tarballs.set({ key: "only-tarballs", value: bytes("t") });

					assert.isTrue(Option.isSome(yield* primary.get("only-primary")));
					assert.isTrue(Option.isNone(yield* primary.get("only-tarballs")));
					assert.isTrue(Option.isSome(yield* tarballs.get("only-tarballs")));
					assert.isTrue(Option.isNone(yield* tarballs.get("only-primary")));
				}).pipe(Effect.provide(databases), Effect.provide(dirsLive(tmp)));

				assert.isTrue(yield* existsOnDisk(nodePath.join(cacheDir(tmp), "cache.db")));
				assert.isTrue(yield* existsOnDisk(nodePath.join(cacheDir(tmp), "tarballs.db")));
			}),
		),
	);
});

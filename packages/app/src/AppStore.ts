import type { StoreError, StoreMigrationError, StoreOptions, StoreShape, StoreSqliteOptions } from "@effected/store";
import { Store } from "@effected/store";
import type { AppDirs, AppDirsError } from "@effected/xdg";
import type { Context, FileSystem } from "effect";
import { Effect, Layer, Path } from "effect";
import { badFilename, badSubdir } from "./internal/filename.js";
import { ensureLocation } from "./internal/location.js";

/**
 * Options for {@link AppStore.layer} and {@link AppStore.layerAs}.
 *
 * @remarks
 * `StoreOptions` (the migrations, and `adoptMigratorLedger`) plus the SQLite
 * driver passthrough — `client`, `checkpointOnClose` — exactly as
 * `Store.layerSqlite` takes them. Only the path is this package's: a
 * directory kind, an optional subdirectory under it, and a file name.
 *
 * @public
 */
export interface AppStoreOptions extends StoreOptions, Pick<StoreSqliteOptions, "client" | "checkpointOnClose"> {
	/**
	 * File name within the database's directory. Default `"store.db"` on
	 * `AppStore.layer`; required on `AppStore.layerAs`.
	 *
	 * @remarks
	 * A single path component. An empty name, one containing a separator, or
	 * `.` / `..` would escape the namespace directory, so it **dies** at layer
	 * construction — it can only come from code, never from user input.
	 */
	readonly filename?: string;
	/**
	 * Which of the app's directories holds the file. Default `"state"`.
	 *
	 * @remarks
	 * The matching `AppDirs.ensure*` member creates it before the database
	 * opens. `"data"` suits a database that is the user's data rather than
	 * the app's bookkeeping; `"cache"` one that is safe to delete.
	 */
	readonly directory?: "state" | "data" | "cache";
	/**
	 * A relative subdirectory under `directory`, created (`mkdir -p`) before
	 * the database opens — for example a per-project key.
	 *
	 * @remarks
	 * `/`-separated single path components: no empty component, no `.` or
	 * `..`, no leading `/`, no `\`. Anything else would escape the namespace
	 * directory, so it **dies** at layer construction. A failure to create it
	 * is a typed `AppDirsError` naming `directory` and the full path.
	 */
	readonly subdir?: string;
}

/**
 * Guard the path options, ensure the location, and hand a resolved
 * `StoreSqliteOptions` to `open`. Shared by `layer` and `layerAs`; `context`
 * names the caller in a guard die.
 */
const build = <A, E>(
	context: string,
	options: AppStoreOptions,
	open: (resolved: StoreSqliteOptions) => Layer.Layer<A, E>,
): Layer.Layer<A, E | AppDirsError, AppDirs | Path.Path | FileSystem.FileSystem> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const { filename = "store.db", directory = "state", subdir, ...store } = options;
			const invalid = badFilename(context, filename) ?? (subdir === undefined ? undefined : badSubdir(context, subdir));
			if (invalid !== undefined) return yield* Effect.die(invalid);

			const path = yield* Path.Path;
			const dir = yield* ensureLocation(directory, subdir);
			return open({ ...store, filename: path.join(dir, filename) });
		}),
	);

// Implementation of AppStore.layer; the public contract lives on the static.
const layer = (
	options: AppStoreOptions,
): Layer.Layer<Store, AppDirsError | StoreError | StoreMigrationError, AppDirs | Path.Path | FileSystem.FileSystem> =>
	build("AppStore.layer", options, Store.layerSqlite);

// Implementation of AppStore.layerAs; the public contract lives on the static.
const layerAs = <I, S extends StoreShape>(
	tag: Context.Key<I, S> & ([StoreShape] extends [S] ? unknown : never),
	options: AppStoreOptions & { readonly filename: string },
): Layer.Layer<I, AppDirsError | StoreError | StoreMigrationError, AppDirs | Path.Path | FileSystem.FileSystem> =>
	build("AppStore.layerAs", options, (resolved) => Store.layerSqliteAs<I, S>(tag, resolved));

/**
 * The database glue: a migrated SQLite `Store` whose file lives in one of the
 * ambient `AppDirs` directories — the state directory unless told otherwise.
 *
 * @public
 */
export class AppStore {
	private constructor() {}

	/**
	 * Build the database layer: ensure `<directory>[/<subdir>]`, then
	 * `Store.layerSqlite` at `<directory>[/<subdir>]/<filename>` — by default
	 * `AppDirs.ensureState` and `<state dir>/store.db`.
	 *
	 * @remarks
	 * The ensure-before-open ordering is the load-bearing glue.
	 * `SqliteClient.layer` has no error channel and **defects** on a missing
	 * parent directory; `AppDirs.ensureState` is a `mkdir -p` on a **typed**
	 * `AppDirsError` channel. Running the ensure inside `Layer.unwrap`, before the
	 * store layer is built, converts a defect surface into a typed one — "the
	 * state directory could not be created" is an expected, recoverable boundary
	 * failure and it stays on `E`. Nothing is `orDie`d. A `subdir` is created
	 * with a recursive `mkdir` after the directory is ensured — that is why
	 * `FileSystem` is in `R` — and its failure lands on the same `AppDirsError`,
	 * naming the directory kind and the full path.
	 *
	 * This is a layer-returning function: bind the result to a `const` and reuse
	 * that binding, or memoization by reference is lost and the database is
	 * opened twice.
	 */
	static readonly layer = layer;

	/**
	 * Build an additional database under a service key the consumer defines:
	 * the same ensure-before-open glue as {@link AppStore.layer}, over
	 * `Store.layerSqliteAs`, provided as `I` instead of `Store`.
	 *
	 * @remarks
	 * For an application that keeps more than one SQLite database — each with
	 * its own migrations, its own ledger, and its own `directory` / `subdir`. `tag` is a
	 * consumer-defined `Context.Service` whose service type is exactly
	 * `StoreShape`; a key with any other shape is rejected at compile time —
	 * a wider shape (`StoreShape & { … }`) as an argument "not assignable to
	 * parameter of type 'never'", since this layer could not supply the extra
	 * members. The
	 * output is `I` alone: the `Store` the layer builds internally is provided
	 * to the re-tagging step and never leaks, so `layerAs` composes beside
	 * `AppStore.layer` without either shadowing the other.
	 *
	 * `filename` is **required** here, unlike on `AppStore.layer`. A defaulted
	 * `store.db` would silently land on the primary store's file — two
	 * connections and two migration ledgers on one database, each recording
	 * the other's migrations as unknown. Give each store its own name. The same
	 * single-path-component guard applies, and a bad name dies at construction.
	 *
	 * This is a layer-returning function: bind the result to a `const` once and
	 * reuse that binding, or memoization by reference is lost and the database
	 * is opened twice.
	 *
	 * @example
	 * ```ts
	 * import { AppStore } from "@effected/app";
	 * import type { StoreMigration, StoreShape } from "@effected/store";
	 * import { Context, Effect } from "effect";
	 *
	 * class RegistryStore extends Context.Service<RegistryStore, StoreShape>()("myapp/RegistryStore") {}
	 *
	 * const registryMigrations: ReadonlyArray<StoreMigration> = [
	 * 	{ id: 1, name: "packages", up: (sql) => sql`CREATE TABLE packages (name TEXT PRIMARY KEY)` },
	 * ];
	 *
	 * // Bound once, to a const: <state dir>/registry.db, provided as RegistryStore.
	 * const RegistryStoreLive = AppStore.layerAs(RegistryStore, {
	 * 	filename: "registry.db",
	 * 	migrations: registryMigrations,
	 * });
	 *
	 * const program = Effect.gen(function* () {
	 * 	const registry = yield* RegistryStore;
	 * 	yield* registry.client`INSERT INTO packages (name) VALUES ('effect')`;
	 * });
	 *
	 * // A per-project database under the data directory: <data dir>/<projectKey>/data.db.
	 * // Call it once per key and bind the result — each call is a new layer.
	 * const projectStore = (projectKey: string) =>
	 * 	AppStore.layerAs(RegistryStore, { filename: "data.db", directory: "data", subdir: projectKey, migrations: [] });
	 * // Requires AppDirs, Path and FileSystem — App.layerDirs and the platform layer supply them.
	 * ```
	 */
	static readonly layerAs = layerAs;
}

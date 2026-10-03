import type { StoreError, StoreMigrationError, StoreOptions, StoreShape } from "@effected/store";
import { Store } from "@effected/store";
import type { AppDirsError } from "@effected/xdg";
import { AppDirs } from "@effected/xdg";
import type { Context } from "effect";
import { Effect, Layer, Path } from "effect";
import { badFilename } from "./internal/filename.js";

/**
 * Options for {@link AppStore.layer}.
 *
 * @public
 */
export interface AppStoreOptions extends StoreOptions {
	/**
	 * File name within the app's state directory. Default `"store.db"`.
	 *
	 * @remarks
	 * A single path component. An empty name, or one containing a separator,
	 * would escape the namespace directory, so it **dies** at layer
	 * construction — it can only come from code, never from user input.
	 */
	readonly filename?: string;
}

/** The shared body of `layer` and `layerAs`; `context` names the caller in a guard die. */
const build = (
	context: string,
	options: AppStoreOptions,
): Layer.Layer<Store, AppDirsError | StoreError | StoreMigrationError, AppDirs | Path.Path> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const filename = options.filename ?? "store.db";
			const invalid = badFilename(context, filename);
			if (invalid !== undefined) return yield* Effect.die(invalid);

			const appDirs = yield* AppDirs;
			const path = yield* Path.Path;
			const stateDir = yield* appDirs.ensureState;
			return Store.layerSqlite({ ...options, filename: path.join(stateDir, filename) });
		}),
	);

// Implementation of AppStore.layer; the public contract lives on the static.
const layer = (
	options: AppStoreOptions,
): Layer.Layer<Store, AppDirsError | StoreError | StoreMigrationError, AppDirs | Path.Path> =>
	build("AppStore.layer", options);

// Implementation of AppStore.layerAs; the public contract lives on the static.
const layerAs = <I, S extends StoreShape>(
	tag: Context.Key<I, S> & ([StoreShape] extends [S] ? unknown : never),
	options: AppStoreOptions & { readonly filename: string },
): Layer.Layer<I, AppDirsError | StoreError | StoreMigrationError, AppDirs | Path.Path> =>
	// The constraint pins S to exactly StoreShape, so the key may be read at it.
	Layer.effect(tag as Context.Key<I, StoreShape>, Store).pipe(Layer.provide(build("AppStore.layerAs", options)));

/**
 * The state-directory database glue: a migrated SQLite `Store` whose file
 * lives in the ambient `AppDirs` state directory.
 *
 * @public
 */
export class AppStore {
	private constructor() {}

	/**
	 * Build the state-directory database layer: `AppDirs.ensureState`, then
	 * `Store.layerSqlite` at `<state dir>/<filename>`.
	 *
	 * @remarks
	 * The ensure-before-open ordering is the load-bearing glue.
	 * `SqliteClient.layer` has no error channel and **defects** on a missing
	 * parent directory; `AppDirs.ensureState` is a `mkdir -p` on a **typed**
	 * `AppDirsError` channel. Running the ensure inside `Layer.unwrap`, before the
	 * store layer is built, converts a defect surface into a typed one — "the
	 * state directory could not be created" is an expected, recoverable boundary
	 * failure and it stays on `E`. Nothing is `orDie`d.
	 *
	 * This is a layer-returning function: bind the result to a `const` and reuse
	 * that binding, or memoization by reference is lost and the database is
	 * opened twice.
	 */
	static readonly layer = layer;

	/**
	 * Build an additional state-directory database under a service key the
	 * consumer defines: the same ensure-before-open glue as {@link AppStore.layer},
	 * provided as `I` instead of `Store`.
	 *
	 * @remarks
	 * For an application that keeps more than one SQLite database in its state
	 * directory — each with its own migrations and its own ledger. `tag` is a
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
	 * // Requires AppDirs and Path — App.layerDirs and the platform layer supply them.
	 * ```
	 */
	static readonly layerAs = layerAs;
}

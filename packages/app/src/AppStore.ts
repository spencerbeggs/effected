import type { StoreError, StoreMigrationError, StoreOptions } from "@effected/store";
import { Store } from "@effected/store";
import type { AppDirsError } from "@effected/xdg";
import { AppDirs } from "@effected/xdg";
import { Effect, Layer, Path } from "effect";
import { badFilename } from "./internal/filename.js";

/**
 * Options for {@link (AppStore:variable).layer}.
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
const layer = (
	options: AppStoreOptions,
): Layer.Layer<Store, AppDirsError | StoreError | StoreMigrationError, AppDirs | Path.Path> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const filename = options.filename ?? "store.db";
			const invalid = badFilename("AppStore.layer", filename);
			if (invalid !== undefined) return yield* Effect.die(invalid);

			const appDirs = yield* AppDirs;
			const path = yield* Path.Path;
			const stateDir = yield* appDirs.ensureState;
			return Store.layerSqlite({ ...options, filename: path.join(stateDir, filename) });
		}),
	);

/**
 * The state-directory database glue: a migrated SQLite `Store` whose file
 * lives in the ambient `AppDirs` state directory.
 *
 * @public
 */
export const AppStore = { layer } as const;

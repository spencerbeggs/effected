import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * SQLite-only support shared by the `Store` and `Cache` batteries-included
 * layers. Facade-free like `migrator.ts`: it never imports a facade module.
 */

/**
 * A layer that registers a `PRAGMA wal_checkpoint(TRUNCATE)` finalizer against
 * the ambient `SqlClient`.
 *
 * Because this layer *depends on* the client layer, it is built after the
 * client — so its finalizer is registered later and runs earlier: the
 * checkpoint executes against the still-open connection, before the driver's
 * own `db.close()` finalizer. The checkpoint is best-effort (`Effect.ignore`):
 * a failure at shutdown must never turn a clean close into a failed one, and
 * SQLite itself checkpoints on the last close anyway — this exists for the
 * database files another process may open in between.
 *
 * A *factory*, not a shared layer const, on purpose: layers memoize by
 * reference, so one shared checkpoint layer used by both a `Store` and a
 * `Cache` over two different database files would build once and checkpoint
 * only the first.
 */
export const walCheckpointOnClose = (): Layer.Layer<never, never, SqlClient.SqlClient> =>
	Layer.effectDiscard(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient;
			yield* Effect.addFinalizer(() => sql`PRAGMA wal_checkpoint(TRUNCATE)`.pipe(Effect.ignore));
		}),
	);

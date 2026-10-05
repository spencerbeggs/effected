import { Effect, Layer } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

// SQLite-only support shared by the `Store` and `Cache` batteries-included
// layers. Facade-free like `migrator.ts`: it never imports a facade module.

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

/**
 * Re-provide `SqlClient` from `client` after running `onConnect` against it,
 * so the hook completes before anything downstream — the ledger, adoption,
 * migrations — touches the connection, and outside any transaction. The
 * driver opens one connection per build, so this runs once per connection.
 * `toError` maps the hook's `SqlError` onto the calling service's own error.
 */
export const withOnConnect = <E1, E2>(
	client: Layer.Layer<SqlClient.SqlClient, E1>,
	onConnect: ((sql: SqlClient.SqlClient) => Effect.Effect<unknown, SqlError>) | undefined,
	toError: (cause: SqlError) => E2,
): Layer.Layer<SqlClient.SqlClient, E1 | E2> =>
	onConnect === undefined
		? client
		: Layer.effect(
				SqlClient.SqlClient,
				Effect.tap(SqlClient.SqlClient, (sql) => onConnect(sql).pipe(Effect.mapError(toError))),
			).pipe(Layer.provide(client));

/**
 * Re-raise the driver's own setup failure — opening the file, configuring
 * it, switching it to WAL — as the calling service's error, so the
 * batteries-included layers keep their declared error unions. Apply it to the
 * client layer once and reuse the result: layers memoize by reference, and
 * the checkpoint layer must share the same connection.
 */
export const mapSetupError = <E>(
	client: Layer.Layer<SqlClient.SqlClient, SqlError>,
	toError: (cause: SqlError) => E,
): Layer.Layer<SqlClient.SqlClient, E> =>
	Layer.catchTag(client, "SqlError", (cause) => Layer.effect(SqlClient.SqlClient, Effect.fail(toError(cause))));

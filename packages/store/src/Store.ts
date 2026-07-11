import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type * as SqlError from "effect/unstable/sql/SqlError";
import type { MigratorFailure } from "./internal/migrator.js";
import { ensureLedger, rollbackTo, runPending, statusOf, validateMigrations } from "./internal/migrator.js";

/**
 * A single user-defined migration, applied in ascending `id` order.
 *
 * @remarks
 * `id` must be a positive integer, unique within the migration list — a
 * violation is developer wiring, not runtime input, and dies at layer
 * construction. `up` runs when the migration is applied; the optional `down`
 * runs when {@link StoreShape.rollback} unwinds past it. Both do SQL work, so
 * their typed channel is `SqlError`; a callback that throws instead is a
 * programmer bug and stays a defect.
 *
 * @public
 */
export interface StoreMigration {
	/** Positive-integer identity, unique within the list; ordering key. */
	readonly id: number;
	/** Human-readable label, recorded in the ledger. */
	readonly name: string;
	/** Apply the migration. */
	readonly up: (sql: SqlClient.SqlClient) => Effect.Effect<void, SqlError.SqlError>;
	/** Unwind the migration; omit when the migration is irreversible. */
	readonly down?: (sql: SqlClient.SqlClient) => Effect.Effect<void, SqlError.SqlError>;
}

/**
 * What a {@link StoreShape.migrate} or {@link StoreShape.rollback} call
 * changed.
 *
 * @public
 */
export interface StoreMigrationResult {
	/** Migrations applied by this call, in application order. */
	readonly applied: ReadonlyArray<{ readonly id: number; readonly name: string }>;
	/** Migrations rolled back by this call, newest first. */
	readonly rolledBack: ReadonlyArray<{ readonly id: number; readonly name: string }>;
}

/**
 * The applied/pending status of a single {@link StoreMigration}.
 *
 * @public
 */
export class StoreMigrationStatus extends Schema.Class<StoreMigrationStatus>("StoreMigrationStatus")({
	/** The migration's id. */
	id: Schema.Number,
	/** The migration's name. */
	name: Schema.String,
	/** When the migration was applied; absent while it is pending. */
	appliedAt: Schema.optionalKey(Schema.DateTimeUtc),
}) {}

/**
 * Raised when a store operation's own SQL fails — ledger bookkeeping or the
 * queries around a migration.
 *
 * @remarks
 * `cause` carries the underlying `SqlError` structurally; v3 flattened it to a
 * `reason` string. A failing user migration raises the more specific
 * {@link StoreMigrationError} instead.
 *
 * @public
 */
export class StoreError extends Schema.TaggedErrorClass<StoreError>()("StoreError", {
	/** The store operation that failed. */
	operation: Schema.Literals(["setup", "migrate", "rollback", "status"]),
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Store ${this.operation} failed`;
	}
}

/**
 * Raised when a user-supplied migration fails with a typed `SqlError`.
 *
 * @remarks
 * Carries the failing migration's `id`, `name` and `direction` — exactly what
 * a caller needs to report or repair. The v3 shape ran migrations through an
 * `orDie`/`catchAllDefect` round-trip that laundered defects into failures;
 * here a throwing migration callback stays a defect, and only its typed
 * `SqlError` channel lands in `cause`.
 *
 * @public
 */
export class StoreMigrationError extends Schema.TaggedErrorClass<StoreMigrationError>()("StoreMigrationError", {
	/** Whether the failure happened applying (`up`) or unwinding (`down`). */
	direction: Schema.Literals(["up", "down"]),
	/** The failing migration's id. */
	id: Schema.Number,
	/** The failing migration's name. */
	name: Schema.String,
	/** The migration's `SqlError`, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Store migration ${this.id} "${this.name}" failed while migrating ${this.direction}`;
	}
}

/**
 * The service shape {@link Store} provides.
 *
 * @public
 */
export interface StoreShape {
	/** The underlying SQL client, for the consumer's own schema-aware queries. */
	readonly client: SqlClient.SqlClient;
	/**
	 * Apply every pending migration in ascending `id` order.
	 *
	 * @remarks
	 * Layer construction already runs this, so it is a no-op until a
	 * {@link StoreShape.rollback} re-opens a gap.
	 */
	readonly migrate: Effect.Effect<StoreMigrationResult, StoreError | StoreMigrationError>;
	/**
	 * Roll back applied migrations with `id > toId`, newest first, invoking
	 * `down` where defined.
	 *
	 * @remarks
	 * A migration without a `down` is skipped over — its ledger row is still
	 * removed. `toId` must be a non-negative integer (`rollback(0)` unwinds
	 * everything); anything else is developer wiring and dies.
	 */
	readonly rollback: (toId: number) => Effect.Effect<StoreMigrationResult, StoreError | StoreMigrationError>;
	/** Project the full migration list with each migration's `appliedAt`. */
	readonly status: Effect.Effect<ReadonlyArray<StoreMigrationStatus>, StoreError>;
}

/**
 * Options for the {@link Store} layers.
 *
 * @public
 */
export interface StoreOptions {
	/** The user-defined migration list; ids are positive integers, unique. */
	readonly migrations: ReadonlyArray<StoreMigration>;
}

/**
 * Options for {@link Store.layerSqlite}.
 *
 * @public
 */
export interface StoreSqliteOptions extends StoreOptions {
	/**
	 * The SQLite database file path.
	 *
	 * @remarks
	 * The parent directory must exist — a missing directory is a wiring defect
	 * from the driver, not a typed failure. Path policy (which directory a
	 * store belongs in) is the caller's concern.
	 */
	readonly filename: string;
}

const LEDGER_TABLE = "_store_migrations";

type StoreOperation = "setup" | "migrate" | "rollback" | "status";

const materialize =
	(operation: StoreOperation) =>
	(failure: MigratorFailure): StoreError | StoreMigrationError =>
		failure._tag === "migration"
			? new StoreMigrationError({
					direction: failure.direction,
					id: failure.id,
					name: failure.name,
					cause: failure.cause,
				})
			: new StoreError({ operation, cause: failure.cause });

const toStatus = (record: { readonly id: number; readonly name: string; readonly appliedAt?: string }) =>
	StoreMigrationStatus.make({
		id: record.id,
		name: record.name,
		...(record.appliedAt !== undefined ? { appliedAt: DateTime.makeUnsafe(record.appliedAt) } : {}),
	});

const make = (
	options: StoreOptions,
): Effect.Effect<StoreShape, StoreError | StoreMigrationError, SqlClient.SqlClient> =>
	Effect.gen(function* () {
		const problem = validateMigrations(options.migrations);
		if (problem !== undefined) {
			return yield* Effect.die(new Error(`Store.layer: ${problem}`));
		}
		const sql = yield* SqlClient.SqlClient;

		yield* ensureLedger(sql, LEDGER_TABLE).pipe(Effect.mapError(materialize("setup")));
		yield* runPending(sql, LEDGER_TABLE, options.migrations).pipe(Effect.mapError(materialize("migrate")));

		const migrate = runPending(sql, LEDGER_TABLE, options.migrations).pipe(
			Effect.mapError(materialize("migrate")),
			Effect.withSpan("Store.migrate"),
		);

		const rollback = Effect.fn("Store.rollback")(function* (toId: number) {
			if (!Number.isInteger(toId) || toId < 0) {
				return yield* Effect.die(new Error(`Store.rollback: toId must be a non-negative integer, received ${toId}`));
			}
			return yield* rollbackTo(sql, LEDGER_TABLE, options.migrations, toId).pipe(
				Effect.mapError(materialize("rollback")),
			);
		});

		// `statusOf` runs no user migration, so its only failure is the ledger's.
		const status = statusOf(sql, LEDGER_TABLE, options.migrations).pipe(
			Effect.mapError((failure) => new StoreError({ operation: "status", cause: failure.cause })),
			Effect.map((records) => records.map(toStatus)),
			Effect.withSpan("Store.status"),
		);

		return { client: sql, migrate, rollback, status } satisfies StoreShape;
	});

/**
 * A schema-versioned, migrated SQL client: a managed database connection with
 * a user-defined migration ledger.
 *
 * @remarks
 * Layer construction ensures the `_store_migrations` ledger table and applies
 * every pending migration, surfacing failures on the layer's typed error
 * channel — never `orDie`. The layer statics are parameterized factories: call
 * each once and bind the result to a `const`, or memoization by reference is
 * lost and the database is opened twice.
 *
 * @example
 * ```ts
 * const migrations: ReadonlyArray<StoreMigration> = [
 * 	{ id: 1, name: "create-notes", up: (sql) => Effect.asVoid(sql`CREATE TABLE notes (body TEXT)`) },
 * ];
 * const StoreLayer = Store.layerSqlite({ filename: "/tmp/app/state.db", migrations });
 * ```
 *
 * @public
 */
export class Store extends Context.Service<Store, StoreShape>()("@effected/store/Store") {
	/**
	 * The driver-agnostic layer: requires an abstract `SqlClient`, so any
	 * Effect SQL driver satisfies it.
	 */
	static layer(options: StoreOptions): Layer.Layer<Store, StoreError | StoreMigrationError, SqlClient.SqlClient> {
		return Layer.effect(Store, make(options));
	}

	/** The batteries-included layer over `@effect/sql-sqlite-node`. */
	static layerSqlite(options: StoreSqliteOptions): Layer.Layer<Store, StoreError | StoreMigrationError> {
		return Layer.provide(Store.layer(options), SqliteClient.layer({ filename: options.filename }));
	}

	/** An in-memory (`:memory:`) layer for tests. */
	static layerTest(options: StoreOptions): Layer.Layer<Store, StoreError | StoreMigrationError> {
		return Store.layerSqlite({ ...options, filename: ":memory:" });
	}
}

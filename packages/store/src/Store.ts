import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";
import type { AdoptFailure, MigratorFailure, RollbackHistory } from "./internal/migrator.js";
import {
	adoptForeignLedger,
	ensureLedger,
	failureCause,
	rollbackTo,
	runPending,
	statusOf,
	syncMirror,
	validateMigrations,
} from "./internal/migrator.js";
import { walCheckpointOnClose, withOnConnect } from "./internal/sqlite.js";

/**
 * A single user-defined migration, applied in ascending `id` order.
 *
 * @remarks
 * `id` must be a positive integer, unique within the migration list — a
 * violation is developer wiring, not runtime input, and dies at layer
 * construction. `up` runs when the migration is applied; the optional `down`
 * runs when {@link StoreShape.rollback} unwinds past it. Both do SQL work, so
 * their typed channel is `SqlError`; a callback that throws instead is a
 * programmer bug and stays a defect. The engine discards each callback's
 * success value — the success type is `unknown`, so a callback can return the
 * raw statement effect directly with no `Effect.asVoid` ceremony.
 *
 * @public
 */
export interface StoreMigration {
	/** Positive-integer identity, unique within the list; ordering key. */
	readonly id: number;
	/** Human-readable label, recorded in the ledger. */
	readonly name: string;
	/** Apply the migration; the success value is discarded. */
	readonly up: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, SqlError.SqlError>;
	/** Unwind the migration (value discarded); omit when irreversible. */
	readonly down?: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, SqlError.SqlError>;
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
 * The most specific message in a cause. A `SqlError`'s own message is the
 * driver's generic summary ("Failed to execute statement"); the database's
 * text ("UNIQUE constraint failed: t.id") sits at the innermost `cause`, so the
 * chain is walked to it. SQLite's messages name objects, never bound values.
 */
const causeMessage = (cause: unknown): string | undefined => {
	if (!(cause instanceof Error)) return undefined;
	let message = cause.message.length > 0 ? cause.message : undefined;
	if ((cause as { readonly _tag?: unknown })._tag === "SqlError") {
		let node: unknown = cause.cause;
		for (let depth = 0; depth < 8 && node instanceof Error; depth++) {
			if (node.message.length > 0) message = node.message;
			node = node.cause;
		}
	}
	return message;
};

/**
 * Raised when a store operation's own SQL fails — ledger bookkeeping or the
 * queries around a migration — or when adopting a foreign ledger finds it
 * disagrees with the migration list.
 *
 * @remarks
 * `cause` carries the underlying `SqlError` structurally. A failing user migration raises the more specific
 * {@link StoreMigrationError} instead. With `operation: "adopt"`, `cause` is
 * either the adoption step's `SqlError` or an `Error` whose message names the
 * mismatched migration, the unreadable timestamp, or the unsupported dialect
 * (see {@link StoreOptions.adoptMigratorLedger}).
 *
 * @public
 */
export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {
	/** The store operation that failed. */
	operation: Schema.Literals(["setup", "adopt", "migrate", "rollback", "status"]),
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		const detail = causeMessage(this.cause);
		return detail === undefined ? `Store ${this.operation} failed` : `Store ${this.operation} failed: ${detail}`;
	}
}

/**
 * Raised when a user-supplied migration fails with a typed `SqlError`.
 *
 * @remarks
 * Carries the failing migration's `id`, `name` and `direction` — exactly what
 * a caller needs to report or repair. A throwing migration callback stays a
 * defect; only its typed `SqlError` channel lands in `cause`.
 *
 * @public
 */
export class StoreMigrationError extends Schema.TaggedError<StoreMigrationError>()("StoreMigrationError", {
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
	 *
	 * Every rollback also records a small tombstone per unwound id in
	 * `_store_meta`, whatever the options, so a later mirrored import can tell
	 * a row Store rolled back from one an older program applied (see
	 * {@link StoreOptions.mirrorMigratorLedger}). On SQLite only; a database
	 * never rolled back carries no tombstones, and no `_store_meta` table
	 * unless `adoptMigratorLedger` has written its marker there.
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
	/**
	 * Adopt the history an effect/sql `Migrator` (for example
	 * `SqliteMigrator.layer`) already recorded in this database, so moving a
	 * live database onto `Store` does not re-run its migrations. Opt-in;
	 * `true` reads the Migrator's default table, `effect_sql_migrations`;
	 * `false`, like leaving it out, is off.
	 *
	 * @remarks
	 * **One-shot, decided by the first layer build that has the option on.**
	 * That build — after the `_store_migrations` ledger is ensured, before
	 * pending migrations run, in one write-locked transaction — copies every
	 * foreign row (`migration_id`, `name`, `created_at`) into
	 * `_store_migrations` **if** `_store_migrations` is empty and the foreign
	 * table exists, and in every case records that the decision was made in a
	 * `_store_meta` table, in the same transaction. Every later build sees the
	 * marker and skips adoption entirely, so leaving the option on is safe —
	 * including after `rollback(0)`: the marker survives the rollback, so a
	 * reopen re-applies every migration from scratch rather than re-adopting
	 * history the rollback unwound. The foreign table is read, never written.
	 * A failed adoption records nothing, marker included, and is retried on
	 * the next build.
	 *
	 * Adoption honours rollback history. A Store that ran without the option
	 * and rolled back leaves a tombstone per unwound id (see
	 * `StoreShape.rollback`); each foreign row is judged against it, as the
	 * mirror's import is. A row unchanged since that rollback is stale: it is
	 * not adopted, and its migration runs again. A row changed or written
	 * since is adopted. A row for a foreign table the rollback did not track
	 * is refused, typed. So enabling the option after such a rollback is safe.
	 *
	 * SQLite only: on any other dialect the option fails the layer with a
	 * `StoreError` (`operation: "adopt"`).
	 *
	 * Matching is exact, and a disagreement fails the layer with a
	 * `StoreError` whose `operation` is `"adopt"` — never a silent skip:
	 *
	 * - each foreign row needs a migration with the same `id` **and** `name`.
	 *   effect/sql's loaders store the key with its numeric prefix stripped —
	 *   `fromRecord`'s `"0001_initial"` is recorded as id `1`, name
	 *   `"initial"` — so the matching `StoreMigration` is
	 *   `{ id: 1, name: "initial" }`;
	 * - every migration at or below the foreign ledger's highest id must have
	 *   a foreign row. effect/sql only ever runs ids above its latest, so a
	 *   lower id it never recorded was never applied, and applying it now
	 *   would diverge from the history the database actually has.
	 *
	 * Migrations above the adopted ones then apply as usual. `created_at`
	 * becomes each adopted row's `appliedAt`; a zone-less value
	 * (`2026-10-03 12:00:00`, SQLite's `current_timestamp`, or
	 * `2026-10-03T12:00:00`) is read as UTC, and one that cannot be read as a
	 * date fails the layer the same typed way.
	 */
	readonly adoptMigratorLedger?: boolean | { readonly table?: string };
	/**
	 * Keep effect/sql's `Migrator` ledger in step with `Store`'s own, so an
	 * older program that still migrates this database through effect/sql's
	 * `Migrator` (`SqliteMigrator.layer`) sees the migrations `Store` applied
	 * and runs nothing. Opt-in, for a transition period in which several
	 * versions of a program share one database; `true` writes the Migrator's
	 * default table, `effect_sql_migrations`; `false`, like leaving it out, is
	 * off.
	 *
	 * @remarks
	 * **Two-way for matching rows.** An older program may migrate the shared
	 * database forward between this program's opens, so the mirror is read as
	 * well as written:
	 *
	 * - **At every layer build**, after any adoption and before pending
	 *   migrations run, in one transaction: the foreign table is created with
	 *   effect/sql's own SQLite DDL if absent; every foreign row
	 *   `_store_migrations` lacks is **imported**, if it matches a migration by
	 *   id and name (its `created_at` becomes `appliedAt`); then every
	 *   `_store_migrations` row the foreign table lacks is copied out. A
	 *   database whose ledger predates the option is brought level on its
	 *   first build with the option on.
	 * - **On every apply**, the migration's own write-locked transaction first
	 *   checks the foreign table too: an id an older program recorded since
	 *   this one planned is imported, never re-run. Otherwise the
	 *   `(migration_id, name)` row is inserted in the same transaction as the
	 *   migration and its `_store_migrations` row, so the ledgers cannot
	 *   disagree.
	 * - **Import is validated like adoption** and refused typed (`StoreError`
	 *   `operation: "setup"`, or `"migrate"` when met mid-run): a foreign row
	 *   whose id has no migration, a name mismatch, an unreadable `created_at`,
	 *   or a known migration below the imported high-water mark that neither
	 *   ledger records.
	 * - **On every rollback**, the row is deleted in the same transaction.
	 *   effect/sql's `Migrator` runs every id above its highest recorded one,
	 *   so after `rollback(n)` an older program would re-apply what was
	 *   unwound — the same thing a `Store` reopen does.
	 * - **Rollbacks leave history**, whether or not this option is on at the
	 *   time — a Store without it may roll back a database another opening
	 *   mirrors, which leaves a foreign row behind. Each rollback tombstones
	 *   the id in `_store_meta` with, per foreign ledger, the `created_at` its
	 *   row had as the rollback left it (or none). Import then judges a
	 *   foreign row for a tombstoned id: **unchanged** (the same `created_at`)
	 *   means stale — it is not imported, and the migration runs again, which
	 *   is right because its `down` ran; **changed or newly present** means an
	 *   older program re-applied it after the rollback — imported; and a
	 *   foreign table the rollback did not snapshot cannot be judged —
	 *   refused, typed. No clock comparison is involved (`created_at` has
	 *   one-second resolution). Re-applying or importing an id clears its
	 *   tombstone. Foreign rows are never deleted by a Store without the
	 *   option: that ledger belongs to the older program.
	 * - **With `adoptMigratorLedger`**: both default to the same table, which
	 *   is the intended pairing — adoption copies the old history in once,
	 *   mirroring keeps writing it. Adoption runs first.
	 * - **Names** are written as `StoreMigration.name`, which must be the
	 *   prefix-stripped form effect/sql records (`"initial"` for
	 *   `"0001_initial"`); effect/sql itself compares ids only.
	 *
	 * SQLite only: on any other dialect the option fails the layer with a
	 * `StoreError` (`operation: "setup"`).
	 */
	readonly mirrorMigratorLedger?: boolean | { readonly table?: string };
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
	/**
	 * Remaining driver options, passed through to `SqliteClient.layer`.
	 *
	 * @remarks
	 * `filename` is owned by this layer and cannot be overridden here. The two
	 * name-transform options (`transformResultNames`, `transformQueryNames`)
	 * are deliberately excluded: they rewrite the result names of the
	 * migration ledger's own queries, silently making {@link StoreShape.status}
	 * report every migration pending. Consumers who need name transforms wire
	 * their own client under the abstract {@link Store.layer}.
	 */
	readonly client?: Omit<SqliteClient.SqliteClientConfig, "filename" | "transformResultNames" | "transformQueryNames">;
	/**
	 * Register a `PRAGMA wal_checkpoint(TRUNCATE)` finalizer that runs before
	 * the driver closes the connection.
	 *
	 * @remarks
	 * Useful when another process may open the database file after this scope
	 * closes: the WAL is folded into the main file eagerly rather than on the
	 * next open. The checkpoint is best-effort — a failure is ignored so a
	 * clean shutdown never turns into a failed one. SQLite-specific by nature,
	 * so the option lives here and not on the driver-agnostic
	 * {@link Store.layer}; {@link Store.layerTest} (`:memory:`) has no WAL and
	 * never checkpoints.
	 */
	readonly checkpointOnClose?: boolean;
	/**
	 * Run once against the freshly opened connection, before the ledger is
	 * ensured, before adoption and before any migration — and outside any
	 * transaction. For per-connection settings `client` cannot carry, such as
	 * `PRAGMA synchronous` (FULL by default) or `cache_size` — settings that
	 * a migration cannot hold, since a migration runs once per database, not
	 * once per connection.
	 *
	 * @remarks
	 * The SQLite driver opens one connection per layer build, so once per
	 * build is once per connection. A failure fails the layer as a
	 * `StoreError` with `operation: "setup"`.
	 *
	 * Foreign keys need no hook: `node:sqlite` opens every connection with
	 * `foreign_keys` on, and the driver keeps it.
	 *
	 * @example
	 * ```ts
	 * const StoreLive = Store.layerSqlite({
	 * 	filename: "sessions.db",
	 * 	migrations,
	 * 	// FULL (2) by default; NORMAL is the usual choice under WAL.
	 * 	onConnect: (sql) => sql`PRAGMA synchronous = NORMAL`,
	 * });
	 * ```
	 */
	readonly onConnect?: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, SqlError.SqlError>;
}

const LEDGER_TABLE = "_store_migrations";

/**
 * The foreign ledger table a ledger option names, or `undefined` when it is
 * off. `false` and `undefined` are both off — options assembled from data or
 * plain JavaScript can carry an explicit `false`, which must never read as
 * "on, default table".
 */
const ledgerTable = (option: boolean | { readonly table?: string } | undefined): string | undefined =>
	option === undefined || option === false
		? undefined
		: option === true
			? FOREIGN_LEDGER_TABLE
			: (option.table ?? FOREIGN_LEDGER_TABLE);

/** Store's own bookkeeping beside the ledger; holds the adoption marker. */
const META_TABLE = "_store_meta";

/** effect/sql's `Migrator` default ledger table. */
const FOREIGN_LEDGER_TABLE = "effect_sql_migrations";

const materializeAdopt = (failure: AdoptFailure): StoreError =>
	new StoreError({
		operation: "adopt",
		cause: failure._tag === "sql" ? failure.cause : new Error(failure.message),
	});

type StoreOperation = "setup" | "migrate" | "rollback" | "status";

const materialize =
	(operation: StoreOperation) =>
	(failure: MigratorFailure): StoreError | StoreMigrationError =>
		failure._tag === "refused"
			? new StoreError({ operation, cause: new Error(failure.message) })
			: failure._tag === "migration"
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
		const adoptFrom = ledgerTable(options.adoptMigratorLedger);
		if (adoptFrom !== undefined) {
			const foreign = adoptFrom;
			const adopted = yield* adoptForeignLedger(sql, LEDGER_TABLE, META_TABLE, foreign, options.migrations).pipe(
				Effect.mapError(materializeAdopt),
				Effect.withSpan("Store.adoptMigratorLedger"),
			);
			if (adopted.length > 0) {
				const last = adopted[adopted.length - 1];
				yield* Effect.logDebug("Adopted migrator ledger").pipe(
					Effect.annotateLogs("migrator_table", foreign),
					Effect.annotateLogs("adopted_count", String(adopted.length)),
					Effect.annotateLogs("latest_migration_id", String(last?.id)),
					Effect.annotateLogs("latest_migration_name", String(last?.name)),
				);
			}
		}
		const mirror = ledgerTable(options.mirrorMigratorLedger);
		// Rollback history is kept whatever the options — a Store opened without
		// the mirror may roll back a database another opening mirrors — and it
		// snapshots every foreign ledger this database could later import from.
		const adoptTable = adoptFrom ?? FOREIGN_LEDGER_TABLE;
		const history: RollbackHistory = {
			meta: META_TABLE,
			foreignTables: [...new Set([FOREIGN_LEDGER_TABLE, adoptTable, ...(mirror === undefined ? [] : [mirror])])],
		};
		if (mirror !== undefined) {
			yield* syncMirror(sql, LEDGER_TABLE, mirror, options.migrations, history).pipe(
				Effect.mapError(
					(failure) =>
						new StoreError({
							operation: "setup",
							cause: failure._tag === "sql" ? failure.cause : new Error(failure.message),
						}),
				),
			);
		}
		yield* runPending(sql, LEDGER_TABLE, options.migrations, mirror, history).pipe(
			Effect.mapError(materialize("migrate")),
		);

		const migrate = runPending(sql, LEDGER_TABLE, options.migrations, mirror, history).pipe(
			Effect.mapError(materialize("migrate")),
			Effect.withSpan("Store.migrate"),
		);

		const rollback = Effect.fn("Store.rollback")(function* (toId: number) {
			if (!Number.isInteger(toId) || toId < 0) {
				return yield* Effect.die(new Error(`Store.rollback: toId must be a non-negative integer, received ${toId}`));
			}
			return yield* rollbackTo(sql, LEDGER_TABLE, options.migrations, toId, mirror, history).pipe(
				Effect.mapError(materialize("rollback")),
			);
		});

		// `statusOf` runs no user migration, so its only failure is the ledger's.
		const status = statusOf(sql, LEDGER_TABLE, options.migrations).pipe(
			Effect.mapError((failure) => new StoreError({ operation: "status", cause: failureCause(failure) })),
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
 * import { Store } from "@effected/store";
 * import type { StoreMigration } from "@effected/store";
 * import { Effect } from "effect";
 *
 * const migrations: ReadonlyArray<StoreMigration> = [
 * 	{ id: 1, name: "create-notes", up: (sql) => sql`CREATE TABLE notes (body TEXT)` },
 * ];
 * const StoreLive = Store.layerSqlite({ filename: "state.db", migrations });
 *
 * const program = Effect.gen(function* () {
 * 	const store = yield* Store;
 * 	yield* store.client`INSERT INTO notes (body) VALUES (${"hello"})`;
 * }).pipe(Effect.provide(StoreLive));
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

	/**
	 * The batteries-included layer: a `Store` over a SQLite database file via
	 * `@effect/sql-sqlite-node`.
	 *
	 * @remarks
	 * Fails on the layer's error channel with `StoreError` or
	 * `StoreMigrationError` if setup or a pending migration fails.
	 */
	static layerSqlite(options: StoreSqliteOptions): Layer.Layer<Store, StoreError | StoreMigrationError> {
		// `filename` last: the layer owns it, whatever the passthrough says. The
		// name transforms are stripped at runtime too — the `Omit` on `client`
		// binds only TypeScript callers, and a leaked transform rewrites the
		// migration ledger's result names, silently breaking `status`.
		const {
			filename: _filename,
			transformResultNames: _transformResultNames,
			transformQueryNames: _transformQueryNames,
			...passthrough
		} = (options.client ?? {}) as Partial<SqliteClient.SqliteClientConfig>;
		const client = SqliteClient.layer({ ...passthrough, filename: options.filename });
		const connected = withOnConnect(
			client,
			options.onConnect,
			(cause) => new StoreError({ operation: "setup", cause }),
		);
		const store = Layer.provide(Store.layer(options), connected);
		return options.checkpointOnClose === true
			? Layer.merge(store, Layer.provide(walCheckpointOnClose(), client))
			: store;
	}

	/**
	 * {@link Store.layerSqlite} provided under a service key the consumer
	 * defines, for an application that keeps more than one database.
	 *
	 * @remarks
	 * `tag` is a `Context.Service` whose service type is {@link StoreShape},
	 * declared as in the example below. A key whose shape is incompatible is a
	 * compile error, and so is one that adds members (`StoreShape & { … }`),
	 * reported as an argument "not assignable to parameter of type 'never'"
	 * because this layer could not supply them. The check cannot see through
	 * method-syntax parameter bivariance: a shape that redeclares a member as a
	 * method with a wider parameter (`rollback(toId: number | string)`) still
	 * compiles. The output is
	 * `I` alone: the `Store` built internally is provided to the re-tagging
	 * step and never leaks, so a keyed layer composes beside a primary `Store`
	 * without either shadowing the other. Each file keeps its own migrations
	 * and its own ledger.
	 *
	 * A layer-returning function, like every factory here: bind the result to
	 * a `const` once and reuse that binding.
	 *
	 * @example
	 * ```ts
	 * import { Store } from "@effected/store";
	 * import type { StoreShape } from "@effected/store";
	 * import { Context } from "effect";
	 *
	 * class RegistryStore extends Context.Service<RegistryStore, StoreShape>()("myapp/RegistryStore") {}
	 *
	 * const RegistryStoreLive = Store.layerSqliteAs(RegistryStore, { filename: "/abs/registry.db", migrations: [] });
	 * ```
	 */
	static layerSqliteAs<I, S extends StoreShape>(
		tag: Context.Key<I, S> & ([StoreShape] extends [S] ? unknown : never),
		options: StoreSqliteOptions,
	): Layer.Layer<I, StoreError | StoreMigrationError> {
		// The constraint rejects keys whose shape adds members or is incompatible with StoreShape, so the key
		// is read at StoreShape. It cannot see through method-syntax parameter bivariance: a member redeclared
		// as a method with a wider parameter still passes.
		return Layer.effect(tag as Context.Key<I, StoreShape>, Store).pipe(Layer.provide(Store.layerSqlite(options)));
	}

	/**
	 * Provide the bare `SqlClient` from a keyed store's `client`, for layers
	 * written against `SqlClient` rather than a `Store` key.
	 *
	 * @remarks
	 * A keyed store (see {@link Store.layerSqliteAs}) provides only its own
	 * key, so code that queries through the ambient `SqlClient` needs it
	 * bridged. Provide the result to those layers alone with `Layer.provide`:
	 * merged into a context that also holds a second database, one `SqlClient`
	 * would shadow the other. A layer-returning function: bind it once.
	 *
	 * @example
	 * ```ts
	 * import { Store } from "@effected/store";
	 * import type { StoreShape } from "@effected/store";
	 * import { Context, Layer } from "effect";
	 *
	 * class SessionStore extends Context.Service<SessionStore, StoreShape>()("myapp/SessionStore") {}
	 *
	 * const SessionSql = Store.sqlClient(SessionStore);
	 * // SessionRepoLive: Layer<SessionRepo, never, SqlClient>
	 * // const SessionRepo = SessionRepoLive.pipe(Layer.provide(SessionSql), Layer.provide(SessionStoreLive));
	 * ```
	 */
	static sqlClient<I>(tag: Context.Key<I, StoreShape>): Layer.Layer<SqlClient.SqlClient, never, I> {
		return Layer.effect(
			SqlClient.SqlClient,
			Effect.map(tag, (store) => store.client),
		);
	}

	/** An in-memory (`:memory:`) `Store` layer for tests; each build is a fresh, empty database. */
	static layerTest(options: StoreOptions): Layer.Layer<Store, StoreError | StoreMigrationError> {
		return Store.layerSqlite({ ...options, filename: ":memory:" });
	}
}

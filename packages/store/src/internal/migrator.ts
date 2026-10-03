import { DateTime, Effect } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

// The migration-ledger engine shared by `Store` (user migrations over
// `_store_migrations`) and `Cache` (its fixed schema over `_cache_migrations`).
//
// The engine is deliberately facade-free: it works over raw records and fails
// with raw `MigratorFailure` values; `Store.ts` and `Cache.ts` materialize the
// public error classes. It never imports a facade module.

/** A single migration as the engine sees it; callback values are discarded. */
export interface MigratorMigration {
	readonly id: number;
	readonly name: string;
	readonly up: (sql: SqlClient) => Effect.Effect<unknown, SqlError>;
	readonly down?: (sql: SqlClient) => Effect.Effect<unknown, SqlError>;
}

/** An applied or rolled-back migration reference. */
export interface MigratorRecord {
	readonly id: number;
	readonly name: string;
}

/** What a run changed. */
export interface MigratorResult {
	readonly applied: ReadonlyArray<MigratorRecord>;
	readonly rolledBack: ReadonlyArray<MigratorRecord>;
}

/** Raw status row: `appliedAt` is the ledger's ISO-8601 text, absent = pending. */
export interface MigratorStatusRecord {
	readonly id: number;
	readonly name: string;
	readonly appliedAt?: string;
}

/**
 * Raw failure records. `ledger` covers the engine's own SQL (ledger table
 * bookkeeping and the queries around a migration); `migration` covers a
 * user-supplied `up`/`down` failing with a typed `SqlError`. A migration
 * callback that throws is a programmer bug and stays a defect — the engine
 * never catches defects.
 */
export type MigratorFailure =
	| { readonly _tag: "ledger"; readonly cause: SqlError }
	| { readonly _tag: "refused"; readonly message: string }
	| {
			readonly _tag: "migration";
			readonly direction: "up" | "down";
			readonly id: number;
			readonly name: string;
			readonly cause: SqlError;
	  };

const ledgerFailure = (cause: SqlError): MigratorFailure => ({ _tag: "ledger", cause });

/** The structural cause of a failure: the `SqlError`, or an `Error` carrying a refusal's message. */
export const failureCause = (failure: MigratorFailure): unknown =>
	failure._tag === "refused" ? new Error(failure.message) : failure.cause;

const migrationFailure = (direction: "up" | "down", migration: MigratorRecord, cause: SqlError): MigratorFailure => ({
	_tag: "migration",
	direction,
	id: migration.id,
	name: migration.name,
	cause,
});

/**
 * Validate a migration list as developer wiring: every id must be a positive
 * integer (the `Number.isInteger` guard rejects `NaN` and fractions, which a
 * bare `< 1` comparison would silently admit) and ids must be unique. Returns
 * a description of the first problem, or `undefined` when the list is sound.
 * The facade turns a problem into a construction defect.
 */
export const validateMigrations = (migrations: ReadonlyArray<MigratorMigration>): string | undefined => {
	const seen = new Set<number>();
	for (const migration of migrations) {
		if (!Number.isInteger(migration.id) || migration.id < 1) {
			return `migration ids must be positive integers, received ${migration.id} for "${migration.name}"`;
		}
		if (seen.has(migration.id)) {
			return `duplicate migration id ${migration.id} ("${migration.name}")`;
		}
		seen.add(migration.id);
	}
	return undefined;
};

/** Create the ledger table when absent. */
export const ensureLedger = (sql: SqlClient, table: string): Effect.Effect<void, MigratorFailure> =>
	sql`
		CREATE TABLE IF NOT EXISTS ${sql(table)} (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT NOT NULL
		)
	`.pipe(Effect.mapError(ledgerFailure), Effect.asVoid);

/**
 * Where `Store` keeps its rollback history, and which foreign ledgers a
 * rollback snapshots. A tombstone (`rollback:<id>` in `meta`) is written on
 * EVERY rollback, whatever the options: it records, per foreign table, the
 * `created_at` of that id's row as the rollback left it (`null` = no row).
 * A later import compares the foreign row against that snapshot — the same
 * value means the row is stale (Store unwound it; re-run it), a different or
 * newly present row means an older program re-applied it (import it), and a
 * table with no snapshot cannot be told apart (refuse). No clock comparison:
 * `created_at` has one-second resolution, and apply-then-rollback routinely
 * lands inside one second.
 */
export interface RollbackHistory {
	readonly meta: string;
	readonly foreignTables: ReadonlyArray<string>;
}

interface Tombstone {
	readonly at: string;
	readonly snapshots: Readonly<Record<string, string | null>>;
}

const tombstoneKey = (id: number): string => `rollback:${id}`;

/** Whether `name` is a table, on SQLite; elsewhere history is not kept, so `false`. */
const tableExists = (sql: SqlClient, name: string): Effect.Effect<boolean, SqlError> =>
	sql.onDialectOrElse({
		sqlite: () =>
			Effect.map(
				sql<{ n: number }>`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
				(rows) => Number(rows[0]?.n ?? 0) > 0,
			),
		orElse: () => Effect.succeed(false),
	});

/** Every tombstone in `meta`, by id; empty when the table does not exist. */
const readTombstones = (sql: SqlClient, meta: string): Effect.Effect<Map<number, Tombstone>, SqlError> =>
	Effect.gen(function* () {
		if (!(yield* tableExists(sql, meta))) return new Map<number, Tombstone>();
		const rows = yield* sql<{ key: string; value: string }>`
			SELECT key, value FROM ${sql(meta)} WHERE key LIKE 'rollback:%'
		`;
		return new Map(rows.map((row) => [Number(row.key.slice("rollback:".length)), JSON.parse(row.value) as Tombstone]));
	});

/** Drop an id's tombstone: it has been applied (or legitimately imported) again. */
const clearTombstone = (sql: SqlClient, meta: string, id: number): Effect.Effect<void, SqlError> =>
	Effect.gen(function* () {
		if (yield* tableExists(sql, meta)) {
			yield* sql`DELETE FROM ${sql(meta)} WHERE key = ${tombstoneKey(id)}`;
		}
	});

/**
 * Judge a foreign row for an id `table` lacks, against its tombstone.
 * `"import"`: an older program applied it (and, with a tombstone, re-applied
 * it after Store's rollback). `"stale"`: the row predates Store's rollback of
 * it — the id is pending and runs again. A string: refused, with the reason.
 */
const judgeForeign = (
	foreignTable: string,
	row: ForeignRow,
	tombstone: Tombstone | undefined,
): "import" | "stale" | { readonly refused: string } => {
	if (tombstone === undefined) return "import";
	const id = Number(row.migration_id);
	if (!(foreignTable in tombstone.snapshots)) {
		return {
			refused: `${foreignTable} records migration ${id}, which Store rolled back while not tracking ${foreignTable}; whether it was re-applied since cannot be told`,
		};
	}
	const snapshot = tombstone.snapshots[foreignTable];
	return snapshot !== null && snapshot === String(row.created_at) ? "stale" : "import";
};

/**
 * Apply every pending migration in ascending id order. Each migration's `up`
 * and its ledger insert commit atomically: a failing migration leaves prior
 * migrations applied and itself unrecorded.
 *
 * The plan is read outside any transaction, so another connection — another
 * process opening the same file — may apply a planned migration first. Each
 * migration's transaction therefore re-checks the ledger before running `up`,
 * and skips an id that is already recorded. On SQLite the transaction is
 * `BEGIN IMMEDIATE` (the driver's choice for a writable connection), which takes
 * the write lock before that check, so check-then-apply is serialized across
 * processes and no `up` runs twice.
 */
export const runPending = (
	sql: SqlClient,
	table: string,
	migrations: ReadonlyArray<MigratorMigration>,
	mirror?: string,
	history?: RollbackHistory,
): Effect.Effect<MigratorResult, MigratorFailure> =>
	Effect.gen(function* () {
		const rows = yield* sql<{ id: number }>`SELECT id FROM ${sql(table)} ORDER BY id ASC`.pipe(
			Effect.mapError(ledgerFailure),
		);
		const appliedIds = new Set(rows.map((row) => row.id));
		const pending = migrations.filter((migration) => !appliedIds.has(migration.id)).sort((a, b) => a.id - b.id);
		const result = yield* applyPending(sql, table, pending, mirror, history);

		// The completion record effect/sql's Migrator emits, with the same
		// message and annotation keys, so a consumer moving over loses nothing.
		const latest = yield* sql<{ id: number; name: string }>`
			SELECT id, name FROM ${sql(table)} ORDER BY id DESC LIMIT 1
		`.pipe(Effect.mapError(ledgerFailure));
		const top = latest[0];
		yield* top === undefined
			? Effect.logDebug("Migrations complete")
			: Effect.logDebug("Migrations complete").pipe(
					Effect.annotateLogs("latest_migration_id", String(top.id)),
					Effect.annotateLogs("latest_migration_name", top.name),
				);
		return result;
	});

/**
 * Apply a planned list of migrations, in the order given, each in its own
 * transaction that re-checks the ledger first. `pending` may be stale — that is
 * the case this exists for — so an id already recorded is skipped, not re-run.
 */
export const applyPending = (
	sql: SqlClient,
	table: string,
	pending: ReadonlyArray<MigratorMigration>,
	mirror?: string,
	history?: RollbackHistory,
): Effect.Effect<MigratorResult, MigratorFailure> =>
	Effect.gen(function* () {
		const applied: Array<MigratorRecord> = [];
		for (const migration of pending) {
			const ran = yield* sql
				.withTransaction(
					Effect.gen(function* () {
						const recorded = yield* sql<{ id: number }>`
							SELECT id FROM ${sql(table)} WHERE id = ${migration.id}
						`.pipe(Effect.mapError(ledgerFailure));
						if (recorded.length > 0) return false;
						if (mirror !== undefined) {
							// Under the same write lock: an older program migrating through
							// effect/sql's Migrator may have applied this id since our plan was
							// read. Its row in the mirror means applied — import it, never re-run.
							const foreign = yield* sql<ForeignRow>`
								SELECT migration_id, name, created_at FROM ${sql(mirror)} WHERE migration_id = ${migration.id}
							`.withoutTransform.pipe(Effect.mapError(ledgerFailure));
							const row = foreign[0];
							const tombstones =
								row === undefined || history === undefined
									? new Map<number, Tombstone>()
									: yield* readTombstones(sql, history.meta).pipe(Effect.mapError(ledgerFailure));
							const verdict = row === undefined ? "stale" : judgeForeign(mirror, row, tombstones.get(migration.id));
							if (typeof verdict === "object") {
								return yield* Effect.fail<MigratorFailure>({ _tag: "refused", message: verdict.refused });
							}
							// A stale row (Store rolled this id back since it was written) is not
							// history: fall through and run the migration again.
							if (row !== undefined && verdict === "import") {
								const imported = importable(mirror, row, migration);
								if (typeof imported === "string") {
									return yield* Effect.fail<MigratorFailure>({ _tag: "refused", message: imported });
								}
								yield* sql`
									INSERT INTO ${sql(table)} (id, name, applied_at)
									VALUES (${migration.id}, ${migration.name}, ${imported.appliedAt})
								`.pipe(Effect.mapError(ledgerFailure));
								if (history !== undefined) {
									yield* clearTombstone(sql, history.meta, migration.id).pipe(Effect.mapError(ledgerFailure));
								}
								yield* Effect.logDebug("Imported migration").pipe(
									Effect.annotateLogs("migration_id", String(migration.id)),
									Effect.annotateLogs("migration_name", migration.name),
								);
								return false;
							}
						}
						// effect/sql's Migrator record, message and annotation keys alike.
						yield* Effect.logDebug("Running migration").pipe(
							Effect.annotateLogs("migration_id", String(migration.id)),
							Effect.annotateLogs("migration_name", migration.name),
						);
						yield* migration.up(sql).pipe(Effect.mapError((cause) => migrationFailure("up", migration, cause)));
						const appliedAt = DateTime.formatIso(yield* DateTime.now);
						yield* sql`
						INSERT INTO ${sql(table)} (id, name, applied_at)
						VALUES (${migration.id}, ${migration.name}, ${appliedAt})
					`.pipe(Effect.mapError(ledgerFailure));
						if (history !== undefined) {
							// Applied again: its rollback is no longer the latest word on it.
							yield* clearTombstone(sql, history.meta, migration.id).pipe(Effect.mapError(ledgerFailure));
						}
						if (mirror !== undefined) {
							// Same transaction: the mirrored row exists exactly when ours does.
							yield* sql`
								INSERT OR IGNORE INTO ${sql(mirror)} (migration_id, name)
								VALUES (${migration.id}, ${migration.name})
							`.pipe(Effect.mapError(ledgerFailure));
						}
						return true;
					}),
				)
				.pipe(Effect.mapError((failure) => (isMigratorFailure(failure) ? failure : ledgerFailure(failure))));
			if (ran) applied.push({ id: migration.id, name: migration.name });
		}

		return { applied, rolledBack: [] };
	});

/**
 * Roll back applied migrations with `id > toId`, newest first. A migration
 * without a `down` is skipped over — its ledger row is still removed. Each `down` and its ledger
 * delete commit atomically.
 */
export const rollbackTo = (
	sql: SqlClient,
	table: string,
	migrations: ReadonlyArray<MigratorMigration>,
	toId: number,
	mirror?: string,
	history?: RollbackHistory,
): Effect.Effect<MigratorResult, MigratorFailure> =>
	Effect.gen(function* () {
		const rows = yield* sql<{ id: number; name: string }>`
			SELECT id, name FROM ${sql(table)}
			WHERE id > ${toId}
			ORDER BY id DESC
		`.pipe(Effect.mapError(ledgerFailure));
		const migrationsById = new Map(migrations.map((migration) => [migration.id, migration]));

		const rolledBack: Array<MigratorRecord> = [];
		for (const row of rows) {
			const migration = migrationsById.get(row.id);
			yield* sql
				.withTransaction(
					Effect.gen(function* () {
						if (migration?.down !== undefined) {
							yield* migration.down(sql).pipe(Effect.mapError((cause) => migrationFailure("down", migration, cause)));
						}
						yield* sql`DELETE FROM ${sql(table)} WHERE id = ${row.id}`.pipe(Effect.mapError(ledgerFailure));
						if (mirror !== undefined) {
							yield* sql`DELETE FROM ${sql(mirror)} WHERE migration_id = ${row.id}`.pipe(
								Effect.mapError(ledgerFailure),
							);
						}
						if (history !== undefined) {
							yield* recordTombstone(sql, history, row.id).pipe(Effect.mapError(ledgerFailure));
						}
					}),
				)
				.pipe(Effect.mapError((failure) => (isMigratorFailure(failure) ? failure : ledgerFailure(failure))));
			rolledBack.push({ id: row.id, name: row.name });
		}

		return { applied: [], rolledBack };
	});

/**
 * Write `id`'s tombstone: the rollback time, and per tracked foreign table the
 * `created_at` of that id's row as this rollback leaves it (`null` = none).
 * SQLite only — the only dialect adoption and mirroring run on.
 */
const recordTombstone = (sql: SqlClient, history: RollbackHistory, id: number): Effect.Effect<void, SqlError> =>
	sql.onDialectOrElse({
		sqlite: () =>
			Effect.gen(function* () {
				const snapshots: Record<string, string | null> = {};
				for (const foreignTable of history.foreignTables) {
					if (!(yield* tableExists(sql, foreignTable))) {
						snapshots[foreignTable] = null;
						continue;
					}
					const rows = yield* sql<{ created_at: unknown }>`
						SELECT created_at FROM ${sql(foreignTable)} WHERE migration_id = ${id}
					`.withoutTransform;
					snapshots[foreignTable] = rows[0] === undefined ? null : String(rows[0].created_at);
				}
				const at = DateTime.formatIso(yield* DateTime.now);
				yield* sql`
					CREATE TABLE IF NOT EXISTS ${sql(history.meta)} (
						key TEXT PRIMARY KEY,
						value TEXT NOT NULL
					)
				`;
				yield* sql`
					INSERT OR REPLACE INTO ${sql(history.meta)} (key, value)
					VALUES (${tombstoneKey(id)}, ${JSON.stringify({ at, snapshots } satisfies Tombstone)})
				`;
			}),
		orElse: () => Effect.void,
	});

/**
 * Create effect/sql's Migrator ledger with its exact SQLite DDL when absent,
 * then copy in every row of `table` it lacks, in one transaction. Run at each
 * layer build with mirroring on, so a database whose own ledger predates the
 * option is brought level before any later apply or rollback mirrors itself.
 * `created_at` is the row's own `applied_at`, rendered in SQLite's
 * `current_timestamp` form. SQLite only.
 */
export const syncMirror = (
	sql: SqlClient,
	table: string,
	mirror: string,
	migrations: ReadonlyArray<MigratorMigration>,
	history?: RollbackHistory,
): Effect.Effect<number, AdoptFailure> =>
	sql
		.onDialectOrElse({
			sqlite: (): Effect.Effect<number, AdoptFailure | SqlError> =>
				sql.withTransaction(
					Effect.gen(function* () {
						// effect/sql Migrator.ts, the SQLite branch of ensureMigrationsTable.
						yield* sql`
							CREATE TABLE IF NOT EXISTS ${sql(mirror)} (
								migration_id integer PRIMARY KEY NOT NULL,
								created_at datetime NOT NULL DEFAULT current_timestamp,
								name VARCHAR(255) NOT NULL
							)
						`;
						// Import first: rows an older program recorded that ours lacks. Each
						// must match a known migration by id AND name, exactly as adoption
						// requires, or the sync is refused rather than guessed at.
						const ownRows = yield* sql<{ id: number }>`SELECT id FROM ${sql(table)}`;
						const own = new Set(ownRows.map((row) => Number(row.id)));
						const foreignRows = yield* sql<ForeignRow>`
							SELECT migration_id, name, created_at FROM ${sql(mirror)} ORDER BY migration_id ASC
						`.withoutTransform;
						const byId = new Map(migrations.map((migration) => [migration.id, migration]));
						const foreignIds = new Set(foreignRows.map((row) => Number(row.migration_id)));
						const toImport: Array<{ readonly id: number; readonly name: string; readonly appliedAt: string }> = [];
						const tombstones =
							history === undefined ? new Map<number, Tombstone>() : yield* readTombstones(sql, history.meta);
						for (const row of foreignRows) {
							const id = Number(row.migration_id);
							if (own.has(id)) continue;
							const verdict = judgeForeign(mirror, row, tombstones.get(id));
							if (typeof verdict === "object") {
								return yield* Effect.fail<AdoptFailure>({ _tag: "refused", message: verdict.refused });
							}
							// Store rolled this id back after the row was written: not history.
							// It stays pending and runs again.
							if (verdict === "stale") continue;
							const migration = byId.get(id);
							if (migration === undefined) {
								return yield* Effect.fail<AdoptFailure>({
									_tag: "refused",
									message: `${mirror} records migration ${id} "${row.name}", which has no migration with that id`,
								});
							}
							const imported = importable(mirror, row, migration);
							if (typeof imported === "string") {
								return yield* Effect.fail<AdoptFailure>({ _tag: "refused", message: imported });
							}
							toImport.push({ id, name: migration.name, appliedAt: imported.appliedAt });
						}
						if (toImport.length > 0) {
							// The adoption gap rule, on what is imported: effect/sql never runs an
							// id at or below its latest, so a known migration below the imported
							// high-water mark that neither ledger records was never applied.
							const highWater = Math.max(...toImport.map((row) => row.id));
							const skipped = migrations.find(
								(migration) => migration.id <= highWater && !own.has(migration.id) && !foreignIds.has(migration.id),
							);
							if (skipped !== undefined) {
								return yield* Effect.fail<AdoptFailure>({
									_tag: "refused",
									message: `migration ${skipped.id} "${skipped.name}" is at or below ${mirror}'s imported id ${highWater} but was never recorded there`,
								});
							}
							for (const row of toImport) {
								yield* sql`
									INSERT INTO ${sql(table)} (id, name, applied_at)
									VALUES (${row.id}, ${row.name}, ${row.appliedAt})
								`;
								if (history !== undefined) yield* clearTombstone(sql, history.meta, row.id);
							}
							yield* Effect.logDebug("Imported migrator ledger rows").pipe(
								Effect.annotateLogs("migrator_table", mirror),
								Effect.annotateLogs("imported_count", String(toImport.length)),
							);
						}

						// Then export: rows ours has that the mirror lacks.
						const before = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql(mirror)}`;
						yield* sql`
							INSERT OR IGNORE INTO ${sql(mirror)} (migration_id, name, created_at)
							SELECT id, name, strftime('%Y-%m-%d %H:%M:%S', applied_at) FROM ${sql(table)}
						`;
						const after = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql(mirror)}`;
						return Number(after[0]?.n ?? 0) - Number(before[0]?.n ?? 0);
					}),
				),
			orElse: (): Effect.Effect<number, AdoptFailure | SqlError> =>
				Effect.fail({
					_tag: "refused",
					message: "mirroring is supported on SQLite only; this client's dialect is not SQLite",
				}),
		})
		.pipe(
			Effect.mapError((failure) =>
				"_tag" in failure && failure._tag === "refused"
					? failure
					: { _tag: "sql" as const, cause: failure as SqlError },
			),
		);

/** Project the full migration list against the ledger. */
export const statusOf = (
	sql: SqlClient,
	table: string,
	migrations: ReadonlyArray<MigratorMigration>,
): Effect.Effect<ReadonlyArray<MigratorStatusRecord>, MigratorFailure> =>
	Effect.gen(function* () {
		const rows = yield* sql<{ id: number; name: string; applied_at: string }>`
			SELECT id, name, applied_at FROM ${sql(table)} ORDER BY id ASC
		`.pipe(Effect.mapError(ledgerFailure));
		const appliedAt = new Map(rows.map((row) => [row.id, row.applied_at]));
		return [...migrations]
			.sort((a, b) => a.id - b.id)
			.map((migration): MigratorStatusRecord => {
				const at = appliedAt.get(migration.id);
				return {
					id: migration.id,
					name: migration.name,
					...(at !== undefined ? { appliedAt: at } : {}),
				};
			});
	});

const isMigratorFailure = (value: MigratorFailure | SqlError): value is MigratorFailure =>
	"_tag" in value && (value._tag === "ledger" || value._tag === "migration" || value._tag === "refused");

/**
 * A raw adoption failure: the adoption step's own SQL failed, or adoption was
 * refused — a foreign ledger that disagrees with the migration list, an
 * unreadable timestamp, or a dialect it does not support. The facade
 * materializes both.
 */
export type AdoptFailure =
	| { readonly _tag: "sql"; readonly cause: SqlError }
	| { readonly _tag: "refused"; readonly message: string };

/** The shape of one row of effect/sql's Migrator ledger. */
interface ForeignRow {
	readonly migration_id: number | bigint;
	readonly name: string;
	readonly created_at: unknown;
}

/** The persisted marker key recording that the adoption decision was made. */
const ADOPTION_MARKER = "adoptMigratorLedger";

/**
 * Normalize a foreign `created_at` to ISO-8601, or `undefined` when it cannot
 * be read. SQLite's `current_timestamp` is `YYYY-MM-DD HH:MM:SS` in UTC with no
 * zone marker, and a generic parser reads a zone-less date-time as LOCAL time,
 * so both zone-less spellings (space or `T`) are read as UTC explicitly.
 */
const adoptedAt = (value: unknown): string | undefined => {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
	if (typeof value !== "string") return undefined;
	const zoneless = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(value);
	const candidate = zoneless !== null ? `${zoneless[1]}T${zoneless[2]}Z` : value;
	const parsed = new Date(candidate);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

/**
 * Validate one foreign ledger row against the migration with its id, as
 * adoption does: the names must match and `created_at` must be readable.
 * Returns the row's ISO `appliedAt`, or the refusal message.
 */
const importable = (
	foreignTable: string,
	row: ForeignRow,
	migration: MigratorMigration,
): { readonly appliedAt: string } | string => {
	const id = Number(row.migration_id);
	if (migration.name !== row.name) {
		return `${foreignTable} records migration ${id} as "${row.name}", but migration ${id} is named "${migration.name}"`;
	}
	const appliedAt = adoptedAt(row.created_at);
	return appliedAt === undefined
		? `${foreignTable} records migration ${id} with an unreadable created_at ${JSON.stringify(row.created_at)}`
		: { appliedAt };
};

/**
 * Decide, once per database, whether to seed `table` from a foreign effect/sql
 * Migrator ledger — and record that the decision was made.
 *
 * One transaction (`BEGIN IMMEDIATE` on SQLite, so concurrent openers
 * serialize): when `metaTable` already holds the {@link ADOPTION_MARKER}, do
 * nothing. Otherwise, when `table` is empty and `foreignTable` exists, copy
 * the foreign rows in after validating them; in every case write the marker in
 * the same transaction. The marker is what makes adoption one-shot: a later
 * `rollback(0)` empties `table` but leaves the marker, so a reopen re-applies
 * migrations from scratch instead of re-adopting history that was unwound.
 * The foreign table is read, never written.
 *
 * Every foreign row must match a migration by id AND name, and every migration
 * at or below the foreign high-water mark must have a foreign row — effect/sql
 * never runs an id at or below its latest, so applying one here would diverge
 * from the history the database actually has. SQLite only: any other dialect
 * is refused rather than probed with untested SQL.
 */
export const adoptForeignLedger = (
	sql: SqlClient,
	table: string,
	metaTable: string,
	foreignTable: string,
	migrations: ReadonlyArray<MigratorMigration>,
): Effect.Effect<ReadonlyArray<MigratorRecord>, AdoptFailure> => {
	const refused = (message: string): AdoptFailure => ({ _tag: "refused", message });

	const adopt = Effect.gen(function* () {
		yield* sql`
			CREATE TABLE IF NOT EXISTS ${sql(metaTable)} (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)
		`;
		const marker = yield* sql<{ key: string }>`SELECT key FROM ${sql(metaTable)} WHERE key = ${ADOPTION_MARKER}`;
		if (marker.length > 0) return [];

		const now = DateTime.formatIso(yield* DateTime.now);
		const writeMarker = (adopted: number) =>
			sql`
				INSERT INTO ${sql(metaTable)} (key, value)
				VALUES (${ADOPTION_MARKER}, ${JSON.stringify({ table: foreignTable, adopted, at: now })})
			`;

		const own = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql(table)}`;
		const foreign = yield* sql<{ n: number }>`
			SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ${foreignTable}
		`;
		if (Number(own[0]?.n ?? 0) > 0 || Number(foreign[0]?.n ?? 0) === 0) {
			yield* writeMarker(0);
			return [];
		}

		const rows = yield* sql<ForeignRow>`
			SELECT migration_id, name, created_at FROM ${sql(foreignTable)} ORDER BY migration_id ASC
		`.withoutTransform;

		const byId = new Map(migrations.map((migration) => [migration.id, migration]));
		const foreignIds = new Set<number>();
		const seeded: Array<{ readonly id: number; readonly name: string; readonly appliedAt: string }> = [];
		// Rollback history: a Store that ran WITHOUT adoption may have rolled an id
		// back since the foreign row was written. The same verdict as the mirror's
		// import decides each row — stale is not adopted (the id stays pending and
		// runs again), changed or new is adopted, untracked is refused.
		const tombstones = yield* readTombstones(sql, metaTable);
		for (const row of rows) {
			const id = Number(row.migration_id);
			foreignIds.add(id);
			const migration = byId.get(id);
			if (migration === undefined) {
				return yield* Effect.fail(
					refused(`${foreignTable} records migration ${id} "${row.name}", which has no migration with that id`),
				);
			}
			if (migration.name !== row.name) {
				return yield* Effect.fail(
					refused(
						`${foreignTable} records migration ${id} as "${row.name}", but migration ${id} is named "${migration.name}"`,
					),
				);
			}
			const appliedAt = adoptedAt(row.created_at);
			if (appliedAt === undefined) {
				return yield* Effect.fail(
					refused(
						`${foreignTable} records migration ${id} with an unreadable created_at ${JSON.stringify(row.created_at)}`,
					),
				);
			}
			const verdict = judgeForeign(foreignTable, row, tombstones.get(id));
			if (typeof verdict === "object") return yield* Effect.fail(refused(verdict.refused));
			if (verdict === "stale") continue;
			seeded.push({ id, name: row.name, appliedAt });
		}
		// The gap rule covers what is actually adopted, as the mirror's import
		// does: a stale row is not adopted and its migration re-runs, so it must
		// not be the high-water mark that makes an untouched id look skipped.
		if (seeded.length > 0) {
			const highWater = Math.max(...seeded.map((row) => row.id));
			const skipped = migrations.find((migration) => migration.id <= highWater && !foreignIds.has(migration.id));
			if (skipped !== undefined) {
				return yield* Effect.fail(
					refused(
						`migration ${skipped.id} "${skipped.name}" is at or below ${foreignTable}'s latest id ${highWater} but was never recorded there`,
					),
				);
			}
		}

		for (const row of seeded) {
			yield* clearTombstone(sql, metaTable, row.id);
			yield* sql`
				INSERT INTO ${sql(table)} (id, name, applied_at)
				VALUES (${row.id}, ${row.name}, ${row.appliedAt})
			`;
		}
		yield* writeMarker(seeded.length);
		return seeded.map(({ id, name }) => ({ id, name }));
	});

	return sql
		.onDialectOrElse({
			sqlite: () => sql.withTransaction(adopt),
			orElse: () =>
				Effect.fail(
					refused(`adoption is supported on SQLite only; this client's dialect is not SQLite`) as
						| AdoptFailure
						| SqlError,
				),
		})
		.pipe(
			Effect.mapError((failure) =>
				"_tag" in failure && failure._tag === "refused"
					? failure
					: { _tag: "sql" as const, cause: failure as SqlError },
			),
		);
};

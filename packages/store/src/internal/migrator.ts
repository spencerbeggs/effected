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
	| {
			readonly _tag: "migration";
			readonly direction: "up" | "down";
			readonly id: number;
			readonly name: string;
			readonly cause: SqlError;
	  };

const ledgerFailure = (cause: SqlError): MigratorFailure => ({ _tag: "ledger", cause });

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
 * Apply every pending migration in ascending id order. Each migration's `up`
 * and its ledger insert commit atomically: a failing migration leaves prior
 * migrations applied and itself unrecorded.
 */
export const runPending = (
	sql: SqlClient,
	table: string,
	migrations: ReadonlyArray<MigratorMigration>,
): Effect.Effect<MigratorResult, MigratorFailure> =>
	Effect.gen(function* () {
		const rows = yield* sql<{ id: number }>`SELECT id FROM ${sql(table)} ORDER BY id ASC`.pipe(
			Effect.mapError(ledgerFailure),
		);
		const appliedIds = new Set(rows.map((row) => row.id));
		const pending = migrations.filter((migration) => !appliedIds.has(migration.id)).sort((a, b) => a.id - b.id);

		const applied: Array<MigratorRecord> = [];
		for (const migration of pending) {
			yield* sql
				.withTransaction(
					Effect.gen(function* () {
						yield* migration.up(sql).pipe(Effect.mapError((cause) => migrationFailure("up", migration, cause)));
						const appliedAt = DateTime.formatIso(yield* DateTime.now);
						yield* sql`
						INSERT INTO ${sql(table)} (id, name, applied_at)
						VALUES (${migration.id}, ${migration.name}, ${appliedAt})
					`.pipe(Effect.mapError(ledgerFailure));
					}),
				)
				.pipe(Effect.mapError((failure) => (isMigratorFailure(failure) ? failure : ledgerFailure(failure))));
			applied.push({ id: migration.id, name: migration.name });
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
					}),
				)
				.pipe(Effect.mapError((failure) => (isMigratorFailure(failure) ? failure : ledgerFailure(failure))));
			rolledBack.push({ id: row.id, name: row.name });
		}

		return { applied: [], rolledBack };
	});

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
	"_tag" in value && (value._tag === "ledger" || value._tag === "migration");

/**
 * A raw adoption failure: the foreign ledger disagrees with the migration
 * list, or the adoption step's own SQL failed. The facade materializes both.
 */
export type AdoptFailure =
	| { readonly _tag: "sql"; readonly cause: SqlError }
	| { readonly _tag: "mismatch"; readonly message: string };

/** The shape of one row of effect/sql's Migrator ledger, every dialect. */
interface ForeignRow {
	readonly migration_id: number | bigint;
	readonly name: string;
	readonly created_at: unknown;
}

/**
 * Normalize a foreign `created_at` to ISO-8601. SQLite's `current_timestamp`
 * is `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker, which a generic date
 * parser would read as local time; anything unparseable falls back to `now`.
 */
const adoptedAt = (value: unknown, now: string): string => {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? now : value.toISOString();
	if (typeof value === "string") {
		const sqlite = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(value);
		const candidate = sqlite !== null ? `${sqlite[1]}T${sqlite[2]}Z` : value;
		const parsed = new Date(candidate);
		return Number.isNaN(parsed.getTime()) ? now : parsed.toISOString();
	}
	return now;
};

/**
 * Seed `table` from a foreign effect/sql Migrator ledger, once. Runs in one
 * transaction, and only when `table` is empty and `foreignTable` exists; the
 * foreign table is read, never written. Every foreign row must match a
 * migration by id AND name, and every migration at or below the foreign
 * high-water mark must have a foreign row — effect/sql never runs an id at or
 * below its latest, so applying one here would diverge from the history the
 * database actually has.
 */
export const adoptForeignLedger = (
	sql: SqlClient,
	table: string,
	foreignTable: string,
	migrations: ReadonlyArray<MigratorMigration>,
): Effect.Effect<ReadonlyArray<MigratorRecord>, AdoptFailure> => {
	const sqlFailure = (cause: SqlError): AdoptFailure => ({ _tag: "sql", cause });
	const mismatch = (message: string): AdoptFailure => ({ _tag: "mismatch", message });

	const foreignExists = sql
		.onDialectOrElse({
			sqlite: () =>
				sql<{ n: number }>`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ${foreignTable}`,
			orElse: () =>
				sql<{ n: number }>`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = ${foreignTable}`,
		})
		.pipe(Effect.map((rows) => Number(rows[0]?.n ?? 0) > 0));

	const adopt = Effect.gen(function* () {
		const own = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql(table)}`;
		if (Number(own[0]?.n ?? 0) > 0) return [];
		if (!(yield* foreignExists)) return [];

		const rows = yield* sql<ForeignRow>`
			SELECT migration_id, name, created_at FROM ${sql(foreignTable)} ORDER BY migration_id ASC
		`.withoutTransform;
		if (rows.length === 0) return [];

		const byId = new Map(migrations.map((migration) => [migration.id, migration]));
		const foreignIds = new Set<number>();
		for (const row of rows) {
			const id = Number(row.migration_id);
			foreignIds.add(id);
			const migration = byId.get(id);
			if (migration === undefined) {
				return yield* Effect.fail(
					mismatch(`${foreignTable} records migration ${id} "${row.name}", which has no migration with that id`),
				);
			}
			if (migration.name !== row.name) {
				return yield* Effect.fail(
					mismatch(
						`${foreignTable} records migration ${id} as "${row.name}", but migration ${id} is named "${migration.name}"`,
					),
				);
			}
		}
		const highWater = Math.max(...foreignIds);
		const skipped = migrations.find((migration) => migration.id <= highWater && !foreignIds.has(migration.id));
		if (skipped !== undefined) {
			return yield* Effect.fail(
				mismatch(
					`migration ${skipped.id} "${skipped.name}" is at or below ${foreignTable}'s latest id ${highWater} but was never recorded there`,
				),
			);
		}

		const now = DateTime.formatIso(yield* DateTime.now);
		const adopted: Array<MigratorRecord> = [];
		for (const row of rows) {
			const id = Number(row.migration_id);
			yield* sql`
				INSERT INTO ${sql(table)} (id, name, applied_at)
				VALUES (${id}, ${row.name}, ${adoptedAt(row.created_at, now)})
			`;
			adopted.push({ id, name: row.name });
		}
		return adopted;
	});

	return sql
		.withTransaction(adopt)
		.pipe(
			Effect.mapError((failure) =>
				"_tag" in failure && failure._tag === "mismatch" ? failure : sqlFailure(failure as SqlError),
			),
		);
};
